import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AdSlot } from '@/components/AdSlot';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  AreaChart, Area,
} from 'recharts';
import { CalendarClock, ArrowRight, ChevronDown } from 'lucide-react';
import { formatNPR } from '@/lib/parseCoords';
import { STATUS_LABELS } from '@/lib/constants';
import { ProjectLeaderboard, DocumentationLeaderboard, LeaderboardIcon, DocumentationIcon } from '@/components/analytics/ProjectLeaderboard';

// Status colors using project CSS vars — ordered by lifecycle so the stacked
// bar reads left-to-right as project flow: proposed → completed, with the
// red delayed slice popping for attention. Replaces the previous 7-colour
// rainbow that gave the page a generic dashboard-template feel.
const STATUS_FILL: Record<string, string> = {
  proposed:    'hsl(var(--muted-foreground) / 0.55)',
  approved:    'hsl(var(--info, 210 90% 50%))',
  in_progress: 'hsl(var(--warning, 38 92% 50%))',
  delayed:     'hsl(var(--destructive))',
  completed:   'hsl(var(--success, 152 60% 36%))',
  cancelled:   'hsl(var(--muted-foreground) / 0.3)',
};
const STATUS_ORDER = ['proposed', 'approved', 'in_progress', 'delayed', 'completed', 'cancelled'] as const;

// One month in ms, used by the worst-slips computation. Approximate (30d) is
// fine for a "months overdue" display where ±1 day doesn't change the story.
const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;

type DailyMetric = {
  day: string;
  new_projects: number | null;
  new_updates: number | null;
  new_detail_rows: number | null;
};

export default function Analytics() {
  const [projects, setProjects] = useState<any[]>([]);
  const [daily, setDaily] = useState<DailyMetric[]>([]);
  // 'all' = portfolio total · '__untagged__' = projects with no fiscal_year set ·
  // anything else is a literal FY string ("2081/82" etc.) sourced from the data.
  const [fyFilter, setFyFilter] = useState<string>('all');

  useEffect(() => {
    supabase.from('projects').select('*').eq('approval_status', 'approved')
      .then(({ data }) => setProjects(data ?? []));

    // 30-day activity strip. RLS allows public read on daily_project_metrics.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    supabase.from('daily_project_metrics')
      .select('day, new_projects, new_updates, new_detail_rows')
      .gte('day', thirtyDaysAgo)
      .order('day', { ascending: true })
      .then(({ data }) => setDaily((data ?? []) as DailyMetric[]));
  }, []);

  // Scroll to #section when navigated to /analytics#xxx from the home
  // carousel. React Router's client-side nav doesn't trigger the browser's
  // default fragment-scroll, so do it manually after the data load settles
  // (small delay so card heights are final).
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash || projects.length === 0) return;
    const t = setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    return () => clearTimeout(t);
  }, [projects.length]);

  // ─── Sector / province / status aggregates ─────────────────────────────────
  const bySector = useMemo(() => Object.entries(projects.reduce((acc: any, p) => {
    if (p.sector) acc[p.sector] = (acc[p.sector] ?? 0) + 1;
    return acc;
  }, {})).map(([name, value]) => ({ name, value })).sort((a, b) => (b.value as number) - (a.value as number)), [projects]);

  const byProvince = useMemo(() => Object.entries(projects.reduce((acc: any, p) => {
    if (p.province) acc[p.province] = (acc[p.province] ?? 0) + 1;
    return acc;
  }, {})).map(([name, value]) => ({ name, value })).sort((a, b) => (b.value as number) - (a.value as number)), [projects]);

  // Status distribution as a single-row dataset for stacked-bar rendering.
  // One row, multiple stacked dataKeys — Recharts renders this as a single
  // horizontal bar split into segments. Way more legible than a 6-slice pie
  // where proposed/cancelled used to be visually identical.
  const statusBarData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of projects) {
      const s = p.status || 'proposed';
      counts[s] = (counts[s] ?? 0) + 1;
    }
    const row: Record<string, number | string> = { name: 'All' };
    for (const s of STATUS_ORDER) row[s] = counts[s] ?? 0;
    return [row];
  }, [projects]);

  // ─── KPIs ──────────────────────────────────────────────────────────────────
  const totalBudget = useMemo(() => projects.reduce((s, p) => s + (Number(p.budget_npr) || 0), 0), [projects]);

  // Fiscal year filter for the Total budget KPI. We expose the full sorted list
  // of FYs present in the data plus an "Untagged" bucket iff at least one
  // project lacks a fiscal_year — keeps the dropdown honest about what the
  // portfolio total actually covers.
  const fiscalYears = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) {
      const fy = p.fiscal_year?.trim();
      if (fy) set.add(fy);
    }
    return [...set].sort();
  }, [projects]);
  const hasUntaggedBudget = useMemo(
    () => projects.some(p => !p.fiscal_year?.trim()),
    [projects],
  );
  const untaggedCount = projects.filter(p => !p.fiscal_year && !p.start_date).length;
  const filteredBudget = useMemo(() => {
    if (fyFilter === 'all') return totalBudget;
    return projects
      .filter(p => fyFilter === '__untagged__'
        ? !p.fiscal_year?.trim()
        : p.fiscal_year?.trim() === fyFilter)
      .reduce((s, p) => s + (Number(p.budget_npr) || 0), 0);
  }, [projects, totalBudget, fyFilter]);
  const filteredProjectCount = useMemo(() => {
    if (fyFilter === 'all') return projects.length;
    return projects.filter(p => fyFilter === '__untagged__'
      ? !p.fiscal_year?.trim()
      : p.fiscal_year?.trim() === fyFilter,
    ).length;
  }, [projects, fyFilter]);

  // ─── Budget by fiscal year ─────────────────────────────────────────────────
  // Groups approved projects by fiscal_year. Projects without a fiscal_year are
  // collected under "Untagged" so the chart accounts for the full portfolio.
  const budgetByFY = useMemo(() => {
    const map = new Map<string, { budget: number; count: number }>();
    for (const p of projects) {
      const fy = p.fiscal_year?.trim() || 'Untagged';
      const prev = map.get(fy) ?? { budget: 0, count: 0 };
      map.set(fy, { budget: prev.budget + (Number(p.budget_npr) || 0), count: prev.count + 1 });
    }
    // Sort tagged FYs in ascending order; put "Untagged" last.
    return [...map.entries()]
      .sort(([a], [b]) => {
        if (a === 'Untagged') return 1;
        if (b === 'Untagged') return -1;
        return a.localeCompare(b);
      })
      .map(([fy, d]) => ({ fy, budget: d.budget, count: d.count }));
  }, [projects]);
  const avgProgress = useMemo(() =>
    projects.length ? Math.round(projects.reduce((s, p) => s + (p.progress_percent || 0), 0) / projects.length) : 0,
    [projects],
  );

  // ─── Auto-lede: delay rate overall + leading province by delay rate ────────
  // Counts a project as "delayed" if its status is literally 'delayed' OR
  // it's in_progress past its expected_completion. We need at least 5
  // projects in a province for it to be ranked (avoids "Lumbini leads at
  // 100%" when there's only one delayed project).
  const lede = useMemo(() => {
    if (projects.length < 5) return null;
    const now = Date.now();
    const isDelayed = (p: any) =>
      p.status === 'delayed' ||
      (p.status === 'in_progress' && p.expected_completion && Date.parse(p.expected_completion) < now);
    const total = projects.length;
    const delayed = projects.filter(isDelayed).length;
    const delayRate = Math.round((delayed / total) * 100);

    type Stat = { total: number; delayed: number };
    const provStats: Record<string, Stat> = {};
    for (const p of projects) {
      if (!p.province) continue;
      provStats[p.province] = provStats[p.province] ?? { total: 0, delayed: 0 };
      provStats[p.province].total += 1;
      if (isDelayed(p)) provStats[p.province].delayed += 1;
    }
    const ranked = Object.entries(provStats)
      .filter(([, s]) => s.total >= 5)
      .map(([name, s]) => ({ name, rate: Math.round((s.delayed / s.total) * 100), total: s.total }))
      .sort((a, b) => b.rate - a.rate);
    const worst = ranked[0];

    return { total, delayed, delayRate, worst };
  }, [projects]);

  // ─── Worst slips: 10 most-overdue projects still in flight ────────────────
  const worstSlips = useMemo(() => {
    const now = Date.now();
    return projects
      .filter(p => p.expected_completion && p.status !== 'completed' && p.status !== 'cancelled' && Date.parse(p.expected_completion) < now)
      .map(p => ({
        ...p,
        monthsOverdue: Math.floor((now - Date.parse(p.expected_completion)) / MS_PER_MONTH),
      }))
      .sort((a, b) => b.monthsOverdue - a.monthsOverdue)
      .slice(0, 10);
  }, [projects]);

  // Stalest analysis backlog: never analysed first, then oldest analysis.
  const stalest = useMemo(() => [...projects]
    .sort((a, b) => {
      const la = a.last_comprehensive_analysis_at ? Date.parse(a.last_comprehensive_analysis_at) : 0;
      const lb = b.last_comprehensive_analysis_at ? Date.parse(b.last_comprehensive_analysis_at) : 0;
      return la - lb;
    })
    .slice(0, 10),
    [projects],
  );

  // ─── Activity strip data — pad sparse days with zeros so X axis reads ───
  // continuously instead of jumping across missing weekend gaps.
  const activityData = useMemo(() => {
    if (daily.length === 0) return [];
    const byDay = new Map<string, DailyMetric>();
    for (const d of daily) byDay.set(d.day, d);
    const out: { day: string; projects: number; updates: number; details: number }[] = [];
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < 30; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      const m = byDay.get(key);
      out.push({
        day: key.slice(5), // MM-DD for compact x-axis labels
        projects: m?.new_projects ?? 0,
        updates: m?.new_updates ?? 0,
        details: m?.new_detail_rows ?? 0,
      });
    }
    return out;
  }, [daily]);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      {/* Auto-lede: replaces the static "Insights / Analytics" eyebrow + h1.
          Reads like a newsroom dek instead of a chart-builder caption. */}
      <section className="border-b bg-secondary/30">
        <div className="container py-8">
          <p className="text-xs uppercase tracking-[0.2em] font-mono text-accent mb-2">
            Insights · {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()}
          </p>
          {lede ? (
            <>
              <h1 className="font-display text-3xl md:text-4xl font-bold leading-tight text-balance max-w-3xl">
                <span className="text-destructive">{lede.delayRate}%</span> of {lede.total} tracked projects are delayed or running past their target completion.
              </h1>
              {lede.worst && (
                <p className="text-muted-foreground mt-3 text-sm md:text-base">
                  <span className="font-semibold text-foreground">{lede.worst.name}</span> leads at{' '}
                  <span className="font-mono text-destructive">{lede.worst.rate}%</span> across{' '}
                  {lede.worst.total} tracked projects.
                </p>
              )}
            </>
          ) : (
            <>
              <h1 className="font-display text-4xl font-bold">Analytics</h1>
              <p className="text-muted-foreground mt-2">Sector, province and status breakdowns from public data.</p>
            </>
          )}
        </div>
      </section>

      <div className="container py-8 space-y-6">
        {/* KPI row */}
        <div className="grid md:grid-cols-4 gap-4">
          <Stat label="Tracked projects" value={projects.length.toString()} />
          {/* Total budget — filterable by fiscal year. Dropdown only appears
              when the data has at least one tagged FY (otherwise it would
              offer just "All" + "Untagged" which adds noise without insight). */}
          <Card className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs uppercase tracking-wider font-mono text-muted-foreground">
                Total budget
              </div>
              {(fiscalYears.length > 0 || hasUntaggedBudget) && (
                <Select value={fyFilter} onValueChange={setFyFilter}>
                  <SelectTrigger
                    aria-label="Filter total budget by fiscal year"
                    className="h-6 w-auto min-w-[5.5rem] gap-1 px-2 py-0 text-[10px] font-mono uppercase tracking-wider"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All FYs</SelectItem>
                    {fiscalYears.map(fy => (
                      <SelectItem key={fy} value={fy}>FY {fy}</SelectItem>
                    ))}
                    {hasUntaggedBudget && <SelectItem value="__untagged__">Untagged</SelectItem>}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="font-display text-3xl font-bold mt-2">{formatNPR(filteredBudget)}</div>
            <div className="text-[10px] font-mono text-muted-foreground mt-1">
              {fyFilter === 'all'
                ? (fiscalYears.length > 0
                    ? `Across ${fiscalYears.length} fiscal year${fiscalYears.length === 1 ? '' : 's'}`
                    : 'All approved projects')
                : `${filteredProjectCount} project${filteredProjectCount === 1 ? '' : 's'} · ${fyFilter === '__untagged__' ? 'no FY tag' : `FY ${fyFilter}`}`}
            </div>
          </Card>
          <Stat label="Avg. progress" value={`${avgProgress}%`} />
          <Stat label="Provinces covered" value={byProvince.length.toString()} />
        </div>

        {/* Budget by fiscal year — shows allocation per Nepal BS fiscal year.
            Only rendered when at least one project has a fiscal_year set. */}
        {budgetByFY.some(d => d.fy !== 'Untagged') && (
          <Collapsible defaultOpen={false} id="budget-fy">
          <Card className="overflow-hidden">
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 p-5 text-left hover:bg-muted/30">
              <div>
                <h3 className="font-display text-lg font-semibold">Fiscal year breakdown</h3>
                {untaggedCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Derived from start_date when fiscal_year wasn't set. {untaggedCount} project{untaggedCount !== 1 ? 's' : ''} still untagged.
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-mono">Nepal BS fiscal year · NPR · approved projects</p>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="px-5 pb-5">
            <ResponsiveContainer width="100%" height={Math.max(120, budgetByFY.length * 40)}>
              <BarChart data={budgetByFY} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: number) => {
                    if (v === 0) return '0';
                    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
                    if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
                    if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
                    return String(v);
                  }}
                />
                <YAxis dataKey="fy" type="category" tick={{ fontSize: 11 }} width={68} />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                  formatter={(v: number, _k, entry) => [
                    `${formatNPR(v)}  (${entry.payload.count} project${entry.payload.count === 1 ? '' : 's'})`,
                    'Budget',
                  ]}
                />
                <Bar dataKey="budget" fill="hsl(var(--accent))" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground font-mono uppercase tracking-wider">
                    <th className="pb-1.5 pr-4">Fiscal year</th>
                    <th className="pb-1.5 pr-4 text-right">Projects</th>
                    <th className="pb-1.5 pr-4 text-right">Total budget</th>
                    <th className="pb-1.5 text-right">Avg budget / project</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {budgetByFY.map(({ fy, budget, count }) => (
                    <tr key={fy} className="hover:bg-muted/30">
                      <td className="py-1.5 pr-4 font-medium">{fy}</td>
                      <td className="py-1.5 pr-4 text-right font-mono">{count}</td>
                      <td className="py-1.5 pr-4 text-right font-mono">{budget > 0 ? formatNPR(budget) : '—'}</td>
                      <td className="py-1.5 text-right font-mono text-muted-foreground">
                        {budget > 0 && count > 0 ? formatNPR(Math.round(budget / count)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </CollapsibleContent>
          </Card>
          </Collapsible>
        )}

        {/* Project rating — top 10 best-performing projects.
            Score = status + schedule adherence + budget delivery + activity
            recency (4 dimensions × 25 pts). Editorial: "which projects are
            on track and delivering?" Deep link to the View-all page lives
            in the header. */}
        <Card className="p-5" id="leaderboard">
          <div className="flex items-baseline justify-between mb-4 gap-2 flex-wrap">
            <h3 className="font-display text-lg font-semibold flex items-center gap-2">
              <LeaderboardIcon className="h-4 w-4 text-accent" /> Top-rated projects
            </h3>
            <div className="flex items-center gap-3">
              <p className="text-xs text-muted-foreground font-mono hidden sm:block">performance score · status · schedule · budget · activity</p>
              <Link to="/analytics/ratings" className="text-xs text-accent hover:underline inline-flex items-center gap-1 font-medium">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
          <ProjectLeaderboard projects={projects} />
        </Card>

        {/* Documentation leaderboard — top 10 best-documented projects.
            Score = 10 yes/no signals about which fields are filled in.
            Editorial: "which projects have the most-researched records —
            start your investigation here." */}
        <Card className="p-5" id="documented">
          <div className="flex items-baseline justify-between mb-4 gap-2">
            <h3 className="font-display text-lg font-semibold flex items-center gap-2">
              <DocumentationIcon className="h-4 w-4 text-accent" /> Best-documented projects
            </h3>
            <p className="text-xs text-muted-foreground font-mono">record completeness · 10 fields · top 10</p>
          </div>
          <DocumentationLeaderboard projects={projects} />
        </Card>

        {/* Activity strip — gives the page a time axis */}
        <Card className="p-5" id="activity">
          <div className="flex items-baseline justify-between mb-4 gap-2">
            <h3 className="font-display text-lg font-semibold">30-day activity</h3>
            <p className="text-xs text-muted-foreground font-mono">new projects · updates · detail rows</p>
          </div>
          {activityData.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4">Daily metrics not yet populated (compute_daily_project_metrics runs nightly at 00:05 UTC).</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={activityData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 9 }} interval="preserveStartEnd" minTickGap={28} />
                <YAxis tick={{ fontSize: 9 }} width={28} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                <Area type="monotone" dataKey="projects" stackId="1" fill="hsl(var(--primary))" stroke="hsl(var(--primary))" fillOpacity={0.7} />
                <Area type="monotone" dataKey="updates"  stackId="1" fill="hsl(var(--accent))"  stroke="hsl(var(--accent))"  fillOpacity={0.6} />
                <Area type="monotone" dataKey="details"  stackId="1" fill="hsl(var(--muted-foreground))" stroke="hsl(var(--muted-foreground))" fillOpacity={0.4} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Status distribution as a horizontal stacked bar — readable at 6 slices */}
        <Card className="p-5" id="status">
          <h3 className="font-display text-lg font-semibold mb-3">Status distribution</h3>
          <ResponsiveContainer width="100%" height={70}>
            <BarChart data={statusBarData} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" hide />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                formatter={(v, k) => [v, STATUS_LABELS[String(k)] ?? String(k)]}
              />
              {STATUS_ORDER.map(s => (
                <Bar key={s} dataKey={s} stackId="status" fill={STATUS_FILL[s]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          {/* Legend row — colored dots beside the count so each segment is identifiable
              even when it's too narrow for an inline label. */}
          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-xs">
            {STATUS_ORDER.map(s => (
              <div key={s} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_FILL[s] }} />
                <span className="text-muted-foreground">{STATUS_LABELS[s] ?? s}</span>
                <span className="font-mono font-medium">{(statusBarData[0] as any)[s] ?? 0}</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="p-5" id="sectors">
            <h3 className="font-display text-lg font-semibold mb-4">Projects by sector</h3>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={bySector} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={140} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                <Bar dataKey="value" fill="hsl(var(--accent))" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-5" id="provinces">
            <h3 className="font-display text-lg font-semibold mb-4">Projects by province</h3>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={byProvince} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Worst slips — 10 most-overdue projects still in flight */}
          <Card className="p-5" id="slips">
            <div className="flex items-baseline justify-between mb-1 gap-2">
              <h3 className="font-display text-lg font-semibold flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-destructive" /> Worst schedule slips
              </h3>
              <p className="text-xs text-muted-foreground font-mono">{worstSlips.length} of 10</p>
            </div>
            <p className="text-xs text-muted-foreground mb-3 font-mono">Past expected_completion, not yet marked completed or cancelled.</p>
            {worstSlips.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">No projects past their expected_completion — either everyone's on time or the dates aren't recorded.</div>
            ) : (
              <div className="divide-y divide-border/60">
                {worstSlips.map((p) => (
                  <Link key={p.id} to={`/projects/${p.slug}`} className="flex items-center justify-between gap-3 py-2 hover:bg-muted/30 -mx-2 px-2 rounded">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{p.title}</div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">
                        {p.sector}{p.province ? ` · ${p.province}` : ''}{p.contractor ? ` · ${p.contractor}` : ''}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-mono shrink-0 border-destructive/40 text-destructive">
                      {p.monthsOverdue}mo overdue
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* Stalest data — kept; renamed heading so it's distinguishable from "Worst slips" */}
          <Card className="p-5" id="stalest">
            <h3 className="font-display text-lg font-semibold mb-1">Stalest data</h3>
            <p className="text-xs text-muted-foreground mb-3 font-mono">Approved projects with the oldest comprehensive analysis — never analysed first.</p>
            <div className="divide-y divide-border/60">
              {stalest.map((p) => {
                const lastAnalysedAt = p.last_comprehensive_analysis_at ? new Date(p.last_comprehensive_analysis_at) : null;
                const days = lastAnalysedAt
                  ? Math.max(0, Math.floor((Date.now() - lastAnalysedAt.getTime()) / 86400000))
                  : null;
                return (
                  <Link key={p.id} to={`/projects/${p.slug}`} className="flex items-center justify-between gap-3 py-2 hover:bg-muted/30 -mx-2 px-2 rounded">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{p.title}</div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">
                        Last analysed {lastAnalysedAt ? lastAnalysedAt.toISOString().slice(0, 10) : 'Never'}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                      {days == null ? 'Never' : `${days}d ago`}
                    </Badge>
                  </Link>
                );
              })}
              {stalest.length === 0 && <div className="text-xs text-muted-foreground py-2">No approved projects yet.</div>}
            </div>
          </Card>
        </div>

        <AdSlot slotKey="analytics_bottom" variant="banner" />
      </div>
      <SiteFooter />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wider font-mono text-muted-foreground">{label}</div>
      <div className="font-display text-3xl font-bold mt-2">{value}</div>
      {sub && <div className="text-[10px] font-mono text-muted-foreground mt-1">{sub}</div>}
    </Card>
  );
}

