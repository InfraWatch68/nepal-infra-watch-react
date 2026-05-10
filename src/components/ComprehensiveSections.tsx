import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sparkles, Loader2, ExternalLink, Wallet, FileText, Users, AlertTriangle, BarChart3, Gavel, ShieldCheck } from 'lucide-react';
import { formatNPR } from '@/lib/parseCoords';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

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
  const [lastRun, setLastRun] = useState<string | null>(null);

  const loadAll = async () => {
    const tables = ['project_funding','project_documents','project_stakeholders','project_risks','project_impact','project_procurement','project_compliance'] as const;
    const setters = [setFunding, setDocuments, setStakeholders, setRisks, setImpact, setProcurement, setCompliance];
    const results = await Promise.all(tables.map(t =>
      supabase.from(t).select('*').eq('project_id', projectId).eq('approval_status', 'approved').order('created_at', { ascending: false })
    ));
    results.forEach((r, i) => setters[i](r.data ?? []));
  };

  useEffect(() => {
    loadAll();
    supabase.from('projects').select('last_comprehensive_analysis_at').eq('id', projectId).maybeSingle()
      .then(({ data }) => setLastRun((data as any)?.last_comprehensive_analysis_at ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const runAnalysis = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-comprehensive-analysis', {
        body: { projectId: Number(projectId) },
      });
      if (error) throw error;
      const inserted = data?.inserted ? Object.entries(data.inserted).map(([k, v]) => `${k.replace('project_', '')}: ${v}`).join(', ') : 'no rows';
      toast.success(`Analysis queued — pending review (${inserted})`);
      if (data?.warnings?.length) toast.warning(data.warnings.join('; '));
      setLastRun(new Date().toISOString());
    } catch (e: any) {
      toast.error(e.message ?? 'Analysis failed');
    } finally { setBusy(false); }
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
              {lastRun && <span className="ml-1.5">Last AI run: {new Date(lastRun).toLocaleDateString()}</span>}
            </div>
          </div>
        </div>
        {isReviewer && (
          <Button size="sm" onClick={runAnalysis} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Run AI Analysis
          </Button>
        )}
      </div>

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
          {funding.length === 0 ? <Empty msg="No funding records yet." /> : funding.map(f => (
            <Card key={f.id} className="p-4">
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
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="documents" className="space-y-2 mt-4">
          {documents.length === 0 ? <Empty msg="No documents linked yet." /> : documents.map(d => (
            <Card key={d.id} className="p-4">
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
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="stakeholders" className="space-y-2 mt-4">
          {stakeholders.length === 0 ? <Empty msg="No stakeholders recorded yet." /> : stakeholders.map(s => (
            <Card key={s.id} className="p-4">
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
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="risks" className="space-y-2 mt-4">
          {risks.length === 0 ? <Empty msg="No risks logged yet." /> : risks.map(r => (
            <Card key={r.id} className={cn("p-4 border-l-4",
              r.severity === 'critical' && 'border-l-destructive',
              r.severity === 'high' && 'border-l-destructive/70',
              r.severity === 'medium' && 'border-l-warning',
              r.severity === 'low' && 'border-l-muted-foreground/40')}>
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
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="impact" className="space-y-2 mt-4">
          {impact.length === 0 ? <Empty msg="No impact metrics yet." /> : impact.map(i => (
            <Card key={i.id} className="p-4">
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
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="procurement" className="space-y-2 mt-4">
          {procurement.length === 0 ? <Empty msg="No procurement records yet." /> : procurement.map(p => (
            <Card key={p.id} className="p-4">
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
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="compliance" className="space-y-2 mt-4">
          {compliance.length === 0 ? <Empty msg="No compliance items yet." /> : compliance.map(c => (
            <Card key={c.id} className="p-4">
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
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </Card>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="p-8 text-center text-muted-foreground text-sm border rounded-md">{msg}</div>;
}

function SourceLink({ url, sources }: { url?: string | null; sources?: string[] | null }) {
  // Prefer the merged `sources` array when populated; fall back to single url.
  const list: string[] = Array.isArray(sources) && sources.length > 0
    ? sources
    : (url ? [url] : []);
  if (list.length === 0) return null;
  if (list.length === 1) {
    return (
      <a href={list[0]} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-accent inline-flex items-center gap-1 font-mono mt-2">
        Source <ExternalLink className="h-2.5 w-2.5" />
      </a>
    );
  }
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      <span className="text-[10px] text-muted-foreground font-mono">Sources ({list.length}):</span>
      {list.map((u, i) => {
        let host = u;
        try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }
        return (
          <a key={u} href={u} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-accent inline-flex items-center gap-0.5 font-mono">
            [{i + 1}] {host} <ExternalLink className="h-2 w-2" />
          </a>
        );
      })}
    </div>
  );
}
