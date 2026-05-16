import { useState } from 'react';
import { Info, CheckCircle2, Circle, Clock, AlertTriangle, ExternalLink, Milestone, FileText, TrendingUp } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportedSignal = {
  method: 'reported';
  percent: number;
  asOf: string | null;
  source: string | null;
  quote: string | null;
};
type SourceCitedSignal = {
  method: 'source_cited';
  percent: number;
  citedAt: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  note: string | null;
};
type ManualSignal = {
  method: 'manual';
  percent: number;
  stage: string | null;
};
type MilestoneSignal = {
  method: 'milestones';
  percent: number;
  completed: number;
  total: number;
};
type StatusSignal = {
  method: 'status';
  percent: number | null;
  status: string;
};

type ProgressSignal = SourceCitedSignal | ReportedSignal | ManualSignal | MilestoneSignal | StatusSignal;

export type ProgressResult = {
  value: number | null;
  primary: ProgressSignal | null;
  signals: ProgressSignal[];
};

// ─── Computation ──────────────────────────────────────────────────────────────

const STATUS_PCT: Record<string, number | null> = {
  proposed: 0,
  approved: 2,
  in_progress: null,
  delayed: null,
  completed: 100,
  cancelled: null,
};

const signalDate = (date: string | null | undefined) => date ? date.slice(0, 10) : null;

export function computeProgress(project: any, approvedMilestones: any[], sources: any[] = []): ProgressResult {
  const signals: ProgressSignal[] = [];

  // Status signal — always present as the floor
  signals.push({ method: 'status', status: project.status ?? 'proposed', percent: STATUS_PCT[project.status] ?? null });

  // Milestone completion rate
  if (approvedMilestones.length > 0) {
    const completed = approvedMilestones.filter((m: any) => m.status === 'completed').length;
    const pct = Math.round((completed / approvedMilestones.length) * 100);
    signals.push({ method: 'milestones', percent: pct, completed, total: approvedMilestones.length });
  }

  const sourceCited = sources
    .filter((s: any) =>
      typeof s.progress_percent === 'number'
      && (s.approval_status === 'approved' || s.approval_status == null)
    )
    .sort((a: any, b: any) => {
      const ta = signalDate(a.cited_at) ?? signalDate(a.created_at) ?? '';
      const tb = signalDate(b.cited_at) ?? signalDate(b.created_at) ?? '';
      return tb.localeCompare(ta);
    })[0];
  if (sourceCited) {
    signals.push({
      method: 'source_cited',
      percent: sourceCited.progress_percent,
      citedAt: signalDate(sourceCited.cited_at) ?? signalDate(sourceCited.created_at),
      sourceUrl: sourceCited.url ?? null,
      sourceTitle: sourceCited.title ?? null,
      note: sourceCited.progress_note ?? null,
    });
  }

  // Manual curator entry
  if (typeof project.progress_percent === 'number' && project.progress_percent > 0) {
    signals.push({ method: 'manual', percent: project.progress_percent, stage: project.progress_stage ?? null });
  }

  // AI-extracted reported progress (highest trust when present)
  if (typeof project.reported_progress_percent === 'number') {
    signals.push({
      method: 'reported',
      percent: project.reported_progress_percent,
      asOf: project.reported_progress_as_of ?? null,
      source: project.reported_progress_source_url ?? null,
      quote: project.reported_progress_quote ?? null,
    });
  }

  // Terminal status overrides everything
  if (project.status === 'completed') {
    return { value: 100, primary: signals.find(s => s.method === 'status')!, signals };
  }
  if (project.status === 'cancelled') {
    return { value: null, primary: null, signals };
  }

  const sourceSignal = signals.find(s => s.method === 'source_cited') as SourceCitedSignal | undefined;
  const reportedSignal = signals.find(s => s.method === 'reported') as ReportedSignal | undefined;
  const reportedIsNewer = !!reportedSignal?.asOf && !!sourceSignal?.citedAt && reportedSignal.asOf > sourceSignal.citedAt;

  // Priority: source-cited > reported > manual > milestones > status heuristic (if non-null)
  const primary: ProgressSignal | null =
    (reportedIsNewer ? reportedSignal : sourceSignal) ??
    (reportedIsNewer ? sourceSignal : reportedSignal) ??
    signals.find(s => s.method === 'manual') ??
    signals.find(s => s.method === 'milestones') ??
    signals.find(s => s.method === 'status' && (s as StatusSignal).percent != null) ??
    null;

  return { value: primary?.percent ?? null, primary, signals };
}

// ─── Signal display helpers ───────────────────────────────────────────────────

function methodLabel(method: string) {
  return method === 'source_cited' ? 'Source-cited progress'
    : method === 'reported' ? 'AI-reported'
    : method === 'manual' ? 'Manual entry'
    : method === 'milestones' ? 'Milestone completion'
    : 'Status inference';
}

function methodDescription(s: ProgressSignal): string {
  if (s.method === 'source_cited') {
    const parts = ['Cited by an approved source'];
    if (s.sourceTitle) parts.push(`"${s.sourceTitle}"`);
    if (s.citedAt) parts.push(`on ${s.citedAt}`);
    return parts.join(' ');
  }
  if (s.method === 'reported') {
    const parts = ['Extracted by AI from a dated source'];
    if (s.asOf) parts.push(`as of ${s.asOf}`);
    return parts.join(' ');
  }
  if (s.method === 'manual') return s.stage ? `Stage: "${s.stage}"` : 'Set manually by a contributor or reviewer';
  if (s.method === 'milestones') return `${s.completed} of ${s.total} approved milestone${s.total === 1 ? '' : 's'} marked completed`;
  const labels: Record<string, string> = {
    proposed: 'Project has been proposed but work has not yet started.',
    approved: 'Project has been approved — pre-implementation or mobilisation phase.',
    in_progress: 'Project is active but no completion percentage has been cited in the public record.',
    delayed: 'Project is running behind schedule. No completion figure available.',
    completed: 'Project has been marked completed.',
    cancelled: 'Project has been cancelled.',
  };
  return labels[(s as StatusSignal).status] ?? 'Status-based inference.';
}

// ─── Milestone status icons ───────────────────────────────────────────────────

function MilestoneIcon({ status }: { status: string | null }) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />;
  if (status === 'in_progress') return <Clock className="h-3.5 w-3.5 text-warning shrink-0" />;
  if (status === 'delayed') return <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ProgressBreakdownProps {
  project: any;
  milestones: any[];   // all loaded milestones (approved + pending for reviewers)
  updates: any[];      // all loaded updates
  sources: any[];      // all loaded sources
}

export function ProgressBreakdown({ project, milestones, updates, sources }: ProgressBreakdownProps) {
  const [open, setOpen] = useState(false);

  // Use only approved milestones for computing the score
  const approvedMilestones = milestones.filter((m: any) => m.status === 'completed' || m.approval_status === 'approved' || m.approval_status == null);
  const progress = computeProgress(project, approvedMilestones, sources);
  const sourceSignal = progress.signals.find((s): s is SourceCitedSignal => s.method === 'source_cited');
  const milestoneSummary = milestones.length > 0 ? `${milestones.filter((m: any) => m.status === 'completed').length}/${milestones.length} milestones done` : null;
  const sourceSummary = sourceSignal?.citedAt
    ? `last source: ${sourceSignal.percent}% on ${sourceSignal.citedAt}${sourceSignal.sourceTitle ? ` (${sourceSignal.sourceTitle})` : ''}`
    : null;
  const heroSummary = [milestoneSummary, sourceSummary].filter(Boolean).join(' · ');

  // Recent updates that mention progress (progress type first, then all)
  const progressUpdates = updates
    .filter((u: any) => u.approval_status === 'approved' || u.approval_status == null)
    .sort((a: any, b: any) => {
      const ta = a.update_date || a.created_at || '';
      const tb = b.update_date || b.created_at || '';
      return tb.localeCompare(ta);
    })
    .slice(0, 6);

  const isPrimary = (s: ProgressSignal) => s.method === progress.primary?.method;

  return (
    <>
      {/* ── Clickable progress section in the hero card ── */}
      <div
        className="pt-3 border-t border-primary-foreground/10 group cursor-pointer"
        onClick={() => setOpen(true)}
        title="Click to see progress breakdown"
      >
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-primary-foreground/70 flex items-center gap-1">
            Progress
            <Info className="h-3 w-3 opacity-60 group-hover:opacity-100 transition-opacity" />
          </span>
          {progress.value != null ? (
            <span className="font-mono font-semibold">{progress.value}%</span>
          ) : (
            <span className="text-[10px] text-primary-foreground/60 italic">No data yet</span>
          )}
        </div>
        <div className="h-2 bg-primary-foreground/10 rounded-full overflow-hidden">
          {progress.value != null ? (
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, progress.value)}%` }} />
          ) : (
            // Indeterminate stripe for in-progress projects with no data
            project.status === 'in_progress' || project.status === 'delayed' ? (
              <div className="h-full w-1/3 bg-accent/40 animate-pulse rounded-full" />
            ) : null
          )}
        </div>
        {heroSummary && (
          <p className="text-[10px] text-primary-foreground/60 mt-1 leading-snug">
            {heroSummary}
          </p>
        )}
        <p className="text-[10px] text-primary-foreground/60 mt-1.5 leading-snug group-hover:text-primary-foreground/80 transition-colors">
          {progress.primary
            ? methodLabel(progress.primary.method)
            : 'No completion data in the public record yet.'}
          {' · '}
          <span className="underline underline-offset-2">see breakdown</span>
        </p>
      </div>

      {/* ── Breakdown dialog ── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-accent" />
              Progress breakdown — {project.title?.slice(0, 50)}{(project.title?.length ?? 0) > 50 ? '…' : ''}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 mt-1">
            {/* Active signal — what's driving the bar */}
            <div className="p-3 rounded-lg border border-accent/30 bg-accent/5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-accent uppercase tracking-wider">
                  {progress.primary ? methodLabel(progress.primary.method) : 'No data'}
                </span>
                <span className="font-display text-2xl font-bold">
                  {progress.value != null ? `${progress.value}%` : '—'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {progress.primary ? methodDescription(progress.primary) : 'No progress figure has been cited in the public record for this project. Running AI analysis may extract one.'}
              </p>
              {progress.primary?.method === 'reported' && (progress.primary as ReportedSignal).quote && (
                <blockquote className="mt-2 border-l-2 border-accent/40 pl-2 text-[11px] italic text-muted-foreground">
                  "{(progress.primary as ReportedSignal).quote}"
                </blockquote>
              )}
              {progress.primary?.method === 'source_cited' && (progress.primary as SourceCitedSignal).note && (
                <blockquote className="mt-2 border-l-2 border-accent/40 pl-2 text-[11px] italic text-muted-foreground">
                  "{(progress.primary as SourceCitedSignal).note}"
                </blockquote>
              )}
              {progress.primary?.method === 'reported' && (progress.primary as ReportedSignal).source && (
                <a
                  href={(progress.primary as ReportedSignal).source!}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 text-[11px] text-accent hover:underline inline-flex items-center gap-1"
                  onClick={e => e.stopPropagation()}
                >
                  Source <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {progress.primary?.method === 'source_cited' && (progress.primary as SourceCitedSignal).sourceUrl && (
                <a
                  href={(progress.primary as SourceCitedSignal).sourceUrl!}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 text-[11px] text-accent hover:underline inline-flex items-center gap-1"
                  onClick={e => e.stopPropagation()}
                >
                  Source <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            {/* All signals table */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">All signals</h4>
              <div className="space-y-2">
                {[...progress.signals].reverse().map((s) => (
                  <div
                    key={s.method}
                    className={cn(
                      'flex items-start gap-3 p-2.5 rounded-md border text-xs',
                      isPrimary(s)
                        ? 'border-accent/30 bg-accent/5'
                        : 'border-border bg-card',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold">{methodLabel(s.method)}</span>
                        {isPrimary(s) && (
                          <Badge className="text-[9px] px-1 py-0 h-4 bg-accent/20 text-accent border-0">active</Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground leading-snug">{methodDescription(s)}</p>
                      {s.method === 'source_cited' && s.sourceUrl && (
                        <a
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 text-[11px] text-accent hover:underline inline-flex items-center gap-1"
                          onClick={e => e.stopPropagation()}
                        >
                          Source <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <span className="font-mono font-semibold shrink-0 tabular-nums">
                      {s.percent != null ? `${s.percent}%` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Milestone breakdown */}
            {milestones.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Milestone className="h-3.5 w-3.5" />
                  Milestones ({milestones.filter((m: any) => m.status === 'completed').length}/{milestones.length})
                </h4>
                <div className="space-y-1.5">
                  {milestones.map((m: any) => (
                    <div key={m.id} className="flex items-start gap-2 text-xs">
                      <MilestoneIcon status={m.status} />
                      <div className="flex-1 min-w-0">
                        <span className={cn('font-medium', m.status === 'completed' && 'line-through text-muted-foreground')}>
                          {m.title}
                        </span>
                        {(m.due_date || m.completed_date || m.stage) && (
                          <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">
                            {m.stage ? `${m.stage} · ` : ''}
                            {m.completed_date ? `done ${m.completed_date}` : m.due_date ? `due ${m.due_date}` : ''}
                          </span>
                        )}
                      </div>
                      {m.approval_status === 'pending' && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-warning/40 text-warning shrink-0">pending</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent updates */}
            {progressUpdates.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Recent updates
                </h4>
                <div className="space-y-2">
                  {progressUpdates.map((u: any) => (
                    <div key={u.id} className="border-l-2 border-border pl-3 text-xs space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium leading-snug">{u.title}</span>
                        {u.update_type && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0">{u.update_type}</Badge>
                        )}
                      </div>
                      {u.content && (
                        <p className="text-muted-foreground leading-snug line-clamp-2">{u.content}</p>
                      )}
                      {(u.update_date || u.created_at) && (
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {(u.update_date || u.created_at)?.slice(0, 10)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {milestones.length === 0 && progressUpdates.length === 0 && !progress.primary && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No milestones, updates, or cited progress data yet. Running AI analysis (Trace History) will extract progress figures from the public record.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
