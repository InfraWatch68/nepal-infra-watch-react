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
import { MapPin, Wallet, Calendar, Building2, HardHat, ExternalLink, ShieldCheck, ShieldAlert, Sparkles, Loader2, Download } from 'lucide-react';
import { exportProjectReport } from '@/lib/exportPdf';
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/constants';
import { formatNPR } from '@/lib/parseCoords';
import { cn } from '@/lib/utils';
import { ProjectMap } from '@/components/ProjectMap';
import { ComprehensiveSections } from '@/components/ComprehensiveSections';
import { toast } from 'sonner';

export default function ProjectDetail() {
  const { slug } = useParams();
  const [p, setP] = useState<any>(null);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [updates, setUpdates] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiError, setAiError] = useState<string>('');

  const loadUpdates = useCallback(async (projectId: string) => {
    const { data } = await supabase
      .from('project_updates').select('*')
      .eq('project_id', projectId)
      .eq('approval_status', 'approved')
      .order('created_at', { ascending: false });
    setUpdates(data ?? []);
  }, []);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data: proj } = await supabase.from('projects').select('*').eq('slug', slug).maybeSingle();
      setP(proj);
      if (proj) {
        const [m, s] = await Promise.all([
          supabase.from('project_milestones').select('*').eq('project_id', proj.id).order('order_index'),
          supabase.from('project_sources').select('*').eq('project_id', proj.id).eq('approval_status', 'approved').order('created_at'),
        ]);
        setMilestones(m.data ?? []); setSources(s.data ?? []);
        loadUpdates(proj.id);
      }
    })();
  }, [slug, loadUpdates]);

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
          <Card className="p-5">
            <h3 className="font-display text-lg font-semibold mb-2">Spotted an issue?</h3>
            <p className="text-sm text-muted-foreground mb-3">Submit corrections or additional sources for this project.</p>
            <Button variant="outline" size="sm" className="w-full" asChild><Link to="/dashboard">Contribute</Link></Button>
          </Card>
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

function PostUpdateForm({ projectId, onPosted }: { projectId: string; onPosted: () => void }) {
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
