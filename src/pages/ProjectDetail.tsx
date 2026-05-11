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
import { MapPin, Wallet, Calendar, Building2, HardHat, ExternalLink, ShieldCheck, ShieldAlert, Sparkles, Loader2, Download, ChevronLeft, ChevronRight, Check, X, Trash2, AlertTriangle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { exportProjectReport } from '@/lib/exportPdf';
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/constants';
import { formatNPR } from '@/lib/parseCoords';
import { cn } from '@/lib/utils';
import { ProjectMap } from '@/components/ProjectMap';
import { ComprehensiveSections, SourceLink } from '@/components/ComprehensiveSections';
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
  // ProjectDetail-local pager for record tabs. Mirrors the hook in
  // ComprehensiveSections — 5 rows visible, prev/next slides through the
  // rest. Bulk selection still operates on the full row list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // (defined below `useState` block to keep state declarations together.)

  // Latest analysis run — feeds the Project Record stats line. Same row that
  // ComprehensiveSections.tsx queries internally for its own header; we query
  // it here too rather than threading state across components, since both
  // sections show the same numbers (one analysis populates both).
  const [latestAnalysisRun, setLatestAnalysisRun] = useState<any | null>(null);
  // Per-tab bulk selection. Keys are `${table}:${id}` so the same Set can
  // back all three tabs without leaking selections across them visually.
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Pager state per record tab (5 per page; "Prev / Next" controls below the rows).
  const RECORD_PAGE_SIZE = 5;
  const [milestonesPage, setMilestonesPage] = useState(1);
  const [updatesPage, setUpdatesPage] = useState(1);
  const [sourcesPage, setSourcesPage] = useState(1);
  const toggleRowSelected = (table: string, id: string | number) => {
    const k = `${table}:${id}`;
    setSelectedRows(prev => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
  };
  const toggleAllRowsInTable = (table: string, ids: Array<string | number>, select: boolean) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      for (const id of ids) { const k = `${table}:${id}`; if (select) next.add(k); else next.delete(k); }
      return next;
    });
  };
  // Approve / reject / delete a list of row ids inside one table.
  // Milestones don't carry approval_status so they only support delete; the
  // bar's showApprove/showReject flags handle that on the UI side.
  const performTabBulk = async (table: string, ids: Array<string | number>, action: 'approved' | 'rejected' | 'delete') => {
    if (!ids.length) return;
    const verb = action === 'delete' ? 'Delete' : action === 'approved' ? 'Approve' : 'Reject';
    const label = table.replace('project_', '');
    if (!confirm(`${verb} ${ids.length} ${label} row${ids.length === 1 ? '' : 's'}?`)) return;
    setBulkBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const userId = u.user?.id ?? null;
    let err: string | null = null;
    if (action === 'delete') {
      const { error } = await supabase.from(table as any).delete().in('id', ids);
      if (error) err = error.message;
      else await supabase.from('project_reviews').insert(ids.map(id => ({
        target_table: table, target_id: String(id),
        reviewer_id: userId, reviewer_role: 'admin',
        action: 'rejected', notes: 'Bulk-deleted', was_admin: true,
      })));
    } else {
      // Skip the approval_status update if the table doesn't have one.
      if (table === 'project_milestones') {
        err = 'Milestones do not support approve/reject — use delete instead.';
      } else {
        const { error } = await supabase.from(table as any)
          .update({ approval_status: action, reviewed_by: userId })
          .in('id', ids);
        if (error) err = error.message;
        else await supabase.from('project_reviews').insert(ids.map(id => ({
          target_table: table, target_id: String(id),
          reviewer_id: userId, reviewer_role: 'admin',
          action, notes: `Bulk ${action}`, was_admin: true,
        })));
      }
    }
    setSelectedRows(prev => { const next = new Set(prev); for (const id of ids) next.delete(`${table}:${id}`); return next; });
    setBulkBusy(false);
    if (err) toast.error(`${table}: ${err}`);
    else toast.success(`${ids.length} ${label} row${ids.length === 1 ? '' : 's'} ${action === 'delete' ? 'deleted' : action}`);
    if (p?.id) await loadTabs(p.id);
  };

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
    const reloadLatestRun = async () => {
      const { data } = await supabase
        .from('project_analysis_runs')
        .select('id, started_at, finished_at, status, bucket_status, inserted_per_table, deduped_per_table, errors, narrative_summary, gaps_and_contradictions')
        .eq('project_id', p.id)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setLatestAnalysisRun(data ?? null);
    };
    reloadJob();
    reloadLatestRun();
    const ch = supabase.channel(`project-detail-${p.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_milestones', filter }, () => loadTabs(p.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_updates', filter }, () => loadTabs(p.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_sources', filter }, () => loadTabs(p.id))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${p.id}` }, () => reloadP())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'analysis_jobs', filter }, () => { reloadJob(); reloadLatestRun(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_analysis_runs', filter }, () => reloadLatestRun())
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

      <div className="container py-10 grid lg:grid-cols-[1fr_300px] gap-10">
        <div className="space-y-8">
          {/* Image gallery — sits inside the main column so it aligns with the
              cards below and lets the sidebar ad slot float to the right at
              identical width. Hidden when the project has no pictures yet. */}
          {Array.isArray(p.image_urls) && p.image_urls.length > 0 && (
            <ProjectImageGallery images={p.image_urls} title={p.title} />
          )}

          {/* AI Project Brief — single home for the full AI-generated story
              about the project. Generate composes:
                1) The combined brief paragraphs (weaves identity, comprehensive
                   details, project record, and the latest analysis synthesis)
                2) The most recent AI synthesis paragraph (from project_analysis_runs)
                3) Gaps & contradictions (from project_analysis_runs)
              Export PDF emits all three sections. */}
          <Card className="p-5 border-accent/30 bg-accent/5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-md bg-accent text-accent-foreground flex items-center justify-center">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-sm">AI Project Brief</div>
                  <div className="text-xs text-muted-foreground">Combined summary using identity + comprehensive details + project record.</div>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" onClick={generateSummary} disabled={loadingAi}>
                  {loadingAi ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Generate'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => exportProjectReport(p, aiSummary, milestones, updates, latestAnalysisRun?.narrative_summary ?? null, latestAnalysisRun?.gaps_and_contradictions ?? [])}>
                  <Download className="h-4 w-4" /> Export PDF
                </Button>
              </div>
            </div>

            {aiError ? (
              <p className="text-sm text-destructive">{aiError}</p>
            ) : loadingAi ? (
              <p className="text-sm text-muted-foreground italic">Generating brief…</p>
            ) : aiSummary ? (
              <div className="space-y-4">
                {/* 1. The combined brief paragraphs from ai-project-insights. */}
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{aiSummary}</p>

                {/* 2. AI synthesis from the latest analysis run, when available. */}
                {latestAnalysisRun?.narrative_summary && (
                  <div className="pt-4 border-t border-accent/20">
                    <p className="text-[10px] uppercase tracking-[0.2em] font-mono text-accent mb-1.5 flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3" />
                      AI synthesis · refreshed {relTimeShort(latestAnalysisRun.finished_at ?? latestAnalysisRun.started_at)}
                    </p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{latestAnalysisRun.narrative_summary}</p>
                  </div>
                )}

                {/* 3. Gaps & contradictions banner. */}
                {latestAnalysisRun?.gaps_and_contradictions && latestAnalysisRun.gaps_and_contradictions.length > 0 && (
                  <div className="p-3 rounded-md border border-warning/40 bg-warning/10">
                    <p className="text-xs font-semibold text-warning mb-1.5 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Gaps & contradictions in the available evidence
                    </p>
                    <ul className="space-y-1 text-xs list-disc pl-5">
                      {latestAnalysisRun.gaps_and_contradictions.map((g: string, i: number) => (
                        <li key={i} className="leading-snug">{g}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Click Generate to compose a brief from project identity, comprehensive details, and project record. Export PDF bundles the brief, AI synthesis, and any flagged gaps together.
              </p>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-md bg-accent/15 text-accent flex items-center justify-center">
                  <Calendar className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-sm">Project Record</div>
                  <div className="text-xs text-muted-foreground">
                    Milestones, updates, citations, and project location.
                    <RunStatsLine run={latestAnalysisRun} inFlight={traceInFlight} />
                  </div>
                </div>
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
              {isReviewer && (
                <RecordBulkBar
                  table="project_milestones"
                  rows={milestones}
                  selected={selectedRows}
                  onToggleAll={toggleAllRowsInTable}
                  onAction={performTabBulk}
                  busy={bulkBusy}
                  showApprove={false}
                  showReject={false}
                />
              )}
              {milestones.length === 0 ? <Card className="p-8 text-center text-muted-foreground text-sm">No milestones recorded yet.</Card> : (
                <>
                  {milestones.slice((milestonesPage - 1) * RECORD_PAGE_SIZE, milestonesPage * RECORD_PAGE_SIZE).map(m => (
                    <Card key={m.id} className="p-4 flex gap-4">
                      {isReviewer && (
                        <Checkbox
                          checked={selectedRows.has(`project_milestones:${m.id}`)}
                          onCheckedChange={() => toggleRowSelected('project_milestones', m.id)}
                          aria-label="Select milestone"
                          className="mt-1.5"
                        />
                      )}
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
                          {m.milestone_date && ` · Event: ${m.milestone_date}`}
                        </div>
                        <SourceLink sources={m.sources} />
                      </div>
                    </Card>
                  ))}
                  {milestones.length > RECORD_PAGE_SIZE && (
                    <RecordPager total={milestones.length} page={milestonesPage} onPage={setMilestonesPage} pageSize={RECORD_PAGE_SIZE} />
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="updates" className="space-y-3 mt-4">
              {isReviewer && (
                <RecordBulkBar
                  table="project_updates"
                  rows={updates}
                  selected={selectedRows}
                  onToggleAll={toggleAllRowsInTable}
                  onAction={performTabBulk}
                  busy={bulkBusy}
                />
              )}
              {updates.length === 0 ? <Card className="p-8 text-center text-muted-foreground text-sm">No updates posted.</Card> : (
                <>
                  {updates.slice((updatesPage - 1) * RECORD_PAGE_SIZE, updatesPage * RECORD_PAGE_SIZE).map(u => (
                    <Card key={u.id} className={cn('p-4', u.approval_status === 'pending' && 'border-warning/40 bg-warning/5')}>
                      <div className="flex items-start gap-3">
                        {isReviewer && (
                          <Checkbox
                            checked={selectedRows.has(`project_updates:${u.id}`)}
                            onCheckedChange={() => toggleRowSelected('project_updates', u.id)}
                            aria-label="Select update"
                            className="mt-1"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-mono uppercase tracking-wider text-accent mb-1">
                            {u.update_type ?? 'news'} · {new Date(u.created_at).toLocaleDateString()}
                            {u.approval_status === 'pending' && <span className="ml-2 text-warning">· pending review</span>}
                          </div>
                          <h4 className="font-semibold mb-1">{u.title}</h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{u.content}</p>
                          <SourceLink sources={u.sources} />
                        </div>
                      </div>
                    </Card>
                  ))}
                  {updates.length > RECORD_PAGE_SIZE && (
                    <RecordPager total={updates.length} page={updatesPage} onPage={setUpdatesPage} pageSize={RECORD_PAGE_SIZE} />
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="sources" className="space-y-2 mt-4">
              {isReviewer && (
                <RecordBulkBar
                  table="project_sources"
                  rows={sources}
                  selected={selectedRows}
                  onToggleAll={toggleAllRowsInTable}
                  onAction={performTabBulk}
                  busy={bulkBusy}
                />
              )}
              {sources.length === 0 ? <Card className="p-8 text-center text-muted-foreground text-sm">No sources cited yet.</Card> : (
                <>
                  {sources.slice((sourcesPage - 1) * RECORD_PAGE_SIZE, sourcesPage * RECORD_PAGE_SIZE).map(s => (
                    <Card key={s.id} className={cn('p-4 flex items-center gap-3', s.approval_status === 'pending' && 'border-warning/40 bg-warning/5')}>
                      {isReviewer && (
                        <Checkbox
                          checked={selectedRows.has(`project_sources:${s.id}`)}
                          onCheckedChange={() => toggleRowSelected('project_sources', s.id)}
                          aria-label="Select source"
                        />
                      )}
                      {s.verified ? <ShieldCheck className="h-5 w-5 text-success shrink-0" /> : <ShieldAlert className="h-5 w-5 text-muted-foreground shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <a href={s.url} target="_blank" rel="noreferrer" className="font-medium hover:text-accent inline-flex items-center gap-1.5 truncate">
                          {s.title} <ExternalLink className="h-3 w-3" />
                        </a>
                        <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider mt-0.5">
                          {s.source_type}{s.verified && ' · Verified'}
                          {s.approval_status === 'pending' && <span className="text-warning"> · pending review</span>}
                        </div>
                      </div>
                    </Card>
                  ))}
                  {sources.length > RECORD_PAGE_SIZE && (
                    <RecordPager total={sources.length} page={sourcesPage} onPage={setSourcesPage} pageSize={RECORD_PAGE_SIZE} />
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="map" className="mt-4">
              {p.latitude && p.longitude ? (
                <Card className="overflow-hidden h-[420px]"><ProjectMap projects={[p]} /></Card>
              ) : (
                <Card className="p-8 text-center text-muted-foreground text-sm">No coordinates recorded for this project.</Card>
              )}
            </TabsContent>
            </Tabs>
          </Card>

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

// Compact relative-time label used by the Brief and RunStatsLine.
function relTimeShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} d ago`;
}

// Stats line for the Project Record header — mirrors the RunSummaryLine in
// ComprehensiveSections so both sections show identical "Last run X min ago
// · N hits · +M new · K deduped" text (they share the same underlying run).
function RunStatsLine({ run, inFlight }: { run: any | null; inFlight: boolean }) {
  if (!run && !inFlight) return null;
  if (inFlight) return <span className="ml-1.5 italic">analysis running…</span>;
  if (!run) return null;
  const inserted = Object.values((run.inserted_per_table ?? {}) as Record<string, number>).reduce((a: number, b: number) => a + (b || 0), 0);
  const deduped = Object.values((run.deduped_per_table ?? {}) as Record<string, number>).reduce((a: number, b: number) => a + (b || 0), 0);
  const hits = Object.values((run.bucket_status ?? {}) as Record<string, any>).reduce((a: number, b: any) => a + (b?.hits || 0), 0);
  const iso = run.finished_at ?? run.started_at;
  const when = ((): string => {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.floor(h / 24);
    return `${d} d ago`;
  })();
  return (
    <span className="ml-1.5">
      Last run {when} · {hits} hits · +{inserted} new{deduped ? ` · ${deduped} deduped` : ''}
      {run.status === 'failed' && <span className="text-destructive ml-1">(failed)</span>}
    </span>
  );
}

// Compact pager shared across the three Record tabs. Visually identical to
// the pager in ComprehensiveSections.tsx so the page-controls feel the same
// in both sections.
function RecordPager({ total, page, onPage, pageSize }: { total: number; page: number; onPage: (n: number) => void; pageSize: number }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return (
    <div className="flex items-center justify-between gap-2 pt-2 text-[11px] text-muted-foreground font-mono">
      <span>Showing {start + 1}–{Math.min(start + pageSize, total)} of {total}</span>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1} aria-label="Previous page">
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span>page {page} / {totalPages}</span>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} aria-label="Next page">
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// Inline bulk-action toolbar for the project-record tabs (milestones,
// updates, sources). Same shape as ComprehensiveSections' TabBulkBar — kept
// local here because the tables in this scope have different approval
// shapes (milestones have no approval_status at all, so we accept
// showApprove/showReject flags to hide the buttons that don't apply).
function RecordBulkBar({
  table, rows, selected, onToggleAll, onAction, busy,
  showApprove = true, showReject = true,
}: {
  table: string;
  rows: any[];
  selected: Set<string>;
  onToggleAll: (table: string, ids: Array<string | number>, select: boolean) => void;
  onAction: (table: string, ids: Array<string | number>, action: 'approved' | 'rejected' | 'delete') => void;
  busy: boolean;
  showApprove?: boolean;
  showReject?: boolean;
}) {
  if (rows.length === 0) return null;
  const allKeys = rows.map(r => `${table}:${r.id}`);
  const selKeys = allKeys.filter(k => selected.has(k));
  const selIds: Array<string | number> = selKeys.map(k => {
    const v = k.split(':').slice(1).join(':');
    const n = Number(v);
    return Number.isFinite(n) && String(n) === v ? n : v;
  });
  const allIds: Array<string | number> = rows.map(r => r.id);
  const allSelected = allKeys.length > 0 && selKeys.length === allKeys.length;
  const some = selKeys.length > 0;
  if (!some) return null;
  return (
    <div className="flex items-center justify-between gap-2 p-2 rounded-md border border-info/40 bg-info/5 mb-1 flex-wrap">
      <label className="flex items-center gap-2 cursor-pointer text-xs">
        <Checkbox
          checked={allSelected}
          onCheckedChange={(checked) => onToggleAll(table, allIds, !!checked)}
          aria-label="Select all in this tab"
        />
        <span>{selKeys.length} of {rows.length} selected</span>
      </label>
      <div className="flex items-center gap-1">
        {showApprove && (
          <Button disabled={busy} size="sm" variant="ghost" className="h-7 text-xs text-success hover:bg-success/10" onClick={() => onAction(table, selIds, 'approved')}>
            <Check className="h-3.5 w-3.5 mr-1" /> Approve
          </Button>
        )}
        {showReject && (
          <Button disabled={busy} size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-destructive/10" onClick={() => onAction(table, selIds, 'rejected')}>
            <X className="h-3.5 w-3.5 mr-1" /> Reject
          </Button>
        )}
        <Button disabled={busy} size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-destructive/10" onClick={() => onAction(table, selIds, 'delete')}>
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
        </Button>
      </div>
    </div>
  );
}

// Project photo gallery. Contained width, 16:9 hero, header label + counter
// (no overlay), thumbnail strip with active highlight. Auto-skips images
// that fail to load (Tavily occasionally returns hotlink-protected URLs).
// Click main image to open in a new tab for full-size view.
function ProjectImageGallery({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = useState(0);
  const [broken, setBroken] = useState<Set<number>>(new Set());
  // Auto-skip broken entries when the active index lands on one.
  useEffect(() => {
    if (!broken.has(active)) return;
    for (let i = 0; i < images.length; i++) if (!broken.has(i)) { setActive(i); return; }
  }, [active, broken, images.length]);
  const total = images.length;
  const usableCount = total - broken.size;
  if (usableCount === 0) return null;
  // Active index among usable images (for the "3 of 11" counter).
  const usablePosition = images.slice(0, active + 1).filter((_, i) => !broken.has(i)).length;
  const next = () => {
    for (let step = 1; step <= total; step++) {
      const i = (active + step) % total;
      if (!broken.has(i)) { setActive(i); return; }
    }
  };
  const prev = () => {
    for (let step = 1; step <= total; step++) {
      const i = (active - step + total) % total;
      if (!broken.has(i)) { setActive(i); return; }
    }
  };
  return (
    <Card className="overflow-hidden">
      <div className="p-4">
        {/* Header line — same uppercase mono treatment used elsewhere on the page. */}
        <div className="flex items-baseline justify-between mb-2.5 px-0.5">
          <p className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted-foreground">Photos</p>
          {usableCount > 1 && (
            <p className="text-[10px] font-mono text-muted-foreground">
              {usablePosition} <span className="opacity-50">/</span> {usableCount}
            </p>
          )}
        </div>

        {/* Hero image. aspect 16:9 is gentler than the old 16:7 banner. */}
        <a
          href={images[active]}
          target="_blank"
          rel="noreferrer"
          className="block relative aspect-[16/9] bg-card rounded-lg overflow-hidden ring-1 ring-border group"
          aria-label="Open image full size in new tab"
        >
          <img
            key={images[active]}
            src={images[active]}
            alt={`${title} — photo ${active + 1}`}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.01]"
            referrerPolicy="no-referrer"
            onError={() => setBroken(prev => new Set(prev).add(active))}
            loading="lazy"
          />
          {/* Subtle bottom gradient — keeps any text overlays legible. */}
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/30 to-transparent pointer-events-none" />
          {usableCount > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); prev(); }}
                aria-label="Previous photo"
                className="absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-background/85 hover:bg-background backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); next(); }}
                aria-label="Next photo"
                className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-background/85 hover:bg-background backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}
        </a>

        {/* Thumbnail strip. Active state via border + slight scale; broken hidden. */}
        {usableCount > 1 && (
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1 -mx-0.5 px-0.5 scrollbar-thin">
            {images.map((u, i) => broken.has(i) ? null : (
              <button
                key={u + i}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Show photo ${i + 1}`}
                className={cn(
                  'shrink-0 h-12 w-16 rounded overflow-hidden ring-1 transition-all',
                  i === active
                    ? 'ring-accent ring-2 opacity-100 scale-[1.04]'
                    : 'ring-border opacity-60 hover:opacity-100 hover:ring-foreground/30'
                )}
              >
                <img
                  src={u}
                  alt=""
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={() => setBroken(prev => new Set(prev).add(i))}
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
