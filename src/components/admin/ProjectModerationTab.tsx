import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, ChevronDown, ChevronRight, Check, RefreshCw, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Per-bucket entry returned by public.project_moderation_summary().
type BucketStats = { approved: number; pending: number; pending_eligible: number };
type BucketName =
  | 'funding' | 'documents' | 'stakeholders' | 'risks'
  | 'impact' | 'procurement' | 'compliance'
  | 'sources' | 'updates' | 'milestones';

type ProjectRow = {
  project_id: number;
  title: string;
  slug: string;
  confidence_score: number | null;
  total_approved: number;
  total_pending: number;
  total_pending_eligible: number;
  buckets: Record<BucketName, BucketStats>;
};

// Fixed display order for the 9 buckets. Sources/updates render last because
// they're cascade-trusted and shouldn't normally have pending rows — visually
// de-emphasising them mirrors the trust model.
const BUCKETS: { name: BucketName; label: string }[] = [
  { name: 'funding',      label: 'Funding' },
  { name: 'documents',    label: 'Documents' },
  { name: 'stakeholders', label: 'Stakeholders' },
  { name: 'risks',        label: 'Risks' },
  { name: 'impact',       label: 'Impact' },
  { name: 'procurement',  label: 'Procurement' },
  { name: 'compliance',   label: 'Compliance' },
  { name: 'sources',      label: 'Sources' },
  { name: 'updates',      label: 'Updates' },
  { name: 'milestones',   label: 'Milestones' },
];

// Small chip pair that appears at every level (project total + per-bucket).
// Approved is muted; pending is amber so the eye is drawn to the action work.
const StatChips = ({ approved, pending }: { approved: number; pending: number }) => (
  <span className="flex items-center gap-1.5">
    <Badge variant="outline" className="text-[10px] font-mono border-success/40 text-success">
      ✓ {approved}
    </Badge>
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] font-mono',
        pending > 0 ? 'border-warning/60 text-warning' : 'border-border text-muted-foreground/60',
      )}
    >
      ⏳ {pending}
    </Badge>
  </span>
);

export function ProjectModerationTab() {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [threshold, setThreshold] = useState<number>(0.85);
  const [loading, setLoading] = useState<boolean>(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [busyProject, setBusyProject] = useState<number | null>(null);
  const [busyGlobal, setBusyGlobal] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('project_moderation_summary', { p_threshold: threshold });
    setLoading(false);
    if (error) { toast.error(`Load failed: ${error.message}`); return; }
    setRows((data ?? []) as ProjectRow[]);
  }, [threshold]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Aggregate totals across every approved project, shown in the top strip.
  const totals = useMemo(() => {
    let approved = 0, pending = 0, eligible = 0;
    for (const r of rows) {
      approved += r.total_approved;
      pending  += r.total_pending;
      eligible += r.total_pending_eligible;
    }
    return { approved, pending, eligible };
  }, [rows]);

  const approveOne = async (projectId: number) => {
    setBusyProject(projectId);
    const { data, error } = await supabase.rpc('bulk_approve_pending', {
      p_project_id: projectId,
      p_threshold: threshold,
    });
    setBusyProject(null);
    if (error) { toast.error(error.message); return; }
    const total = Object.values((data ?? {}) as Record<string, number>).reduce((a, b) => a + Number(b || 0), 0);
    toast.success(`Approved ${total} row${total === 1 ? '' : 's'} for this project`);
    load();
  };

  const approveGlobal = async () => {
    if (totals.eligible === 0) return;
    if (!confirm(`Approve ${totals.eligible} pending row${totals.eligible === 1 ? '' : 's'} across all approved projects at threshold ≥ ${Math.round(threshold * 100)}%? Sources & updates on these projects (cascade-trusted) will also be approved.`)) return;
    setBusyGlobal(true);
    const { data, error } = await supabase.rpc('bulk_approve_pending', {
      p_project_id: null,
      p_threshold: threshold,
    });
    setBusyGlobal(false);
    if (error) { toast.error(error.message); return; }
    const total = Object.values((data ?? {}) as Record<string, number>).reduce((a, b) => a + Number(b || 0), 0);
    toast.success(`Approved ${total} row${total === 1 ? '' : 's'} across all approved projects`);
    load();
  };

  return (
    <div className="space-y-3">
      {/* Top strip: totals + global threshold + global approve.
          Mirrors the Sherlock queue header (counts on the left, action on the right). */}
      <div className="flex items-center justify-between flex-wrap gap-2 p-2 rounded-md border bg-card">
        <div className="text-xs text-muted-foreground">
          {rows.length} approved project{rows.length === 1 ? '' : 's'} ·
          <span className="text-success ml-1">{totals.approved} approved</span> ·
          <span className={cn('ml-1', totals.pending > 0 ? 'text-warning' : 'text-muted-foreground')}>
            {totals.pending} pending
          </span>
          {totals.eligible > 0 && (
            <span className="text-accent ml-1">({totals.eligible} eligible at ≥ {Math.round(threshold * 100)}%)</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Threshold
            <Input
              type="number"
              step={0.05}
              min={0}
              max={1}
              value={threshold}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setThreshold(Math.max(0, Math.min(1, v)));
              }}
              className="h-7 w-16 text-xs font-mono"
            />
          </label>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={approveGlobal}
            disabled={busyGlobal || totals.eligible === 0}
            title="Approve every pending row across all approved projects that meets the threshold"
          >
            {busyGlobal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Approve all eligible ({totals.eligible})
          </Button>
        </div>
      </div>

      {/* Project list — same compact Card row style as the Sherlock queue. */}
      {loading && rows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No approved projects yet.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map(r => {
            const isOpen = expanded.has(r.project_id);
            return (
              <Card key={r.project_id} className="p-2.5 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => toggleExpand(r.project_id)}
                    className="flex items-center gap-1 hover:text-accent transition-colors"
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                  >
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                  <span className="font-semibold truncate flex-1 min-w-0">{r.title}</span>
                  {typeof r.confidence_score === 'number' && (
                    <Badge variant="outline" className="text-[10px] font-mono border-accent/40 text-accent">
                      {Math.round(r.confidence_score * 100)}%
                    </Badge>
                  )}
                  <StatChips approved={r.total_approved} pending={r.total_pending} />
                  <Link to={`/projects/${r.slug}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-accent">
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                  {r.total_pending_eligible > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => approveOne(r.project_id)}
                      disabled={busyProject === r.project_id}
                      title={`Approve ${r.total_pending_eligible} pending row(s) at ≥ ${Math.round(threshold * 100)}%`}
                    >
                      {busyProject === r.project_id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Check className="h-3 w-3" />}
                      Approve {r.total_pending_eligible}
                    </Button>
                  )}
                </div>

                {isOpen && (
                  <div className="mt-2 pl-5 border-l border-border space-y-1">
                    {BUCKETS.map(b => {
                      const stats = r.buckets?.[b.name] ?? { approved: 0, pending: 0, pending_eligible: 0 };
                      const isEmpty = stats.approved === 0 && stats.pending === 0;
                      return (
                        <div
                          key={b.name}
                          className={cn(
                            'flex items-center gap-2 flex-wrap py-0.5',
                            isEmpty && 'opacity-50',
                          )}
                        >
                          <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground w-24 shrink-0">
                            {b.label}
                          </span>
                          <StatChips approved={stats.approved} pending={stats.pending} />
                          {stats.pending_eligible > 0 && (
                            <span className="text-[10px] text-accent">
                              {stats.pending_eligible} eligible
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
