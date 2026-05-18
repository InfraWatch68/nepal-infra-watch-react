import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowRight, Trophy, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SECTORS, PROVINCES, STATUS_LABELS, STATUS_COLORS } from '@/lib/constants';
import { formatNPR } from '@/lib/parseCoords';
import { scoreByPerformance, letterGrade, type ScoredProject } from '@/components/analytics/ProjectLeaderboard';

// "View all" companion page to /analytics#leaderboard. Lists every approved
// project with its performance score and lets users sort + filter. Built as
// a flat table on desktop, card list on mobile. No pagination yet — fine
// up to ~500 rows; revisit if catalog exceeds that.

type SortKey = 'score-desc' | 'score-asc' | 'title-asc' | 'title-desc' | 'activity' | 'budget-desc';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'score-desc',  label: 'Rating (highest first)' },
  { value: 'score-asc',   label: 'Rating (lowest first)' },
  { value: 'activity',    label: 'Recently active' },
  { value: 'budget-desc', label: 'Budget (largest first)' },
  { value: 'title-asc',   label: 'Title (A → Z)' },
  { value: 'title-desc',  label: 'Title (Z → A)' },
];

export default function ProjectRatings() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('score-desc');
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [provinceFilter, setProvinceFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    supabase.from('projects').select('*').eq('approval_status', 'approved')
      .then(({ data }) => setProjects(data ?? []))
      .finally(() => setLoading(false));
  }, []);

  // Score every project, then filter, then sort. Memoised to avoid
  // recomputing on every keystroke in the (currently nonexistent but
  // possibly future) search box.
  const rows = useMemo<ScoredProject[]>(() => {
    if (projects.length === 0) return [];
    let scored = projects.map(scoreByPerformance);
    if (sectorFilter !== 'all')   scored = scored.filter(p => p.raw.sector === sectorFilter);
    if (provinceFilter !== 'all') scored = scored.filter(p => p.raw.province === provinceFilter);
    if (statusFilter !== 'all')   scored = scored.filter(p => p.raw.status === statusFilter);

    const titleCmp = (a: ScoredProject, b: ScoredProject) =>
      String(a.raw.title || '').localeCompare(String(b.raw.title || ''));
    const tsActivity = (p: ScoredProject) =>
      p.raw.last_activity_at ? Date.parse(p.raw.last_activity_at) : 0;
    const budget = (p: ScoredProject) => Number(p.raw.budget_npr) || 0;

    switch (sort) {
      case 'score-desc':  scored.sort((a, b) => b.score - a.score || tsActivity(b) - tsActivity(a)); break;
      case 'score-asc':   scored.sort((a, b) => a.score - b.score || tsActivity(b) - tsActivity(a)); break;
      case 'title-asc':   scored.sort(titleCmp); break;
      case 'title-desc':  scored.sort((a, b) => titleCmp(b, a)); break;
      case 'activity':    scored.sort((a, b) => tsActivity(b) - tsActivity(a)); break;
      case 'budget-desc': scored.sort((a, b) => budget(b) - budget(a)); break;
    }
    return scored;
  }, [projects, sort, sectorFilter, provinceFilter, statusFilter]);

  const totalApproved = projects.length;
  const visibleCount = rows.length;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <section className="border-b bg-secondary/30">
        <div className="container py-8">
          <Link to="/analytics#leaderboard" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3 font-mono">
            <ChevronLeft className="h-3 w-3" /> Back to Analytics
          </Link>
          <p className="text-xs uppercase tracking-[0.2em] font-mono text-accent mb-2">Project ratings</p>
          <h1 className="font-display text-3xl md:text-4xl font-bold flex items-center gap-3">
            <Trophy className="h-7 w-7 text-accent" /> All projects by performance score
          </h1>
          <p className="text-muted-foreground mt-3 text-sm md:text-base max-w-3xl">
            Rating combines four dimensions, each worth 25 points: <span className="font-mono">status</span>
            {' · '}<span className="font-mono">schedule adherence</span>
            {' · '}<span className="font-mono">budget delivery</span>
            {' · '}<span className="font-mono">activity recency</span>. Score reflects how the project is
            performing — not how well-documented it is. Approved projects only.
          </p>
        </div>
      </section>

      <div className="container py-6 space-y-4">
        {/* Sort + filter controls */}
        <Card className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-end gap-3">
            <div className="space-y-1 w-full lg:w-auto">
              <label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Sort by</label>
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger aria-label="Sort project ratings" className="w-full lg:w-[210px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 w-full lg:w-auto">
              <label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Sector</label>
              <Select value={sectorFilter} onValueChange={setSectorFilter}>
                <SelectTrigger aria-label="Filter ratings by sector" className="w-full lg:w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sectors</SelectItem>
                  {SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 w-full lg:w-auto">
              <label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Province</label>
              <Select value={provinceFilter} onValueChange={setProvinceFilter}>
                <SelectTrigger aria-label="Filter ratings by province" className="w-full lg:w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All provinces</SelectItem>
                  {PROVINCES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 w-full lg:w-auto">
              <label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger aria-label="Filter ratings by status" className="w-full lg:w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto text-xs text-muted-foreground font-mono">
              {visibleCount} of {totalApproved}
            </div>
          </div>
        </Card>

        {/* Desktop table view */}
        <Card className="p-0 hidden md:block overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr className="text-left text-[11px] uppercase tracking-wider font-mono text-muted-foreground">
                <th className="px-4 py-3 w-12">#</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Sector / Province</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Budget</th>
                <th className="px-4 py-3">Strengths</th>
                <th className="px-4 py-3 text-right w-28">Score</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/60">
                    <td colSpan={7} className="px-4 py-4">
                      <div className="h-4 w-full rounded bg-muted animate-pulse" />
                    </td>
                  </tr>
                ))
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">No projects match the current filters.</td></tr>
              )}
              {rows.map((p, i) => {
                const grade = letterGrade(p.score);
                const strengths = [...p.dims]
                  .filter(d => d.points > 0)
                  .sort((a, b) => (b.points / b.max) - (a.points / a.max))
                  .slice(0, 3);
                const statusKey = p.raw.status || 'proposed';
                return (
                  <tr key={p.raw.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground align-top">{i + 1}</td>
                    <td className="px-4 py-3 align-top">
                      <Link to={`/projects/${p.raw.slug}`} className="font-medium hover:text-accent inline-flex items-center gap-1">
                        {p.raw.title} <ArrowRight className="h-3 w-3 opacity-50" />
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono align-top">
                      {p.raw.sector}<br />{p.raw.province || '—'}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge variant="outline" className={cn('text-[10px] font-mono', STATUS_COLORS[statusKey] ?? '')}>
                        {STATUS_LABELS[statusKey] ?? statusKey}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono align-top">
                      {Number(p.raw.budget_npr) > 0 ? formatNPR(Number(p.raw.budget_npr)) : '—'}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-1">
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
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <div className="inline-flex items-center gap-2">
                        <span className="font-display text-lg font-bold leading-none">{p.score}</span>
                        <span className={cn('text-[10px] font-mono font-bold rounded px-1.5 py-0.5 border', grade.cls)}>
                          {grade.grade}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {/* Mobile card-list view */}
        <div className="md:hidden space-y-3">
          {loading && (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="p-4 rounded-md border border-border bg-background">
                <div className="h-4 w-1/3 rounded bg-muted animate-pulse mb-3" />
                <div className="h-5 w-full rounded bg-muted animate-pulse mb-2" />
                <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
              </div>
            ))
          )}
          {!loading && rows.length === 0 && (
            <div className="text-center text-xs text-muted-foreground py-6">No projects match the current filters.</div>
          )}
          {rows.map((p, i) => {
            const grade = letterGrade(p.score);
            const strengths = [...p.dims]
              .filter(d => d.points > 0)
              .sort((a, b) => (b.points / b.max) - (a.points / a.max))
              .slice(0, 3);
            const statusKey = p.raw.status || 'proposed';
            return (
              <Link
                to={`/projects/${p.raw.slug}`}
                key={p.raw.id}
                className="block p-4 rounded-md border border-border bg-background hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-xs uppercase tracking-wider font-mono text-muted-foreground">#{i + 1}</span>
                  <div className="inline-flex items-center gap-1.5">
                    <span className="font-display text-xl font-bold">{p.score}</span>
                    <span className={cn('text-[10px] font-mono font-bold rounded px-1.5 py-0.5 border', grade.cls)}>{grade.grade}</span>
                  </div>
                </div>
                <div className="font-semibold leading-snug mb-1 line-clamp-2">{p.raw.title}</div>
                <div className="text-[11px] text-muted-foreground font-mono mb-2 truncate">
                  {p.raw.sector}{p.raw.province ? ` · ${p.raw.province}` : ''}
                  {Number(p.raw.budget_npr) > 0 ? ` · ${formatNPR(Number(p.raw.budget_npr))}` : ''}
                </div>
                <div className="flex flex-wrap gap-1">
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
              </Link>
            );
          })}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
