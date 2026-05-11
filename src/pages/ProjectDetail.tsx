import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdSlot } from '@/components/AdSlot';
import { MapPin, Wallet, Calendar, Building2, HardHat, ExternalLink, ShieldCheck, ShieldAlert, Sparkles, Loader2, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { exportProjectReport } from '@/lib/exportPdf';
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/constants';
import { formatNPR } from '@/lib/parseCoords';
import { cn } from '@/lib/utils';
import { ProjectMap } from '@/components/ProjectMap';
import { ComprehensiveSections } from '@/components/ComprehensiveSections';
import { ReviewHistoryIcon } from '@/components/ReviewHistoryIcon';
import { toast } from 'sonner';

export default function ProjectDetail() {
  const { slug } = useParams();
  const { isReviewer } = useAuth();
  const [p, setP] = useState<any>(null);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [updates, setUpdates] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiError, setAiError] = useState<string>('');
  const [traceBusy, setTraceBusy] = useState(false);
  const [traceInFlight, setTraceInFlight] = useState(false);

  // Reviewers see pending rows on the tabs too so they can moderate inline
  // (matches the ComprehensiveSections pattern). Public users see approved-only.
  const sourceStatuses = isReviewer ? ['approved', 'pending'] : ['approved'];

  const loadTabs = useCallback(async (projectId: string | number) => {
    const [m, u, s] = await Promise.all([
      supabase.from('project_milestones').select('*').eq('project_id', projectId).order('order_index'),
      supabase.from('project_updates').select('*').eq('project_id', projectId).in('approval_status', isReviewer ? ['approved', 'pending'] : ['approved']).order('created_at', { ascending: false }),
      supabase.from('project_sources').select('*').eq('project_id', projectId).in('approval_status', isReviewer ? ['approved', 'pending'] : ['approved']).order('created_at'),
    ]);
    setMilestones(m.data ?? []);
    setUpdates(u.data ?? []);
    setSources(s.data ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReviewer]);

  const loadUpdates = useCallback(async (projectId: string | number) => {
    const { data } = await supabase
      .from('project_updates').select('*')
      .eq('project_id', projectId)
      .in('approval_status', sourceStatuses)
      .order('created_at', { ascending: false });
    setUpdates(data ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReviewer]);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data: proj } = await supabase.from('projects').select('*').eq('slug', slug).maybeSingle();
      setP(proj);
      if (proj) await loadTabs(proj.id);
    })();
  }, [slug, loadTabs]);

  // Realtime: re-fetch the 3 tabs + reload project (for image_urls) when an
  // analysis run updates them. Also tracks whether an analysis is in flight
  // so the Trace History button can disable itself.
  useEffect(() => {
    if (!p?.id) return;
    const filter = `project_id=eq.${p.id}`;
    const reloadP = async () => {
      const { data } = await supabase.from('projects').select('*').eq('id', p.id).maybeSingle();
      if (data) setP(data);
    };
    const reloadJob = async () => {
      const { data } = await supabase.from('analysis_jobs').select('id, status').eq('project_id', p.id).in('status', ['queued', 'running']).limit(1).maybeSingle();
      setTraceInFlight(!!data);
    };
    reloadJob();
    const ch = supabase.channel(`project-detail-${p.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_milestones', filter }, () => loadTabs(p.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_updates', filter }, () => loadTabs(p.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_sources', filter }, () => loadTabs(p.id))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${p.id}` }, () => reloadP())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'analysis_jobs', filter }, () => reloadJob())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, loadTabs]);

  // "Trace History" — same async pipeline as Run AI Analysis. The two
  // buttons live on different sections but both trigger one analysis_jobs
  // row; the partial unique index prevents double-enqueue per project. UX
  // wise this means clicking either button populates BOTH sections (7 detail
  // tables + 3 timeline tables) once the run completes.
  const runTraceHistory = async () => {
    if (!p?.id) return;
    setTraceBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('analysis-enqueue', {
        body: { projectId: Number(p.id) },
      });
      if (error) {
        let body: any = null;
        try { body = await (error as any).context?.json?.(); } catch { /* not json */ }
        const code = body?.code ?? (data as any)?.code;
        if (code === 'ALREADY_RUNNING') {
          toast.message('An analysis is already in flight for this project. Watch the Comprehensive section above.');
          return;
        }
        const detail = body?.error ?? error.message ?? 'Edge function failed';
        toast.error(`Could not enqueue: ${detail}`);
        return;
      }
      toast.success('Trace History queued — milestones, updates, sources, and images will appear here in a minute.');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not enqueue Trace History');
    } finally {
      setTraceBusy(false);
    }
  };

  const generateSummary = async () => {
    setLoadingAi(true);
    setAiSummary('');
    setAiError('');
    try {
      const { data, error } = await supabase.functions.invoke('ai-project-insights', {
        body: { mode: 'summary', projectIds: [p.id] }
      });
      if (error) throw error;
      setAiSummary(data.text);
    } catch (e: any) {
      const msg = e.message ?? 'AI summary failed';
      setAiError(msg);
      toast.error(msg);
    } finally { setLoadingAi(false); }
  };

  if (!p) return (
    <div className="min-h-screen flex flex-col"><SiteHeader />
      <div className="container py-20 text-center text-muted-foreground">Loading project...</div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <section className="relative gradient-hero text-primary-foreground">
        <div className="container py-12">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-primary-foreground/60 mb-4">
            <Link to="/projects" className="hover:text-accent">Projects</Link>
            <span>/</span><span>{p.sector}</span>
          </div>
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge className={cn("text-[10px] uppercase tracking-wider font-mono", STATUS_COLORS[p.status])}>{STATUS_LABELS[p.status]}</Badge>
                <Badge variant="outline" className="border-primary-foreground/30 text-primary-foreground">{p.sector}</Badge>
                {p.province && <Badge variant="outline" className="border-primary-foreground/30 text-primary-foreground">{p.province}</Badge>}
              </div>
              <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight text-balance">{p.title}</h1>
              <div className="text-primary-foreground/70"><ReviewHistoryIcon targetTable="projects" targetId={p.id} /></div>
              <p className="text-lg text-primary-foreground/80 leading-relaxed max-w-3xl">{p.description}</p>
            </div>
            <Card className="bg-primary-glow/40 backdrop-blur border-primary-foreground/10 text-primary-foreground p-5 space-y-3">
              <KV icon={Wallet} label="Budget" value={formatNPR(p.budget_npr)} />
              <KV icon={MapPin} label="Location" value={`${p.district ?? '—'}${p.province ? `, ${p.province}` : ''}`} />
              <KV icon={Building2} label="Implementing agency" value={p.implementing_agency ?? '—'} />
              <KV icon={HardHat} label="Contractor" value={p.contractor ?? '—'} />
              <KV icon={Calendar} label="Timeline" value={`${p.start_date ?? 'TBD'} → ${p.expected_completion ?? 'TBD'}`} />
              <div className="pt-3 border-t border-primary-foreground/10">
                <div className="flex justify-between text-xs mb-1.5"><span className="text-primary-foreground/70">Progress</span><span className="font-mono font-semibold">{p.progress_percent ?? 0}%</span></div>
                <div className="h-2 bg-primary-foreground/10 rounded-full overflow-hidden">
                  <div className="h-full bg-accent" style={{ width: `${Math.min(100, p.progress_percent ?? 0)}%` }} />
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Image gallery — Tavily-fetched + manually-added pictures. Hidden when
          the project has nothing yet so the page doesn't show empty filmstrip
          space. */}
      {Array.isArray(p.image_urls) && p.image_urls.length > 0 && (
        <ProjectImageGallery images={p.image_urls} title={p.title} />
      )}

      <div className="container py-10 grid lg:grid-cols-[1fr_300px] gap-10">
        <div className="space-y-8">
          {/* AI Insights */}
          <Card className="p-5 border-accent/30 bg-accent/5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-md bg-accent text-accent-foreground flex items-center justify-center">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-sm">AI Project Brief</div>
                  <div className="text-xs text-muted-foreground">Generated summary of public data</div>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" onClick={generateSummary} disabled={loadingAi}>
                  {loadingAi ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Generate'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => exportProjectReport(p, aiSummary, milestones, updates)}>
                  <Download className="h-4 w-4" /> Export PDF
                </Button>
              </div>
            </div>
            {aiSummary ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{aiSummary}</p>
            ) : aiError ? (
              <p className="text-sm text-destructive">{aiError}</p>
            ) : loadingAi ? (
              <p className="text-sm text-muted-foreground italic">Generating summary…</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">Click Generate to produce an AI summary using project data, milestones, and updates.</p>
            )}
          </Card>

          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold">Project record</div>
              <div className="text-xs text-muted-foreground">Milestones, updates, citations, and project location.</div>
            </div>
            {isReviewer && (
              <Button size="sm" variant="outline" onClick={runTraceHistory} disabled={traceBusy || traceInFlight} title="Fetch milestones, updates, citations, and images from the public record. Shares the analysis queue with Run AI Analysis.">
                {traceBusy || traceInFlight ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {traceInFlight ? 'Tracing…' : 'Trace History'}
              </Button>
            )}
          </div>

          <Tabs defaultValue="milestones">
            <TabsList>
              <TabsTrigger value="milestones">Milestones ({milestones.length})</TabsTrigger>
              <TabsTrigger value="updates">Updates ({updates.length})</TabsTrigger>
              <TabsTrigger value="sources">Sources ({sources.length})</TabsTrigger>
              <TabsTrigger value="map">Map</TabsTrigger>
            </TabsList>

            <TabsContent value="milestones" className="space-y-3 mt-4">
              {milestones.length === 0 ? <Card className="p-8 text-center text-muted-foreground text-sm">No milestones recorded yet.</Card> :
                milestones.map(m => (
                  <Card key={m.id} className="p-4 flex gap-4">
                    <div className={cn("h-2 w-2 rounded-full mt-2 shrink-0",
                      m.status === 'completed' && 'bg-success',
                      m.status === 'in_progress' && 'bg-warning',
                      m.status === 'delayed' && 'bg-destructive',
                      m.status === 'pending' && 'bg-muted-foreground/40'
                    )} />
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="font-semibold">{m.title}</h4>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-mono shrink-0">{m.status}</Badge>
                      </div>
                      {m.description && <p className="text-sm text-muted-foreground mt-1">{m.description}</p>}
                      <div className="text-xs font-mono text-muted-foreground mt-2">
                        Due: {m.due_date ?? '—'}{m.completed_date && ` · Done: ${m.completed_date}`}
                      </div>
                    </div>
                  </Card>
                ))}
            </TabsContent>

            <TabsContent value="updates" className="space-y-3 mt-4">
              {updates.length === 0 ? <Card className="p-8 text-center text-muted-foreground text-sm">No updates posted.</Card> :
                updates.map(u => (
                  <Card key={u.id} className="p-4">
                    <div className="text-xs font-mono uppercase tracking-wider text-accent mb-1">{u.update_type} · {new Date(u.created_at).toLocaleDateString()}</div>
                    <h4 className="font-semibold mb-1">{u.title}</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{u.content}</p>
                  </Card>
                ))}
            </TabsContent>

            <TabsContent value="sources" className="space-y-2 mt-4">
              {sources.length === 0 ? <Card className="p-8 text-center text-muted-foreground text-sm">No sources cited yet.</Card> :
                sources.map(s => (
                  <Card key={s.id} className="p-4 flex items-center gap-3">
                    {s.verified ? <ShieldCheck className="h-5 w-5 text-success shrink-0" /> : <ShieldAlert className="h-5 w-5 text-muted-foreground shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <a href={s.url} target="_blank" rel="noreferrer" className="font-medium hover:text-accent inline-flex items-center gap-1.5 truncate">
                        {s.title} <ExternalLink className="h-3 w-3" />
                      </a>
                      <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider mt-0.5">{s.source_type}{s.verified && ' · Verified'}</div>
                    </div>
                  </Card>
                ))}
            </TabsContent>

            <TabsContent value="map" className="mt-4">
              {p.latitude && p.longitude ? (
                <Card className="overflow-hidden h-[420px]"><ProjectMap projects={[p]} /></Card>
              ) : (
                <Card className="p-8 text-center text-muted-foreground text-sm">No coordinates recorded for this project.</Card>
              )}
            </TabsContent>
          </Tabs>

          <ComprehensiveSections projectId={p.id} projectTitle={p.title} />
        </div>

        <aside className="space-y-6">
          <AdSlot slotKey="project_sidebar" variant="sidebar" />
          <PostUpdateForm projectId={p.id} onPosted={() => loadUpdates(p.id)} />
          <ReportIssueForm projectId={p.id} projectTitle={p.title} />
        </aside>
      </div>

      <SiteFooter />
    </div>
  );
}

function KV({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-4 w-4 text-accent shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider font-mono text-primary-foreground/60">{label}</div>
        <div className="text-sm font-medium truncate">{value}</div>
      </div>
    </div>
  );
}

const updateSchema = z.object({
  title: z.string().trim().min(4).max(200),
  content: z.string().trim().min(10).max(5000),
});

function PostUpdateForm({ projectId, onPosted }: { projectId: string | number; onPosted: () => void }) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = updateSchema.safeParse({ title, content });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setBusy(true);
    const { error } = await supabase.from('project_updates').insert({
      project_id: projectId,
      author_id: user.id,
      title: parsed.data.title,
      content: parsed.data.content,
      update_type: 'progress',
      published: false,
      approval_status: 'pending',
      submitted_by_ai: false,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Update submitted — pending review');
    setTitle(''); setContent('');
    onPosted();
  };

  return (
    <Card className="p-5">
      <h3 className="font-display text-lg font-semibold mb-2">Post an update</h3>
      <form onSubmit={submit} className="space-y-2">
        <Input placeholder="Title" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} />
        <Textarea rows={4} maxLength={5000} placeholder="What's new?" value={content} onChange={e => setContent(e.target.value)} />
        <Button type="submit" disabled={busy} size="sm" className="w-full">
          {busy ? 'Submitting...' : 'Submit for review'}
        </Button>
        <p className="text-xs text-muted-foreground">Updates appear publicly after a reviewer approves them.</p>
      </form>
    </Card>
  );
}

const issueSchema = z.object({
  title: z.string().trim().min(4).max(200),
  content: z.string().trim().min(10).max(5000),
});

function ReportIssueForm({ projectId, projectTitle }: { projectId: string | number; projectTitle: string }) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) {
    return (
      <Card className="p-5">
        <h3 className="font-display text-lg font-semibold mb-2">Spotted an issue?</h3>
        <p className="text-sm text-muted-foreground mb-3">Sign in to flag a correction or missing source for "{projectTitle}".</p>
        <Button variant="outline" size="sm" className="w-full" asChild>
          <Link to={`/auth?mode=signup&next=/projects/${projectTitle}`}>Sign in to report</Link>
        </Button>
      </Card>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = issueSchema.safeParse({ title, content });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setBusy(true);
    const { error } = await supabase.from('project_updates').insert({
      project_id: projectId,
      author_id: user.id,
      title: parsed.data.title,
      content: parsed.data.content,
      update_type: 'issue',
      published: false,
      approval_status: 'pending',
      submitted_by_ai: false,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Issue reported — pending review');
    setTitle(''); setContent('');
  };

  return (
    <Card className="p-5 border-warning/40">
      <h3 className="font-display text-lg font-semibold mb-1">Spotted an issue?</h3>
      <p className="text-sm text-muted-foreground mb-3">Flag a correction, missing source, or factual error for this project.</p>
      <form onSubmit={submit} className="space-y-2">
        <Input placeholder="Issue title" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} />
        <Textarea rows={4} maxLength={5000} placeholder="Describe the issue. Include a source URL if you have one." value={content} onChange={e => setContent(e.target.value)} />
        <Button type="submit" disabled={busy} size="sm" variant="outline" className="w-full">
          {busy ? 'Submitting…' : 'Report issue'}
        </Button>
      </form>
    </Card>
  );
}

// Image carousel for project_images_urls. One hero image at a time with prev/
// next arrows + a thumbnail strip. Handles failed loads quietly by hiding
// broken images (Tavily sometimes returns hotlink-protected URLs).
function ProjectImageGallery({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = useState(0);
  const [broken, setBroken] = useState<Set<number>>(new Set());
  // Auto-skip broken entries when the active index lands on one.
  useEffect(() => {
    if (!broken.has(active)) return;
    for (let i = 0; i < images.length; i++) if (!broken.has(i)) { setActive(i); return; }
  }, [active, broken, images.length]);
  const usable = images.filter((_, i) => !broken.has(i));
  if (usable.length === 0) return null;
  const total = images.length;
  const next = () => { let i = active + 1; while (i < total && broken.has(i)) i++; if (i >= total) i = 0; while (broken.has(i)) i++; setActive(i); };
  const prev = () => { let i = active - 1; while (i >= 0 && broken.has(i)) i--; if (i < 0) i = total - 1; while (broken.has(i) && i >= 0) i--; setActive(Math.max(0, i)); };
  return (
    <section className="border-b">
      <div className="container py-6">
        <div className="relative aspect-[16/7] bg-muted rounded-lg overflow-hidden group">
          <img
            key={images[active]}
            src={images[active]}
            alt={`${title} — image ${active + 1}`}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => setBroken(prev => new Set(prev).add(active))}
          />
          {total > 1 && (
            <>
              <button onClick={prev} aria-label="Previous image"
                className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-background/80 hover:bg-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button onClick={next} aria-label="Next image"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-background/80 hover:bg-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight className="h-5 w-5" />
              </button>
              <div className="absolute bottom-2 right-2 text-[10px] font-mono bg-background/80 text-foreground rounded px-1.5 py-0.5">
                {active + 1} / {total}
              </div>
            </>
          )}
        </div>
        {total > 1 && (
          <div className="flex gap-1.5 mt-3 overflow-x-auto pb-1">
            {images.map((u, i) => broken.has(i) ? null : (
              <button key={u + i} onClick={() => setActive(i)} aria-label={`Show image ${i + 1}`}
                className={cn('shrink-0 h-14 w-20 rounded overflow-hidden border-2', i === active ? 'border-accent' : 'border-transparent opacity-70 hover:opacity-100')}>
                <img src={u} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={() => setBroken(prev => new Set(prev).add(i))} />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
