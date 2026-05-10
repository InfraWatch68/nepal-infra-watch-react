import { Link } from 'react-router-dom';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AdSlot } from '@/components/AdSlot';
import { ProjectCard } from '@/components/ProjectCard';
import { ArrowRight, Activity, MapPinned, ShieldCheck, BarChart3, Sparkles, FileSearch } from 'lucide-react';
import { FlowButton } from '@/components/ui/flow-button';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export default function Home() {
  const [recent, setRecent] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, inProgress: 0, completed: 0, delayed: 0 });
  const [brief, setBrief] = useState<{ headline: string; created_at: string } | null>(null);

  useEffect(() => {
    supabase.from('projects').select('*').eq('approval_status', 'approved')
      .order('created_at', { ascending: false }).limit(6)
      .then(({ data }) => setRecent(data ?? []));

    supabase.from('projects').select('status', { count: 'exact' }).eq('approval_status', 'approved')
      .then(({ data, count }) => {
        const c = (s: string) => (data ?? []).filter((d: any) => d.status === s).length;
        setStats({ total: count ?? 0, inProgress: c('in_progress'), completed: c('completed'), delayed: c('delayed') });
      });

    supabase.from('global_briefs').select('headline, created_at')
      .order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) setBrief(data[0] as any);
      });
  }, []);

  const briefStamp = brief
    ? new Date(brief.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()
    : 'TODAY';

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      {/* Hero */}
      <section className="relative gradient-hero text-primary-foreground overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04] bg-[radial-gradient(circle_at_30%_20%,white_1px,transparent_1px)] [background-size:24px_24px]" />
        <div className="container relative py-20 md:py-28 grid md:grid-cols-12 gap-10 items-center">
          <div className="md:col-span-7 space-y-6 animate-fade-in">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/15 border border-accent/30 text-accent text-xs font-mono uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" /> Live · Public Beta
            </div>
            <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.05] text-balance">
              Every road, bridge, and rupee.<br/>
              <span className="text-accent italic">Watched.</span>
            </h1>
            <p className="text-lg text-primary-foreground/75 max-w-2xl leading-relaxed">
              Independent tracking of Nepal's infrastructure projects — verified sources, milestone-by-milestone progress, and citizen-powered reporting from all seven provinces.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link to="/projects"><FlowButton text="Browse projects" /></Link>
              <Button size="lg" variant="outline" className="bg-transparent border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10" asChild>
                <Link to="/map">Open the map</Link>
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-4 pt-8 max-w-xl border-t border-primary-foreground/15">
              {[
                { v: stats.total, l: 'Tracked' },
                { v: stats.inProgress, l: 'Active' },
                { v: stats.completed, l: 'Completed' },
                { v: stats.delayed, l: 'Delayed' },
              ].map(s => (
                <div key={s.l} className="pt-6">
                  <div className="font-display text-3xl font-bold">{s.v}</div>
                  <div className="text-xs uppercase tracking-wider text-primary-foreground/60 mt-1">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="md:col-span-5">
            <Card className="bg-primary-glow/40 backdrop-blur border-primary-foreground/10 text-primary-foreground p-6 shadow-elegant">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="h-4 w-4 text-accent" />
                <span className="text-xs uppercase tracking-wider font-mono text-primary-foreground/70">AI Brief — {briefStamp}</span>
              </div>
              <p className="font-display text-xl leading-snug mb-4">
                {brief
                  ? `"${brief.headline}"`
                  : 'No AI brief published yet — an admin can generate one from the Admin → AI tools panel.'}
              </p>
              <Link to="/analytics" className="text-sm text-accent hover:underline inline-flex items-center gap-1">
                See the full analysis <ArrowRight className="h-3 w-3" />
              </Link>
            </Card>
          </div>
        </div>
      </section>

      {/* Feature strip */}
      <section className="border-b">
        <div className="container py-10 grid md:grid-cols-4 gap-6">
          {[
            { i: MapPinned, t: 'Geo-tagged', d: 'Every project mapped from coordinate strings.' },
            { i: ShieldCheck, t: 'Source-verified', d: 'Citations vetted by reviewers.' },
            { i: BarChart3, t: 'Sector analytics', d: 'Province × sector breakdowns.' },
            { i: Activity, t: 'Live milestones', d: 'Progress updates in real time.' },
          ].map(f => (
            <div key={f.t} className="flex gap-3">
              <div className="h-9 w-9 rounded-md bg-accent/10 text-accent flex items-center justify-center shrink-0">
                <f.i className="h-4 w-4" />
              </div>
              <div>
                <div className="font-semibold text-sm">{f.t}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{f.d}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent projects */}
      <section className="container py-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] font-mono text-accent mb-2">Recently added</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold">Projects under watch</h2>
          </div>
          <Button variant="outline" asChild><Link to="/projects">View all <ArrowRight className="h-4 w-4" /></Link></Button>
        </div>

        {recent.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground">
            <FileSearch className="h-10 w-10 mx-auto mb-3 opacity-40" />
            No approved projects yet. Be the first to submit one.
            <div className="mt-4">
              <Button asChild><Link to="/auth?mode=signup">Submit a project</Link></Button>
            </div>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {recent.map(p => <ProjectCard key={p.id} p={p} />)}
          </div>
        )}

        <div className="mt-10">
          <AdSlot slotKey="home_mid" variant="banner" />
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-secondary/40">
        <div className="container py-16 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-4 text-balance">
              Spotted a project we're missing?
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              Add it with sources and coordinates. Our reviewers verify within 48 hours and the project becomes part of the public record.
            </p>
            <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground" asChild>
              <Link to="/auth?mode=signup">Submit a project</Link>
            </Button>
          </div>
          <AdSlot slotKey="home_cta" variant="sidebar" />
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
