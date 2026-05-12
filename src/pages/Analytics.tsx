import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AdSlot } from '@/components/AdSlot';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, Legend } from 'recharts';
import { formatNPR } from '@/lib/parseCoords';
import { freshnessLabel, FRESHNESS_CLASSES } from '@/lib/freshness';
import { STATUS_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';

const COLORS = ['hsl(220 60% 14%)', 'hsl(350 78% 48%)', 'hsl(38 92% 50%)', 'hsl(152 60% 36%)', 'hsl(210 90% 50%)', 'hsl(280 60% 50%)', 'hsl(15 85% 55%)'];

export default function Analytics() {
  const [projects, setProjects] = useState<any[]>([]);
  useEffect(() => {
    supabase.from('projects').select('*').eq('approval_status', 'approved')
      .then(({ data }) => setProjects(data ?? []));
  }, []);

  const bySector = Object.entries(projects.reduce((acc: any, p) => {
    acc[p.sector] = (acc[p.sector] ?? 0) + 1; return acc;
  }, {})).map(([name, value]) => ({ name, value }));

  const byProvince = Object.entries(projects.reduce((acc: any, p) => {
    if (p.province) acc[p.province] = (acc[p.province] ?? 0) + 1; return acc;
  }, {})).map(([name, value]) => ({ name, value }));

  const byStatus = Object.entries(projects.reduce((acc: any, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1; return acc;
  }, {})).map(([k, v]) => ({ name: STATUS_LABELS[k] ?? k, value: v }));

  const totalBudget = projects.reduce((s, p) => s + (Number(p.budget_npr) || 0), 0);
  const avgProgress = projects.length ? Math.round(projects.reduce((s, p) => s + (p.progress_percent || 0), 0) / projects.length) : 0;

  // Stalest 10: ascending last_activity_at, NULLs first so projects with no
  // tracked activity float to the top — they're the most useful to refresh.
  const stalest = [...projects]
    .sort((a, b) => {
      const la = a.last_activity_at ? Date.parse(a.last_activity_at) : 0;
      const lb = b.last_activity_at ? Date.parse(b.last_activity_at) : 0;
      return la - lb;
    })
    .slice(0, 10);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <section className="border-b bg-secondary/30">
        <div className="container py-8">
          <p className="text-xs uppercase tracking-[0.2em] font-mono text-accent mb-2">Insights</p>
          <h1 className="font-display text-4xl font-bold">Analytics</h1>
          <p className="text-muted-foreground mt-2">Sector, province and status breakdowns from public data.</p>
        </div>
      </section>

      <div className="container py-8 space-y-6">
        <div className="grid md:grid-cols-4 gap-4">
          <Stat label="Tracked projects" value={projects.length.toString()} />
          <Stat label="Total budget" value={formatNPR(totalBudget)} />
          <Stat label="Avg. progress" value={`${avgProgress}%`} />
          <Stat label="Provinces covered" value={byProvince.length.toString()} />
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="p-5">
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

          <Card className="p-5">
            <h3 className="font-display text-lg font-semibold mb-4">Status distribution</h3>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={byStatus} dataKey="value" nameKey="name" outerRadius={100} label={{ fontSize: 11 }}>
                  {byStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <h3 className="font-display text-lg font-semibold mb-1">Stalest projects</h3>
            <p className="text-xs text-muted-foreground mb-3 font-mono">Approved projects with the oldest tracked activity — readers can flag these for an editor refresh.</p>
            <div className="divide-y divide-border/60">
              {stalest.map((p) => {
                const fr = freshnessLabel(p.last_activity_at);
                return (
                  <Link key={p.id} to={`/projects/${p.slug}`} className="flex items-center justify-between gap-3 py-2 hover:bg-muted/30 -mx-2 px-2 rounded">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{p.title}</div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">{p.sector}{p.province ? ` · ${p.province}` : ''}</div>
                    </div>
                    <Badge variant="outline" className={cn('text-[10px] font-mono shrink-0', FRESHNESS_CLASSES[fr.color])}>{fr.text}</Badge>
                  </Link>
                );
              })}
              {stalest.length === 0 && <div className="text-xs text-muted-foreground py-2">No approved projects yet.</div>}
            </div>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <h3 className="font-display text-lg font-semibold mb-4">Projects by province</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byProvince} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <AdSlot slotKey="analytics_bottom" variant="banner" />
      </div>
      <SiteFooter />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wider font-mono text-muted-foreground">{label}</div>
      <div className="font-display text-3xl font-bold mt-2">{value}</div>
    </Card>
  );
}
