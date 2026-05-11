import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sparkles, Loader2, ExternalLink, Wallet, FileText, Users, AlertTriangle, BarChart3, Gavel, ShieldCheck, Plus, Pencil, Trash2, Check, X, ChevronDown, RotateCcw } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { formatNPR } from '@/lib/parseCoords';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { DetailRowDialog, DETAIL_TABLES } from '@/components/admin/DetailRowDialog';
import type { DetailsState } from '@/components/SubmitDetailsSection';

const DETAIL_TABLE_NAMES = [
  'project_funding','project_documents','project_stakeholders','project_risks',
  'project_impact','project_procurement','project_compliance',
] as const;
type DetailTable = typeof DETAIL_TABLE_NAMES[number];

type BucketState = { state?: 'queued'|'running'|'succeeded'|'failed'; hits?: number; error?: string };

type AnalysisRun = {
  id: string;
  project_id: number;
  started_at: string;
  finished_at: string | null;
  status: 'queued'|'running'|'succeeded'|'failed'|'cancelled';
  bucket_status: Record<string, BucketState>;
  inserted_per_table: Record<string, number>;
  deduped_per_table: Record<string, number>;
  errors: string[];
  narrative_summary: string | null;
  gaps_and_contradictions: string[];
};

type AnalysisJob = {
  id: string;
  project_id: number;
  run_id: string;
  status: 'queued'|'running'|'succeeded'|'failed'|'cancelled';
  enqueued_at: string;
  last_error: string | null;
};

// Severity badge oval — colored fill, not just border. Used in Risks tab + admin moderation row summary.
const SEVERITY_BADGE: Record<string, string> = {
  low:      'bg-muted/60 text-muted-foreground border-muted',
  medium:   'bg-warning/20 text-warning border-warning/40',
  high:     'bg-destructive/15 text-destructive border-destructive/40',
  critical: 'bg-destructive text-destructive-foreground border-destructive',
};

type Props = { projectId: number | string; projectTitle?: string };

export function ComprehensiveSections({ projectId, projectTitle }: Props) {
  const { isReviewer } = useAuth();
  const [funding, setFunding] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [stakeholders, setStakeholders] = useState<any[]>([]);
  const [risks, setRisks] = useState<any[]>([]);
  const [impact, setImpact] = useState<any[]>([]);
  const [procurement, setProcurement] = useState<any[]>([]);
  const [compliance, setCompliance] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeJob, setActiveJob] = useState<AnalysisJob | null>(null);
  const [latestRun, setLatestRun] = useState<AnalysisRun | null>(null);
  const [recentRuns, setRecentRuns] = useState<AnalysisRun[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // Cross-tab selection. Key shape `${table}:${id}` so the action bar can
  // batch by table and produce one UPDATE/DELETE per table.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Same setter array as before — used both by loadAll and by Realtime re-fetches.
  const setters: Array<(rows: any[]) => void> = [setFunding, setDocuments, setStakeholders, setRisks, setImpact, setProcurement, setCompliance];

  const loadAll = useCallback(async () => {
    // Reviewers see approved + pending rows so they can moderate inline.
    // Public users see only approved (current behaviour preserved).
    const statuses = isReviewer ? ['approved', 'pending'] : ['approved'];
    const results = await Promise.all(DETAIL_TABLE_NAMES.map(t =>
      supabase.from(t).select('*').eq('project_id', projectId).in('approval_status', statuses).order('created_at', { ascending: false })
    ));
    results.forEach((r, i) => setters[i](r.data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, isReviewer]);

  const loadRunMeta = useCallback(async () => {
    const { data: runs } = await supabase
      .from('project_analysis_runs')
      .select('*')
      .eq('project_id', projectId)
      .order('started_at', { ascending: false })
      .limit(5);
    const list = (runs ?? []) as AnalysisRun[];
    setRecentRuns(list);
    setLatestRun(list[0] ?? null);

    const { data: job } = await supabase
      .from('analysis_jobs')
      .select('*')
      .eq('project_id', projectId)
      .in('status', ['queued', 'running'])
      .order('enqueued_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setActiveJob((job ?? null) as AnalysisJob | null);
  }, [projectId]);

  useEffect(() => {
    loadAll();
    loadRunMeta();
  }, [loadAll, loadRunMeta]);

  // Realtime: any change to this project's runs/jobs/detail tables re-fetches.
  // One channel covers everything to keep the wire footprint small.
  useEffect(() => {
    const filter = `project_id=eq.${projectId}`;
    const ch = supabase.channel(`project-${projectId}-analysis`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'analysis_jobs', filter }, () => loadRunMeta())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_analysis_runs', filter }, () => loadRunMeta());
    for (const t of DETAIL_TABLE_NAMES) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter }, () => loadAll());
    }
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, loadAll, loadRunMeta]);

  const deleteRow = async (bucket: keyof DetailsState, id: string) => {
    if (!confirm('Delete this row? This cannot be undone.')) return;
    const tbl = DETAIL_TABLES[bucket];
    const { error } = await supabase.from(tbl as any).delete().eq('id', id);
    if (error) return toast.error(error.message);
    await supabase.from('project_reviews').insert({
      target_table: tbl, target_id: String(id),
      reviewer_id: (await supabase.auth.getUser()).data.user?.id ?? null,
      reviewer_role: 'admin', action: 'rejected', notes: 'Moderator deleted row',
      was_admin: true,
    });
    toast.success('Row deleted');
    loadAll();
  };

  // Inline approve/reject for AI-suggested pending rows. Mirrors deleteRow's
  // review-log pattern so audit-trail consumers see one shape regardless of
  // whether the action came from this page or the admin queue.
  const moderateRow = async (bucket: keyof DetailsState, id: string, action: 'approved' | 'rejected') => {
    const tbl = DETAIL_TABLES[bucket];
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from(tbl as any)
      .update({ approval_status: action, reviewed_by: u.user?.id ?? null })
      .eq('id', id);
    if (error) return toast.error(error.message);
    await supabase.from('project_reviews').insert({
      target_table: tbl, target_id: String(id),
      reviewer_id: u.user?.id ?? null,
      reviewer_role: 'admin',
      action,
      notes: action === 'approved' ? 'Inline approved on project page' : 'Inline rejected on project page',
      was_admin: true,
    });
    toast.success(action === 'approved' ? 'Row approved' : 'Row rejected');
    // Realtime will re-fire loadAll, but this gives instant feedback.
    loadAll();
  };

  const runAnalysis = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('analysis-enqueue', {
        body: { projectId: Number(projectId) },
      });
      if (error) {
        // supabase-js packages non-2xx into FunctionsHttpError with the
        // response on .context (NOT on data). Parse the body so we can
        // distinguish our structured 409 ALREADY_RUNNING from random 500s.
        let body: any = null;
        try { body = await (error as any).context?.json?.(); } catch { /* non-JSON */ }
        const code = body?.code ?? (data as any)?.code;
        if (code === 'ALREADY_RUNNING') {
          toast.message('An analysis is already in flight for this project. Watch the bucket progress above.');
          loadRunMeta();
          return;
        }
        const detail = body?.error ?? error.message ?? 'Edge function failed';
        toast.error(`Could not enqueue analysis: ${detail}`);
        return;
      }
      toast.success('Analysis queued — bucket progress will appear here in a moment.');
      loadRunMeta();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not enqueue analysis');
    } finally {
      setBusy(false);
    }
  };

  // Run-in-flight cue: disable the button while a queued/running job exists.
  const runInFlight = !!activeJob;

  // ─── Bulk selection helpers ────────────────────────────────────────────────
  const toggleSelected = (table: DetailTable, id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      const k = `${table}:${id}`;
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  // Bulk select/deselect every row in a given table. Driven by the TabBulkBar's
  // master checkbox; we receive the raw row ids and prefix them ourselves.
  const toggleAllInTable = (table: DetailTable | string, ids: string[], select: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      for (const id of ids) {
        const k = `${table}:${id}`;
        if (select) next.add(k); else next.delete(k);
      }
      return next;
    });
  };

  // Adapter so TabBulkBar can call our table-scoped performBulk.
  const handleTabAction = (table: DetailTable | string, ids: string[], action: 'approved' | 'rejected' | 'delete') => {
    void performBulk(table as DetailTable, ids, action);
  };

  // Per-table bulk action. Each tab's TabBulkBar passes its own list of row
  // IDs (scoped to one detail table) so the confirm copy + result toast
  // describe a single bucket. After completion we trim only the keys we
  // touched out of the global selection set, so a user can keep moderating
  // other tabs without losing their picks.
  const performBulk = async (table: DetailTable, ids: string[], action: 'approved' | 'rejected' | 'delete') => {
    if (ids.length === 0) return;
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
    // Trim only the keys we acted on out of the selection set.
    setSelected(prev => {
      const next = new Set(prev);
      for (const id of ids) next.delete(`${table}:${id}`);
      return next;
    });
    setBulkBusy(false);
    if (err) toast.error(`${table}: ${err}`);
    else toast.success(`${ids.length} ${label} row${ids.length === 1 ? '' : 's'} ${action === 'delete' ? 'deleted' : action}`);
    loadAll();
  };

  // Cancel an active analysis job mid-flight. For 'queued' the cron will
  // skip it next tick; for 'running' the edge function may still finish and
  // burn tokens — we just mark intent so the UI doesn't lie.
  const cancelActiveAnalysis = async () => {
    if (!activeJob) return;
    if (activeJob.status === 'running'
      && !confirm('Analysis is mid-flight. The edge function may still complete and burn tokens; the UI will mark it cancelled. Proceed?')) return;
    const { error: jobErr } = await supabase.from('analysis_jobs')
      .update({ status: 'cancelled', finished_at: new Date().toISOString(), last_error: 'Cancelled by operator' })
      .eq('id', activeJob.id).in('status', ['queued', 'running']);
    if (jobErr) return toast.error(jobErr.message);
    await supabase.from('project_analysis_runs')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', activeJob.run_id).in('status', ['queued', 'running']);
    toast.success('Analysis cancelled');
    loadRunMeta();
  };

  // Hard reset — wipe every AI-submitted row across the 7 detail tables for
  // THIS project. Lets the operator start clean before re-running.
  const resetAllAiRows = async () => {
    const ok = confirm('Delete ALL AI-submitted rows for this project across funding / documents / stakeholders / risks / impact / procurement / compliance? Approved rows are deleted too. Manual entries (submitted_by_ai=false) stay intact. This cannot be undone.');
    if (!ok) return;
    setBulkBusy(true);
    const errors: string[] = [];
    let total = 0;
    for (const t of DETAIL_TABLE_NAMES) {
      const { error, count } = await supabase.from(t).delete({ count: 'exact' })
        .eq('project_id', projectId).eq('submitted_by_ai', true);
      if (error) errors.push(`${t}: ${error.message}`);
      else total += (count ?? 0);
    }
    setBulkBusy(false);
    if (errors.length > 0) toast.error(`Wiped ${total}, errors: ${errors.join('; ').slice(0, 200)}`);
    else toast.success(`Wiped ${total} AI-submitted row${total === 1 ? '' : 's'} for this project. Ready for a fresh run.`);
    clearSelection();
    loadAll();
  };

  // Bulk-approve pool: pending AI rows with confidence_score >= 0.85 across all
  // 7 tables. Counted from already-loaded data so the badge updates instantly
  // as the reviewer works.
  const HIGH_CONF_THRESHOLD = 0.85;
  const bucketsRefByTable: Array<[DetailTable, any[]]> = [
    ['project_funding', funding],
    ['project_documents', documents],
    ['project_stakeholders', stakeholders],
    ['project_risks', risks],
    ['project_impact', impact],
    ['project_procurement', procurement],
    ['project_compliance', compliance],
  ];
  const highConfPending = useMemo(() => {
    let n = 0;
    for (const [, rows] of bucketsRefByTable) {
      for (const r of rows) {
        if (r.approval_status === 'pending'
          && typeof r.confidence_score === 'number'
          && r.confidence_score >= HIGH_CONF_THRESHOLD) n += 1;
      }
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funding, documents, stakeholders, risks, impact, procurement, compliance]);

  const bulkApproveHighConfidence = async () => {
    if (highConfPending === 0) return;
    if (!confirm(`Approve ${highConfPending} pending row${highConfPending === 1 ? '' : 's'} with AI confidence ≥ ${HIGH_CONF_THRESHOLD}? Lower-confidence rows stay pending for individual review.`)) return;
    const { data: u } = await supabase.auth.getUser();
    const userId = u.user?.id ?? null;
    let approved = 0;
    const errors: string[] = [];
    for (const [table, rows] of bucketsRefByTable) {
      const ids = rows
        .filter(r => r.approval_status === 'pending'
          && typeof r.confidence_score === 'number'
          && r.confidence_score >= HIGH_CONF_THRESHOLD)
        .map(r => r.id);
      if (ids.length === 0) continue;
      const { error: upErr } = await supabase.from(table as any).update({ approval_status: 'approved', reviewed_by: userId }).in('id', ids);
      if (upErr) { errors.push(`${table}: ${upErr.message}`); continue; }
      // One project_reviews entry per row so the audit trail matches the
      // single-row Approve path.
      const reviewRows = ids.map(id => ({
        target_table: table, target_id: String(id),
        reviewer_id: userId, reviewer_role: 'admin',
        action: 'approved',
        notes: `Bulk-approved (AI confidence ≥ ${HIGH_CONF_THRESHOLD})`,
        was_admin: true,
      }));
      await supabase.from('project_reviews').insert(reviewRows);
      approved += ids.length;
    }
    if (errors.length > 0) toast.error(`Approved ${approved}, with errors: ${errors.join('; ').slice(0, 200)}`);
    else toast.success(`Approved ${approved} high-confidence row${approved === 1 ? '' : 's'}`);
    loadAll();
  };

  const counts = {
    funding: funding.length, documents: documents.length, stakeholders: stakeholders.length,
    risks: risks.length, impact: impact.length, procurement: procurement.length, compliance: compliance.length,
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-accent/15 text-accent flex items-center justify-center">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div>
            <div className="font-semibold text-sm">Comprehensive Project Details</div>
            <div className="text-xs text-muted-foreground">
              Financing, documents, stakeholders, risks, impact, procurement, compliance.
              <RunSummaryLine latestRun={latestRun} runInFlight={runInFlight} />
            </div>
          </div>
        </div>
        {isReviewer && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {highConfPending > 0 && (
              <Button size="sm" variant="outline" onClick={bulkApproveHighConfidence} title={`Approve all pending rows with AI confidence ≥ ${HIGH_CONF_THRESHOLD}`}>
                <Check className="h-4 w-4" />
                Approve {highConfPending} high-conf
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={resetAllAiRows} disabled={bulkBusy} title="Delete every AI-submitted row for this project (approved + pending). Manual entries stay.">
              <RotateCcw className="h-4 w-4" />
              Reset AI rows
            </Button>
            <Button size="sm" onClick={runAnalysis} disabled={busy || runInFlight}>
              {busy || runInFlight ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {runInFlight ? 'Analysis in flight…' : 'Run AI Analysis'}
            </Button>
            {runInFlight && (
              <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={cancelActiveAnalysis} title="Cancel the in-flight analysis. Already-spent tokens are not refunded.">
                <X className="h-4 w-4" /> Cancel
              </Button>
            )}
          </div>
        )}
      </div>


      {/* Live per-bucket progress strip while a run is queued/running. */}
      {runInFlight && latestRun && (
        <BucketProgressStrip run={latestRun} />
      )}

      {/* AI-written 2-3 paragraph synthesis from the most recent successful run. */}
      {latestRun?.narrative_summary && (
        <NarrativeSummary text={latestRun.narrative_summary} updatedAt={latestRun.finished_at ?? latestRun.started_at} />
      )}

      {/* Explicit gaps + contradictions callout. Above the tabs so it's not buried. */}
      {latestRun && latestRun.gaps_and_contradictions?.length > 0 && (
        <GapsBanner items={latestRun.gaps_and_contradictions} />
      )}

      <Tabs defaultValue="funding">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="funding" className="gap-1"><Wallet className="h-3.5 w-3.5" />Funding ({counts.funding})</TabsTrigger>
          <TabsTrigger value="documents" className="gap-1"><FileText className="h-3.5 w-3.5" />Documents ({counts.documents})</TabsTrigger>
          <TabsTrigger value="stakeholders" className="gap-1"><Users className="h-3.5 w-3.5" />Stakeholders ({counts.stakeholders})</TabsTrigger>
          <TabsTrigger value="risks" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" />Risks ({counts.risks})</TabsTrigger>
          <TabsTrigger value="impact" className="gap-1"><BarChart3 className="h-3.5 w-3.5" />Impact ({counts.impact})</TabsTrigger>
          <TabsTrigger value="procurement" className="gap-1"><Gavel className="h-3.5 w-3.5" />Procurement ({counts.procurement})</TabsTrigger>
          <TabsTrigger value="compliance" className="gap-1"><ShieldCheck className="h-3.5 w-3.5" />Compliance ({counts.compliance})</TabsTrigger>
        </TabsList>

        <TabsContent value="funding" className="space-y-2 mt-4">
          {isReviewer && <TabBulkBar table="project_funding" rows={funding} selected={selected} onToggleAll={toggleAllInTable} onAction={handleTabAction} busy={bulkBusy} />}
          <ModToolbar bucket="funding" projectId={projectId} isReviewer={isReviewer} onSaved={loadAll} />
          {funding.length === 0 ? <Empty msg="No funding records yet." /> : funding.map(f => (
            <Card key={f.id} className={cn("p-4", f.approval_status === 'pending' && 'border-warning/40 bg-warning/5')}>
              <RowMetaBar bucket="funding" row={f} isReviewer={isReviewer} onModerate={moderateRow} table="project_funding" selected={selected.has(`project_funding:${f.id}`)} onToggleSelect={toggleSelected} />
              <div className="flex items-start justify-between gap-3 mb-1">
                <h4 className="font-semibold">{f.source_name}</h4>
                <Badge variant="outline" className="text-[10px] uppercase font-mono shrink-0">{f.source_type}</Badge>
              </div>
              <div className="grid sm:grid-cols-3 gap-2 text-xs text-muted-foreground font-mono">
                <span>NPR: {f.amount_npr ? formatNPR(f.amount_npr) : '—'}</span>
                <span>USD: {f.amount_usd ? `$${Number(f.amount_usd).toLocaleString()}` : '—'}</span>
                <span>Disbursed: {f.disbursed_amount ? formatNPR(f.disbursed_amount) : '—'}</span>
              </div>
              {f.lender_terms && <p className="text-xs mt-2 text-muted-foreground">Terms: {f.lender_terms}</p>}
              {f.notes && <p className="text-sm mt-1">{f.notes}</p>}
              <SourceLink url={f.source_url} sources={f.sources} />
              <ModRowControls bucket="funding" row={f} isReviewer={isReviewer} onSaved={loadAll} onDelete={() => deleteRow('funding', f.id)} />
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="documents" className="space-y-2 mt-4">
          {isReviewer && <TabBulkBar table="project_documents" rows={documents} selected={selected} onToggleAll={toggleAllInTable} onAction={handleTabAction} busy={bulkBusy} />}
          <ModToolbar bucket="documents" projectId={projectId} isReviewer={isReviewer} onSaved={loadAll} />
          {documents.length === 0 ? <Empty msg="No documents linked yet." /> : documents.map(d => (
            <Card key={d.id} className={cn("p-4", d.approval_status === 'pending' && 'border-warning/40 bg-warning/5')}>
              <RowMetaBar bucket="documents" row={d} isReviewer={isReviewer} onModerate={moderateRow} table="project_documents" selected={selected.has(`project_documents:${d.id}`)} onToggleSelect={toggleSelected} />
              <div className="flex items-start justify-between gap-3 mb-1">
                <a href={d.url} target="_blank" rel="noreferrer" className="font-semibold hover:text-accent inline-flex items-center gap-1.5">
                  {d.title} <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <Badge variant="outline" className="text-[10px] uppercase font-mono shrink-0">{d.doc_type}</Badge>
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                {d.source_org && <>Source: {d.source_org}</>}
                {d.published_at && <> · Published: {d.published_at}</>}
                {d.language && <> · Lang: {d.language}</>}
              </div>
              {d.notes && <p className="text-sm mt-2">{d.notes}</p>}
              <ModRowControls bucket="documents" row={d} isReviewer={isReviewer} onSaved={loadAll} onDelete={() => deleteRow('documents', d.id)} />
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="stakeholders" className="space-y-2 mt-4">
          {isReviewer && <TabBulkBar table="project_stakeholders" rows={stakeholders} selected={selected} onToggleAll={toggleAllInTable} onAction={handleTabAction} busy={bulkBusy} />}
          <ModToolbar bucket="stakeholders" projectId={projectId} isReviewer={isReviewer} onSaved={loadAll} />
          {stakeholders.length === 0 ? <Empty msg="No stakeholders recorded yet." /> : stakeholders.map(s => (
            <Card key={s.id} className={cn("p-4", s.approval_status === 'pending' && 'border-warning/40 bg-warning/5')}>
              <RowMetaBar bucket="stakeholders" row={s} isReviewer={isReviewer} onModerate={moderateRow} table="project_stakeholders" selected={selected.has(`project_stakeholders:${s.id}`)} onToggleSelect={toggleSelected} />
              <div className="flex items-start justify-between gap-3 mb-1">
                <h4 className="font-semibold">{s.org_name}</h4>
                <Badge variant="outline" className="text-[10px] uppercase font-mono shrink-0">{s.role.replace(/_/g, ' ')}</Badge>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                {s.contact_name && <div>Contact: {s.contact_name}</div>}
                {s.contact_email && <div>Email: <a href={`mailto:${s.contact_email}`} className="hover:text-accent">{s.contact_email}</a></div>}
                {s.contact_phone && <div>Phone: {s.contact_phone}</div>}
                {s.country && <div>Country: {s.country}</div>}
                {s.website && <div><a href={s.website} target="_blank" rel="noreferrer" className="hover:text-accent inline-flex items-center gap-1">Website <ExternalLink className="h-3 w-3" /></a></div>}
              </div>
              {s.notes && <p className="text-sm mt-2">{s.notes}</p>}
              <SourceLink url={s.source_url} sources={s.sources} />
              <ModRowControls bucket="stakeholders" row={s} isReviewer={isReviewer} onSaved={loadAll} onDelete={() => deleteRow('stakeholders', s.id)} />
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="risks" className="space-y-2 mt-4">
          {isReviewer && <TabBulkBar table="project_risks" rows={risks} selected={selected} onToggleAll={toggleAllInTable} onAction={handleTabAction} busy={bulkBusy} />}
          <ModToolbar bucket="risks" projectId={projectId} isReviewer={isReviewer} onSaved={loadAll} />
          {risks.length === 0 ? <Empty msg="No risks logged yet." /> : risks.map(r => (
            <Card key={r.id} className={cn("p-4 border-l-4",
              r.severity === 'critical' && 'border-l-destructive',
              r.severity === 'high' && 'border-l-destructive/70',
              r.severity === 'medium' && 'border-l-warning',
              r.severity === 'low' && 'border-l-muted-foreground/40',
              r.approval_status === 'pending' && 'bg-warning/5')}>
              <RowMetaBar bucket="risks" row={r} isReviewer={isReviewer} onModerate={moderateRow} table="project_risks" selected={selected.has(`project_risks:${r.id}`)} onToggleSelect={toggleSelected} />
              <div className="flex items-start justify-between gap-3 mb-1">
                <h4 className="font-semibold">{r.title}</h4>
                <div className="flex gap-1.5 shrink-0">
                  <Badge className={cn('text-[10px] uppercase font-mono border', SEVERITY_BADGE[r.severity] ?? SEVERITY_BADGE.low)}>{r.severity}</Badge>
                  <Badge variant="outline" className="text-[10px] uppercase font-mono">{r.status}</Badge>
                </div>
              </div>
              <div className="text-xs text-muted-foreground font-mono mb-1">
                {r.category}{r.reported_at && ` · Reported ${r.reported_at}`}{r.resolved_at && ` · Resolved ${r.resolved_at}`}
              </div>
              {r.description && <p className="text-sm mt-1">{r.description}</p>}
              <SourceLink url={r.source_url} sources={r.sources} />
              <ModRowControls bucket="risks" row={r} isReviewer={isReviewer} onSaved={loadAll} onDelete={() => deleteRow('risks', r.id)} />
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="impact" className="space-y-2 mt-4">
          {isReviewer && <TabBulkBar table="project_impact" rows={impact} selected={selected} onToggleAll={toggleAllInTable} onAction={handleTabAction} busy={bulkBusy} />}
          <ModToolbar bucket="impact" projectId={projectId} isReviewer={isReviewer} onSaved={loadAll} />
          {impact.length === 0 ? <Empty msg="No impact metrics yet." /> : impact.map(i => (
            <Card key={i.id} className={cn("p-4", i.approval_status === 'pending' && 'border-warning/40 bg-warning/5')}>
              <RowMetaBar bucket="impact" row={i} isReviewer={isReviewer} onModerate={moderateRow} table="project_impact" selected={selected.has(`project_impact:${i.id}`)} onToggleSelect={toggleSelected} />
              <div className="flex items-start justify-between gap-3 mb-1">
                <h4 className="font-semibold capitalize">{i.metric_type.replace(/_/g, ' ')}</h4>
                {i.measured_at && <Badge variant="outline" className="text-[10px] font-mono shrink-0">{i.measured_at}</Badge>}
              </div>
              <div className="grid sm:grid-cols-3 gap-2 text-xs text-muted-foreground font-mono">
                <span>Value: {i.metric_value ?? '—'} {i.unit ?? ''}</span>
                <span>Baseline: {i.baseline_value ?? '—'}</span>
                <span>Target: {i.target_value ?? '—'}</span>
              </div>
              {i.methodology && <p className="text-xs mt-2 text-muted-foreground">Method: {i.methodology}</p>}
              {i.notes && <p className="text-sm mt-1">{i.notes}</p>}
              <SourceLink url={i.source_url} sources={i.sources} />
              <ModRowControls bucket="impact" row={i} isReviewer={isReviewer} onSaved={loadAll} onDelete={() => deleteRow('impact', i.id)} />
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="procurement" className="space-y-2 mt-4">
          {isReviewer && <TabBulkBar table="project_procurement" rows={procurement} selected={selected} onToggleAll={toggleAllInTable} onAction={handleTabAction} busy={bulkBusy} />}
          <ModToolbar bucket="procurement" projectId={projectId} isReviewer={isReviewer} onSaved={loadAll} />
          {procurement.length === 0 ? <Empty msg="No procurement records yet." /> : procurement.map(p => (
            <Card key={p.id} className={cn("p-4", p.approval_status === 'pending' && 'border-warning/40 bg-warning/5')}>
              <RowMetaBar bucket="procurement" row={p} isReviewer={isReviewer} onModerate={moderateRow} table="project_procurement" selected={selected.has(`project_procurement:${p.id}`)} onToggleSelect={toggleSelected} />
              <div className="flex items-start justify-between gap-3 mb-1">
                {p.tender_url ? (
                  <a href={p.tender_url} target="_blank" rel="noreferrer" className="font-semibold hover:text-accent inline-flex items-center gap-1.5">
                    {p.tender_title} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (<h4 className="font-semibold">{p.tender_title}</h4>)}
                <Badge variant="outline" className="text-[10px] uppercase font-mono shrink-0">{p.status}</Badge>
              </div>
              <div className="grid sm:grid-cols-2 gap-1 text-xs text-muted-foreground font-mono">
                {p.tender_id_external && <span>Tender ID: {p.tender_id_external}</span>}
                {p.contract_value_npr && <span>Value: {formatNPR(p.contract_value_npr)}</span>}
                {p.awardee_name && <span>Awardee: {p.awardee_name}</span>}
                {p.contract_type && <span>Type: {p.contract_type}</span>}
                {p.tender_published_at && <span>Published: {p.tender_published_at}</span>}
                {p.bid_open_at && <span>Bid open: {p.bid_open_at}</span>}
                {p.contract_awarded_at && <span>Awarded: {p.contract_awarded_at}</span>}
              </div>
              {p.notes && <p className="text-sm mt-2">{p.notes}</p>}
              <SourceLink url={p.source_url} sources={p.sources} />
              <ModRowControls bucket="procurement" row={p} isReviewer={isReviewer} onSaved={loadAll} onDelete={() => deleteRow('procurement', p.id)} />
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="compliance" className="space-y-2 mt-4">
          {isReviewer && <TabBulkBar table="project_compliance" rows={compliance} selected={selected} onToggleAll={toggleAllInTable} onAction={handleTabAction} busy={bulkBusy} />}
          <ModToolbar bucket="compliance" projectId={projectId} isReviewer={isReviewer} onSaved={loadAll} />
          {compliance.length === 0 ? <Empty msg="No compliance items yet." /> : compliance.map(c => (
            <Card key={c.id} className={cn("p-4", c.approval_status === 'pending' && 'border-warning/40 bg-warning/5')}>
              <RowMetaBar bucket="compliance" row={c} isReviewer={isReviewer} onModerate={moderateRow} table="project_compliance" selected={selected.has(`project_compliance:${c.id}`)} onToggleSelect={toggleSelected} />
              <div className="flex items-start justify-between gap-3 mb-1">
                <h4 className="font-semibold capitalize">{c.item_type.replace(/_/g, ' ')}</h4>
                <Badge variant="outline" className={cn("text-[10px] uppercase font-mono shrink-0",
                  c.status === 'approved' && 'border-success text-success',
                  c.status === 'rejected' && 'border-destructive text-destructive',
                  (c.status === 'blacklisted' || c.status === 'pending') && 'border-warning text-warning'
                )}>{c.status.replace(/_/g, ' ')}</Badge>
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                {c.authority && <>Authority: {c.authority}</>}
                {c.decided_at && <> · Decided: {c.decided_at}</>}
              </div>
              {c.finding && <p className="text-sm mt-2"><strong>Finding:</strong> {c.finding}</p>}
              {c.notes && <p className="text-sm mt-1 text-muted-foreground">{c.notes}</p>}
              {c.document_url && (
                <a href={c.document_url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline inline-flex items-center gap-1 mt-2">
                  View document <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <SourceLink url={c.source_url} sources={c.sources} />
              <ModRowControls bucket="compliance" row={c} isReviewer={isReviewer} onSaved={loadAll} onDelete={() => deleteRow('compliance', c.id)} />
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {recentRuns.length > 0 && (
        <RunHistoryExpander runs={recentRuns} open={showHistory} onToggle={() => setShowHistory(v => !v)} />
      )}
    </Card>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="p-8 text-center text-muted-foreground text-sm border rounded-md">{msg}</div>;
}

// Moderator-only toolbar above each tab's row list. Surfaces the
// "+ Add row" action that opens a DetailRowDialog in add mode.
function ModToolbar({ bucket, projectId, isReviewer, onSaved }: {
  bucket: keyof DetailsState; projectId: number | string; isReviewer: boolean; onSaved: () => void;
}) {
  if (!isReviewer) return null;
  return (
    <div className="flex justify-end">
      <DetailRowDialog
        mode="add" kind={bucket} projectId={projectId} onSaved={onSaved}
        trigger={
          <Button size="sm" variant="outline" className="text-xs">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add row
          </Button>
        }
      />
    </div>
  );
}

// Moderator-only per-card controls — Edit (opens DetailRowDialog in edit mode)
// and Delete (with confirm). Hidden for contributors so the public detail view
// stays uncluttered.
function ModRowControls({ bucket, row, isReviewer, onSaved, onDelete }: {
  bucket: keyof DetailsState; row: any; isReviewer: boolean; onSaved: () => void; onDelete: () => void;
}) {
  if (!isReviewer) return null;
  return (
    <div className="flex items-center justify-end gap-1 mt-3 pt-2 border-t border-dashed border-muted">
      <DetailRowDialog
        mode="edit" kind={bucket} row={row} onSaved={onSaved}
        trigger={
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-accent">
            <Pencil className="h-3 w-3 mr-1" /> Edit
          </Button>
        }
      />
      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-destructive" onClick={onDelete}>
        <Trash2 className="h-3 w-3 mr-1" /> Delete
      </Button>
    </div>
  );
}

// Inline bulk-action toolbar at the top of each detail tab. Select-all checkbox
// + Approve / Reject / Delete buttons. Hidden when there are no rows. Used
// inside ComprehensiveSections (the 7 detail tables); a slightly different
// shape lives in ProjectDetail for milestones/updates/sources.
function TabBulkBar({
  table, rows, selected, onToggleAll, onAction, busy, showApprove = true, showReject = true,
}: {
  table: DetailTable | string;
  rows: any[];
  selected: Set<string>;
  onToggleAll: (table: DetailTable | string, ids: string[], select: boolean) => void;
  onAction: (table: DetailTable | string, ids: string[], action: 'approved' | 'rejected' | 'delete') => void;
  busy: boolean;
  showApprove?: boolean;
  showReject?: boolean;
}) {
  if (rows.length === 0) return null;
  const allKeys = rows.map(r => `${table}:${r.id}`);
  const selKeys = allKeys.filter(k => selected.has(k));
  const selIds = selKeys.map(k => k.split(':').slice(1).join(':'));
  const allSelected = allKeys.length > 0 && selKeys.length === allKeys.length;
  const some = selKeys.length > 0;
  return (
    <div className="flex items-center justify-between gap-2 p-2 rounded-md border bg-muted/30 mb-2 flex-wrap">
      <label className="flex items-center gap-2 cursor-pointer text-xs">
        <Checkbox
          checked={allSelected}
          onCheckedChange={(checked) => onToggleAll(table, allKeys.map(k => k.split(':').slice(1).join(':')), !!checked)}
          aria-label="Select all in this tab"
        />
        <span>{some ? `${selKeys.length} of ${rows.length} selected` : `Select all (${rows.length})`}</span>
      </label>
      <div className="flex items-center gap-1">
        {showApprove && (
          <Button disabled={!some || busy} size="sm" variant="ghost" className="h-7 text-xs text-success hover:bg-success/10" onClick={() => onAction(table, selIds, 'approved')}>
            <Check className="h-3.5 w-3.5 mr-1" /> Approve
          </Button>
        )}
        {showReject && (
          <Button disabled={!some || busy} size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-destructive/10" onClick={() => onAction(table, selIds, 'rejected')}>
            <X className="h-3.5 w-3.5 mr-1" /> Reject
          </Button>
        )}
        <Button disabled={!some || busy} size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-destructive/10" onClick={() => onAction(table, selIds, 'delete')}>
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
        </Button>
      </div>
    </div>
  );
}

// Per-row metadata bar shown above each card's existing content. Renders a
// selection checkbox for reviewers regardless of status (so manual rows can
// also be bulk-moderated/deleted), plus pending/confidence badges and inline
// Approve/Reject buttons for pending AI rows.
function RowMetaBar({ bucket, row, isReviewer, onModerate, table, selected, onToggleSelect }: {
  bucket: keyof DetailsState;
  row: any;
  isReviewer: boolean;
  onModerate: (b: keyof DetailsState, id: string, action: 'approved' | 'rejected') => void;
  table: DetailTable;
  selected: boolean;
  onToggleSelect: (table: DetailTable, id: string) => void;
}) {
  const pending = row?.approval_status === 'pending';
  const score: number | null = typeof row?.confidence_score === 'number' ? row.confidence_score : null;
  const isAi = !!row?.submitted_by_ai;
  // Reviewers always see the checkbox so they can bulk-act. Hide the rest of
  // the bar when there's nothing else interesting to surface.
  const showRightSide = pending || score != null;
  if (!isReviewer && !showRightSide) return null;
  return (
    <div className="flex items-center justify-between gap-2 mb-2 -mt-1 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">
        {isReviewer && (
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelect(table, row.id)}
            aria-label="Select row for bulk action"
            className="h-3.5 w-3.5"
          />
        )}
        {pending && (
          <Badge className="bg-warning/15 text-warning border-warning/40 border text-[10px] uppercase font-mono">
            {isAi ? 'AI suggestion · pending review' : 'Pending review'}
          </Badge>
        )}
        {score != null && <ConfidenceBadge score={score} />}
      </div>
      {pending && isReviewer && (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs text-success hover:bg-success/10" onClick={() => onModerate(bucket, row.id, 'approved')}>
            <Check className="h-3.5 w-3.5 mr-1" /> Approve
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-destructive/10" onClick={() => onModerate(bucket, row.id, 'rejected')}>
            <X className="h-3.5 w-3.5 mr-1" /> Reject
          </Button>
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const level = score >= 0.8 ? 'high' : score >= 0.5 ? 'med' : 'low';
  const cls =
    level === 'high' ? 'bg-success/15 text-success border-success/40'
    : level === 'med'  ? 'bg-info/15 text-info border-info/40'
    : 'bg-destructive/15 text-destructive border-destructive/40';
  return (
    <Badge className={cn('border text-[10px] uppercase font-mono', cls)} title={`AI confidence ${pct}%`}>
      conf {pct}%
    </Badge>
  );
}

// Inline "last run" summary that lives next to the section title. Compact —
// "12 hits · +6 new · 4 deduped · 2 min ago" or "running…" or empty.
function RunSummaryLine({ latestRun, runInFlight }: { latestRun: AnalysisRun | null; runInFlight: boolean }) {
  if (!latestRun && !runInFlight) return null;
  if (runInFlight) return <span className="ml-1.5 italic">analysis running…</span>;
  if (!latestRun) return null;
  const inserted = Object.values(latestRun.inserted_per_table ?? {}).reduce((a, b) => a + (b || 0), 0);
  const deduped = Object.values(latestRun.deduped_per_table ?? {}).reduce((a, b) => a + (b || 0), 0);
  const hits = Object.values(latestRun.bucket_status ?? {}).reduce((a, b: any) => a + (b?.hits || 0), 0);
  const when = relTime(latestRun.finished_at ?? latestRun.started_at);
  return (
    <span className="ml-1.5">
      Last run {when} · {hits} hits · +{inserted} new{deduped ? ` · ${deduped} deduped` : ''}
      {latestRun.status === 'failed' && <span className="text-destructive ml-1">(failed)</span>}
    </span>
  );
}

function relTime(iso: string | null): string {
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

// Live per-bucket progress pills shown above the Tabs while a run is in flight.
// Renders one pill per bucket with state-based color and hit count when known.
function BucketProgressStrip({ run }: { run: AnalysisRun }) {
  const bs = run.bucket_status ?? {};
  // Buckets are now data-driven (analysis_buckets table). Render whichever
  // names exist on the run's bucket_status — the drainer seeds all enabled
  // buckets to {state:'queued'} as its first action, so even at t=0 the
  // strip shows the full list.
  const names = Object.keys(bs);
  if (names.length === 0) {
    return (
      <div className="mb-4 p-3 rounded-md border border-info/30 bg-info/5">
        <div className="text-xs font-semibold text-info flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Queueing analysis…
        </div>
      </div>
    );
  }
  return (
    <div className="mb-4 p-3 rounded-md border border-info/30 bg-info/5">
      <div className="text-xs font-semibold text-info mb-2 flex items-center gap-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Analysing project across {names.length} source bucket{names.length === 1 ? '' : 's'}…
      </div>
      <div className="flex flex-wrap gap-1.5">
        {names.map(name => {
          const s = (bs[name] ?? { state: 'queued' }) as BucketState;
          const state = s.state ?? 'queued';
          const cls =
            state === 'succeeded' ? 'bg-success/15 text-success border-success/40'
            : state === 'failed' ? 'bg-destructive/15 text-destructive border-destructive/40'
            : state === 'running' ? 'bg-info/15 text-info border-info/40'
            : 'bg-muted text-muted-foreground border-muted-foreground/30';
          return (
            <Badge key={name} className={cn('border text-[10px] uppercase font-mono gap-1', cls)} title={s.error ?? state}>
              {state === 'running' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
              {name.replace(/_/g, ' ')}
              {typeof s.hits === 'number' && state === 'succeeded' ? ` · ${s.hits}` : ''}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

// AI-written synthesis displayed at the top of the section. Becomes the new
// "what is this project, in plain English" entry point — the structured tabs
// below become evidence rather than the front page.
function NarrativeSummary({ text, updatedAt }: { text: string; updatedAt: string | null }) {
  return (
    <div className="mb-4 p-4 rounded-md border bg-accent/5">
      <div className="text-xs font-semibold text-accent mb-1.5 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5" />
        AI synthesis · refreshed {relTime(updatedAt)}
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  );
}

// Explicit gaps + contradictions called out so empty arrays don't read as "all
// is well." Yellow banner above the Tabs.
function GapsBanner({ items }: { items: string[] }) {
  return (
    <div className="mb-4 p-3 rounded-md border border-warning/40 bg-warning/5">
      <div className="text-xs font-semibold text-warning mb-1.5 flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5" />
        Gaps & contradictions in the available evidence
      </div>
      <ul className="space-y-1 text-xs list-disc pl-5">
        {items.map((g, i) => <li key={i} className="leading-snug">{g}</li>)}
      </ul>
    </div>
  );
}

// Compact 5-most-recent run history. Collapsed by default; expands to show
// per-run hit/insert/dedupe summaries. Phase 2 will replace with a richer
// timeline view.
function RunHistoryExpander({ runs, open, onToggle }: { runs: AnalysisRun[]; open: boolean; onToggle: () => void }) {
  return (
    <div className="mt-4 pt-3 border-t border-dashed border-muted">
      <button onClick={onToggle} className="text-xs text-muted-foreground hover:text-accent inline-flex items-center gap-1 font-mono">
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        Run history ({runs.length})
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {runs.map(r => {
            const inserted = Object.values(r.inserted_per_table ?? {}).reduce((a, b) => a + (b || 0), 0);
            const deduped = Object.values(r.deduped_per_table ?? {}).reduce((a, b) => a + (b || 0), 0);
            const hits = Object.values(r.bucket_status ?? {}).reduce((a, b: any) => a + (b?.hits || 0), 0);
            return (
              <div key={r.id} className="text-xs text-muted-foreground font-mono flex items-center gap-2 flex-wrap">
                <span>{new Date(r.started_at).toLocaleString()}</span>
                <Badge variant="outline" className="text-[10px] uppercase font-mono">{r.status}</Badge>
                <span>{hits} hits · +{inserted} new · {deduped} deduped</span>
                {r.errors?.length > 0 && <span className="text-destructive truncate" title={r.errors.join('\n')}>· {r.errors.length} error{r.errors.length === 1 ? '' : 's'}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Each entry in `sources` is either a legacy string (old rows from before the
// source-date upgrade) or an object {url, published_at}. Normalise both into a
// uniform shape and render the publication date next to the host when known.
type SourceEntry = { url: string; published_at: string | null };
function normaliseSources(sources: any, fallbackUrl?: string | null): SourceEntry[] {
  if (!Array.isArray(sources) || sources.length === 0) {
    return fallbackUrl ? [{ url: fallbackUrl, published_at: null }] : [];
  }
  const out: SourceEntry[] = [];
  for (const s of sources) {
    if (typeof s === 'string') out.push({ url: s, published_at: null });
    else if (s && typeof s.url === 'string') out.push({ url: s.url, published_at: typeof s.published_at === 'string' ? s.published_at : null });
  }
  return out;
}

function SourceLink({ url, sources }: { url?: string | null; sources?: any }) {
  const list = normaliseSources(sources, url);
  if (list.length === 0) return null;
  if (list.length === 1) {
    const s = list[0];
    let host = s.url;
    try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }
    return (
      <a href={s.url} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-accent inline-flex items-center gap-1 font-mono mt-2">
        Source · {host}{s.published_at ? ` · ${s.published_at}` : ''} <ExternalLink className="h-2.5 w-2.5" />
      </a>
    );
  }
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      <span className="text-[10px] text-muted-foreground font-mono">Sources ({list.length}):</span>
      {list.map((s, i) => {
        let host = s.url;
        try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }
        return (
          <a key={s.url + i} href={s.url} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-accent inline-flex items-center gap-0.5 font-mono">
            [{i + 1}] {host}{s.published_at ? ` · ${s.published_at}` : ''} <ExternalLink className="h-2 w-2" />
          </a>
        );
      })}
    </div>
  );
}
