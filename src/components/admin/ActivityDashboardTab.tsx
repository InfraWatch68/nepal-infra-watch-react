import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RotateCw } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { toast } from 'sonner';
import { freshnessLabel, FRESHNESS_CLASSES } from '@/lib/freshness';
import { cn } from '@/lib/utils';

type Metric = {
  day: string;
  new_projects: number;
  new_updates: number;
  new_detail_rows: number;
  sherlock_jobs_run: number;
  sherlock_inserted: number;
  sherlock_errors: number;
  analysis_runs: number;
  approvals: number;
  rejections: number;
  computed_at: string;
};

type StaleProject = {
  id: number;
  slug: string;
  title: string;
  province: string | null;
  sector: string;
  status: string;
  last_activity_at: string | null;
};

// Reads daily_project_metrics for the trend chart + table, and pulls the
// 10 stalest approved projects directly from projects.last_activity_at.
// Both data sources are populated by the 20260515 migration (cron nightly +
// trigger-on-write); no LLM tokens consumed by this view.
export function ActivityDashboardTab() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [stale, setStale] = useState<StaleProject[]>([]);
  const [rebuilding, setRebuilding] = useState(false);

  const refresh = useCallback(async () => {
    const [m, s] = await Promise.all([
      supabase.from('daily_project_metrics').select('*').order('day', { ascending: false }).limit(90),
      supabase.from('projects')
        .select('id, slug, title, province, sector, status, last_activity_at')
        .eq('approval_status', 'approved')
        .order('last_activity_at', { ascending: true, nullsFirst: true })
        .limit(10),
    ]);
    setMetrics((m.data ?? []) as Metric[]);
    setStale((s.data ?? []) as StaleProject[]);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const rebuildToday = async () => {
    setRebuilding(true);
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.rpc('rebuild_daily_project_metrics', { p_from: today, p_to: today });
    setRebuilding(false);
    if (error) return toast.error(error.message);
    toast.success("Today's metrics rebuilt.");
    refresh();
  };

  // Chart data is metrics oldest-first; the query is desc so the bottom row is the oldest.
  const chartData = [...metrics].reverse().slice(-30);
  const todayRow = metrics[0];

  return (
    <div className="space-y-4">
      {/* Headline stats — yesterday's row, mirrors the dashboard's "what happened?" framing. */}
      <div className="grid md:grid-cols-4 gap-3">
        <Stat label="New projects (today)" value={todayRow?.new_projects ?? 0} />
        <Stat label="News / updates (today)" value={todayRow?.new_updates ?? 0} />
        <Stat label="Detail rows (today)" value={todayRow?.new_detail_rows ?? 0} />
        <Stat label="Sherlock errors (today)" value={todayRow?.sherlock_errors ?? 0} tone={todayRow && todayRow.sherlock_errors > 0 ? 'warn' : undefined} />
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h3 className="font-display text-base font-semibold">30-day activity</h3>
            <p className="text-[11px] text-muted-foreground font-mono">
              Populated nightly at 00:05 UTC by the <code>compute-daily-project-metrics</code> cron.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={rebuildToday} disabled={rebuilding}>
            {rebuilding ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            Rebuild today
          </Button>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d) => d?.slice(5)} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="new_projects"    name="Projects"     stroke="hsl(var(--accent))"    strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="new_updates"     name="Updates"      stroke="hsl(var(--primary))"   strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="new_detail_rows" name="Detail rows"  stroke="hsl(152 60% 36%)"      strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="sherlock_errors" name="Errors"       stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-display text-base font-semibold mb-2">Stalest approved projects</h3>
          <p className="text-[11px] text-muted-foreground font-mono mb-3">Oldest <code>last_activity_at</code> first — refresh candidates for Layer 2.</p>
          <div className="space-y-2">
            {stale.length === 0 && <div className="text-xs text-muted-foreground">No approved projects yet.</div>}
            {stale.map((p) => {
              const fr = freshnessLabel(p.last_activity_at);
              return (
                <Link
                  key={p.id}
                  to={`/projects/${p.slug}`}
                  className="flex items-center justify-between gap-2 py-1.5 px-2 -mx-2 rounded hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.title}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">
                      {p.sector}{p.province ? ` · ${p.province}` : ''}
                    </div>
                  </div>
                  <Badge variant="outline" className={cn('text-[10px] font-mono shrink-0', FRESHNESS_CLASSES[fr.color])}>
                    {fr.text}
                  </Badge>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card className="p-4 overflow-hidden">
          <h3 className="font-display text-base font-semibold mb-2">Recent daily metrics</h3>
          <p className="text-[11px] text-muted-foreground font-mono mb-3">Latest 14 days · drives the chart above.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3">Day</th>
                  <th className="py-1.5 pr-3 text-right">Proj</th>
                  <th className="py-1.5 pr-3 text-right">Upd</th>
                  <th className="py-1.5 pr-3 text-right">Detail</th>
                  <th className="py-1.5 pr-3 text-right">Jobs</th>
                  <th className="py-1.5 pr-3 text-right">Err</th>
                  <th className="py-1.5 pr-3 text-right">Appr</th>
                  <th className="py-1.5 text-right">Rej</th>
                </tr>
              </thead>
              <tbody>
                {metrics.slice(0, 14).map((m) => (
                  <tr key={m.day} className="border-b border-border/40">
                    <td className="py-1.5 pr-3">{m.day}</td>
                    <td className="py-1.5 pr-3 text-right">{m.new_projects}</td>
                    <td className="py-1.5 pr-3 text-right">{m.new_updates}</td>
                    <td className="py-1.5 pr-3 text-right">{m.new_detail_rows}</td>
                    <td className="py-1.5 pr-3 text-right">{m.sherlock_jobs_run}</td>
                    <td className={cn('py-1.5 pr-3 text-right', m.sherlock_errors > 0 && 'text-destructive')}>{m.sherlock_errors}</td>
                    <td className="py-1.5 pr-3 text-right text-success">{m.approvals}</td>
                    <td className="py-1.5 text-right text-destructive">{m.rejections}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'warn' }) {
  return (
    <Card className={cn('p-3', tone === 'warn' && 'border-warning/40 bg-warning/5')}>
      <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-bold mt-1">{value}</div>
    </Card>
  );
}
