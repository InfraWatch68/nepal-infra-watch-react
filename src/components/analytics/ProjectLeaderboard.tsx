import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, FileText, ArrowRight } from 'lucide-react';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/constants';
import { formatNPR } from '@/lib/parseCoords';

// Two leaderboards live in this file:
//
//   1. ProjectLeaderboard      — rates HOW THE PROJECT IS DOING.
//      Composite "Project Performance Score" (0-100) across 4 dimensions:
//      status, schedule adherence, budget delivery, activity recency.
//      Editorial: "Which projects are on track and delivering?"
//
//   2. DocumentationLeaderboard — rates HOW WELL THE PROJECT IS DOCUMENTED.
//      "Project Record Completeness" (0-100) from 10 yes/no signals about
//      whether key fields are filled in. Editorial: "Which projects have
//      the most-researched records — start your investigation here."
//
// They share the rendering. Each accepts the same `projects` array and
// runs its own scoring + sort.

export type Dimension = { key: string; label: string; points: number; max: number };
export type ScoredProject = { raw: any; score: number; dims: Dimension[] };

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * MS_PER_DAY;

// ─── Performance rubric (4 × 25 pts) ─────────────────────────────────────

function perfStatus(p: any): Dimension {
  const map: Record<string, { pts: number; label: string }> = {
    completed:   { pts: 25, label: 'completed' },
    in_progress: { pts: 18, label: 'in progress' },
    approved:    { pts: 10, label: 'sanctioned' },
    proposed:    { pts: 5,  label: 'proposed' },
    delayed:     { pts: 0,  label: 'delayed' },
    cancelled:   { pts: 0,  label: 'cancelled' },
  };
  const m = map[p.status] ?? { pts: 0, label: p.status ?? '?' };
  return { key: 'status', label: m.label, points: m.pts, max: 25 };
}

function perfSchedule(p: any): Dimension {
  if (p.status === 'completed')  return { key: 'schedule', label: 'delivered',       points: 25, max: 25 };
  if (p.status === 'delayed')    return { key: 'schedule', label: 'flagged delayed', points: 0,  max: 25 };
  if (p.status === 'cancelled')  return { key: 'schedule', label: '—',               points: 0,  max: 25 };
  if (!p.start_date || !p.expected_completion) {
    return { key: 'schedule', label: 'no timeline', points: 10, max: 25 };
  }
  const start = Date.parse(p.start_date);
  const end   = Date.parse(p.expected_completion);
  if (!start || !end || end <= start) {
    return { key: 'schedule', label: 'no timeline', points: 10, max: 25 };
  }
  if (Date.now() > end) {
    return { key: 'schedule', label: 'past due', points: 0, max: 25 };
  }
  const elapsed = Math.max(0, Math.min(1, (Date.now() - start) / (end - start)));
  const expected = elapsed * 100;
  const reported = Number(p.reported_progress_percent);
  const manual   = Number(p.progress_percent);
  const actual   = Number.isFinite(reported) ? reported : (Number.isFinite(manual) ? manual : 0);
  const lead = actual - expected;
  if (lead >= 0)   return { key: 'schedule', label: 'on schedule', points: 25, max: 25 };
  if (lead >= -15) return { key: 'schedule', label: 'slight lag',  points: 18, max: 25 };
  if (lead >= -30) return { key: 'schedule', label: 'behind',      points: 10, max: 25 };
  return { key: 'schedule', label: 'far behind', points: 0, max: 25 };
}

function perfBudget(p: any): Dimension {
  const committed = Number(p.funding_committed_npr) || 0;
  const disbursed = Number(p.funding_disbursed_npr) || 0;
  const budgeted  = Number(p.budget_npr) || 0;
  if (committed > 0) {
    const ratio = disbursed / committed;
    const pct = Math.round(ratio * 100);
    if (ratio >= 0.6) return { key: 'budget', label: `${pct}% disbursed`, points: 25, max: 25 };
    if (ratio >= 0.3) return { key: 'budget', label: `${pct}% disbursed`, points: 18, max: 25 };
    if (ratio > 0)    return { key: 'budget', label: `${pct}% disbursed`, points: 10, max: 25 };
    return { key: 'budget', label: 'committed', points: 5, max: 25 };
  }
  if (budgeted > 0) return { key: 'budget', label: 'budgeted', points: 5, max: 25 };
  return { key: 'budget', label: 'no budget data', points: 0, max: 25 };
}

function perfActivity(p: any): Dimension {
  if (!p.last_activity_at) return { key: 'activity', label: 'no activity logged', points: 0, max: 25 };
  const ageDays = (Date.now() - Date.parse(p.last_activity_at)) / MS_PER_DAY;
  if (ageDays < 14) return { key: 'activity', label: 'active this week',  points: 25, max: 25 };
  if (ageDays < 30) return { key: 'activity', label: 'active this month', points: 18, max: 25 };
  if (ageDays < 90) return { key: 'activity', label: 'updated recently',  points: 10, max: 25 };
  const months = Math.floor(ageDays / 30);
  return { key: 'activity', label: `${months}mo stale`, points: 0, max: 25 };
}

export function scoreByPerformance(p: any): ScoredProject {
  const dims = [perfStatus(p), perfSchedule(p), perfBudget(p), perfActivity(p)];
  return { raw: p, score: dims.reduce((s, d) => s + d.points, 0), dims };
}

// ─── Documentation rubric (10 × 10 pts) ───────────────────────────────────

function scoreByDocumentation(p: any): ScoredProject {
  const now = Date.now();
  const dims: Dimension[] = [
    { key: 'budget',     label: 'budget',            points: Number(p.budget_npr) > 0 ? 10 : 0, max: 10 },
    { key: 'agency',     label: 'agency',            points: p.implementing_agency ? 10 : 0,    max: 10 },
    { key: 'contractor', label: 'contractor',        points: p.contractor ? 10 : 0,             max: 10 },
    { key: 'completion', label: 'completion date',   points: p.expected_completion ? 10 : 0,    max: 10 },
    { key: 'start',      label: 'start date',        points: p.start_date ? 10 : 0,             max: 10 },
    { key: 'desc',       label: 'description',       points: typeof p.description === 'string' && p.description.length > 200 ? 10 : 0, max: 10 },
    { key: 'image',      label: 'photos',            points: !!p.cover_image_url || (Array.isArray(p.image_urls) && p.image_urls.length > 0) ? 10 : 0, max: 10 },
    { key: 'geo',        label: 'geo-tagged',        points: (p.latitude && p.longitude) || p.coordinates ? 10 : 0, max: 10 },
    { key: 'progress',   label: 'verified progress', points: p.reported_progress_quote ? 10 : 0, max: 10 },
    { key: 'fresh',      label: 'recent activity',   points: p.last_activity_at && (now - Date.parse(p.last_activity_at)) < NINETY_DAYS_MS ? 10 : 0, max: 10 },
  ];
  return { raw: p, score: dims.reduce((s, d) => s + d.points, 0), dims };
}

// ─── Shared rendering ─────────────────────────────────────────────────────

export function letterGrade(score: number): { grade: string; cls: string } {
  if (score >= 85) return { grade: 'A', cls: 'border-success/40 bg-success/10 text-success' };
  if (score >= 70) return { grade: 'B', cls: 'border-info/40 bg-info/10 text-info' };
  if (score >= 55) return { grade: 'C', cls: 'border-warning/40 bg-warning/10 text-warning' };
  if (score >= 35) return { grade: 'D', cls: 'border-muted-foreground/40 bg-muted/30 text-muted-foreground' };
  return { grade: 'F', cls: 'border-destructive/40 bg-destructive/10 text-destructive' };
}

function rankAndSort(projects: any[], scoreFn: (p: any) => ScoredProject): ScoredProject[] {
  if (projects.length === 0) return [];
  return projects
    .map(scoreFn)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const la = a.raw.last_activity_at ? Date.parse(a.raw.last_activity_at) : 0;
      const lb = b.raw.last_activity_at ? Date.parse(b.raw.last_activity_at) : 0;
      return lb - la;
    })
    .slice(0, 10);
}

function ProjectScoreCarousel({ ranked, emptyMsg }: { ranked: ScoredProject[]; emptyMsg: string }) {
  if (ranked.length === 0) {
    return <div className="text-xs text-muted-foreground py-2">{emptyMsg}</div>;
  }
  return (
    <Carousel opts={{ loop: true, align: 'start' }} orientation="horizontal" className="-mx-2">
      <CarouselContent className="-ml-2">
        {ranked.map((p, i) => {
          const grade = letterGrade(p.score);
          const strengths = [...p.dims]
            .filter(d => d.points > 0)
            .sort((a, b) => (b.points / b.max) - (a.points / a.max))
            .slice(0, 3);
          const statusKey = p.raw.status || 'proposed';
          return (
            <CarouselItem key={p.raw.id} className="pl-2 basis-full sm:basis-1/2 lg:basis-1/3">
              <Link
                to={`/projects/${p.raw.slug}`}
                className="block h-full p-4 rounded-md border border-border bg-background hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wider font-mono text-muted-foreground">#{i + 1}</span>
                    <span className={cn('text-xs font-mono font-bold rounded px-1.5 py-0.5 border', grade.cls)}>
                      {grade.grade}
                    </span>
                  </div>
                  <span className="font-display text-2xl font-bold leading-none">
                    {p.score}<span className="text-sm text-muted-foreground">/100</span>
                  </span>
                </div>
                <div className="font-display text-base font-semibold leading-snug mb-1 line-clamp-2 min-h-[2.5em]">
                  {p.raw.title}
                </div>
                <div className="text-[11px] text-muted-foreground font-mono mb-3 truncate">
                  {p.raw.sector}{p.raw.province ? ` · ${p.raw.province}` : ''}
                  {Number(p.raw.budget_npr) > 0 ? ` · ${formatNPR(Number(p.raw.budget_npr))}` : ''}
                </div>
                <div className="flex flex-wrap gap-1 mb-3 min-h-[3.5em]">
                  <Badge variant="outline" className={cn('text-[10px] font-mono', STATUS_COLORS[statusKey] ?? '')}>
                    {STATUS_LABELS[statusKey] ?? statusKey}
                  </Badge>
                  {strengths.map(d => (
                    <Badge
                      key={d.key}
                      variant="outline"
                      className={cn(
                        'text-[10px] font-mono',
                        (d.points / d.max) >= 0.7
                          ? 'border-success/30 text-success bg-success/5'
                          : 'border-info/30 text-info bg-info/5',
                      )}
                    >
                      {d.label}
                    </Badge>
                  ))}
                </div>
                <div className="text-xs text-accent inline-flex items-center gap-1">
                  View project <ArrowRight className="h-3 w-3" />
                </div>
              </Link>
            </CarouselItem>
          );
        })}
      </CarouselContent>
      <CarouselPrevious className="hidden sm:flex -left-3" />
      <CarouselNext className="hidden sm:flex -right-3" />
    </Carousel>
  );
}

// ─── Public components ─────────────────────────────────────────────────────

export function ProjectLeaderboard({ projects }: { projects: any[] }) {
  const ranked = useMemo(() => rankAndSort(projects, scoreByPerformance), [projects]);
  return <ProjectScoreCarousel ranked={ranked} emptyMsg="No approved projects yet — rating leaderboard will populate as projects clear moderation." />;
}

export function DocumentationLeaderboard({ projects }: { projects: any[] }) {
  const ranked = useMemo(() => rankAndSort(projects, scoreByDocumentation), [projects]);
  return <ProjectScoreCarousel ranked={ranked} emptyMsg="No approved projects yet — documentation leaderboard will populate as projects clear moderation." />;
}

export { Trophy as LeaderboardIcon, FileText as DocumentationIcon };
