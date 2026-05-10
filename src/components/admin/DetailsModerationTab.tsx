import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExternalLink, Sparkles, Loader2, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { formatNPR } from '@/lib/parseCoords';
import { toast } from 'sonner';

const TABLES = [
  { key: 'project_funding', label: 'Funding' },
  { key: 'project_documents', label: 'Documents' },
  { key: 'project_stakeholders', label: 'Stakeholders' },
  { key: 'project_risks', label: 'Risks' },
  { key: 'project_impact', label: 'Impact' },
  { key: 'project_procurement', label: 'Procurement' },
  { key: 'project_compliance', label: 'Compliance' },
] as const;

type Row = any & { projects?: { title: string; slug: string } };

export function DetailsModerationTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Record<string, Row[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const results = await Promise.all(TABLES.map(t =>
      supabase.from(t.key as any)
        .select('*, projects(title, slug)')
        .in('approval_status', ['pending', 'changes_requested'])
        .order('created_at', { ascending: false })
    ));
    const map: Record<string, Row[]> = {};
    TABLES.forEach((t, i) => { map[t.key] = (results[i] as any).data ?? []; });
    setRows(map);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const review = async (table: string, id: string, approval: 'approved' | 'rejected') => {
    setBusyId(`${table}:${id}`);
    const { error } = await supabase.from(table as any).update({
      approval_status: approval,
      reviewed_by: user?.id,
    }).eq('id', id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success(approval === 'approved' ? 'Approved' : 'Rejected');
    refresh();
  };

  const totalPending = Object.values(rows).reduce((sum, r) => sum + r.length, 0);
  const counts = Object.fromEntries(TABLES.map(t => [t.key, rows[t.key]?.length ?? 0]));

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold">Project details moderation</h3>
          <p className="text-xs text-muted-foreground">Pending rows across funding, documents, stakeholders, risks, impact, procurement, compliance.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">{totalPending} pending</Badge>
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </div>
      </div>

      {totalPending === 0 ? (
        <div className="p-10 text-center text-muted-foreground text-sm border rounded-md">
          {loading ? 'Loading…' : 'Inbox zero — no pending detail rows.'}
        </div>
      ) : (
        <Tabs defaultValue={TABLES.find(t => counts[t.key] > 0)?.key ?? TABLES[0].key}>
          <TabsList className="flex flex-wrap h-auto gap-1">
            {TABLES.map(t => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label} ({counts[t.key]})
              </TabsTrigger>
            ))}
          </TabsList>

          {TABLES.map(t => (
            <TabsContent key={t.key} value={t.key} className="space-y-2 mt-4">
              {(rows[t.key] ?? []).length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">No pending {t.label.toLowerCase()}.</div>
              ) : rows[t.key].map(r => (
                <Card key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {r.projects?.slug && (
                          <Link to={`/projects/${r.projects.slug}`} className="text-xs text-accent hover:underline font-mono truncate">
                            {r.projects.title ?? 'Project'}
                          </Link>
                        )}
                        {r.submitted_by_ai && (
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-mono border-accent text-accent">
                            <Sparkles className="h-3 w-3 mr-1" /> AI
                          </Badge>
                        )}
                      </div>
                      <RowSummary table={t.key} row={r} />
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Button size="sm" onClick={() => review(t.key, r.id, 'approved')} disabled={busyId === `${t.key}:${r.id}`}>
                        {busyId === `${t.key}:${r.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => review(t.key, r.id, 'rejected')} disabled={busyId === `${t.key}:${r.id}`}>
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </Card>
  );
}

// Compact per-row summary keyed by table — shows the most identifying fields
// inline so a moderator can decide approve/reject without expanding.
function RowSummary({ table, row }: { table: string; row: any }) {
  const sourceUrl = row.source_url ?? row.url ?? row.tender_url ?? row.document_url;

  switch (table) {
    case 'project_funding':
      return (
        <div>
          <div className="font-semibold">{row.source_name} <span className="text-xs font-mono text-muted-foreground">({row.source_type})</span></div>
          <div className="text-xs text-muted-foreground font-mono mt-1">
            {row.amount_npr ? `NPR ${formatNPR(row.amount_npr)}` : ''}
            {row.amount_usd ? ` · USD ${Number(row.amount_usd).toLocaleString()}` : ''}
            {row.committed_at ? ` · Committed ${row.committed_at}` : ''}
          </div>
          {row.notes && <p className="text-sm mt-1">{row.notes}</p>}
          <Source url={sourceUrl} />
        </div>
      );
    case 'project_documents':
      return (
        <div>
          <div className="font-semibold">{row.title} <span className="text-xs font-mono text-muted-foreground">({row.doc_type})</span></div>
          <div className="text-xs text-muted-foreground font-mono mt-1">
            {row.source_org && `Org: ${row.source_org}`}{row.published_at && ` · ${row.published_at}`}
          </div>
          {row.url && <a href={row.url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline inline-flex items-center gap-1 mt-1">Document <ExternalLink className="h-3 w-3" /></a>}
        </div>
      );
    case 'project_stakeholders':
      return (
        <div>
          <div className="font-semibold">{row.org_name} <span className="text-xs font-mono text-muted-foreground">({row.role.replace(/_/g, ' ')})</span></div>
          {(row.contact_name || row.contact_email) && (
            <div className="text-xs text-muted-foreground mt-1">
              {row.contact_name}{row.contact_email && ` · ${row.contact_email}`}
            </div>
          )}
          {row.notes && <p className="text-sm mt-1">{row.notes}</p>}
          <Source url={sourceUrl} />
        </div>
      );
    case 'project_risks':
      return (
        <div>
          <div className="font-semibold flex items-center gap-2">
            {row.title}
            <Badge variant="outline" className="text-[10px] uppercase font-mono">{row.severity}</Badge>
            <Badge variant="outline" className="text-[10px] uppercase font-mono">{row.category}</Badge>
          </div>
          {row.description && <p className="text-sm mt-1">{row.description}</p>}
          <Source url={sourceUrl} />
        </div>
      );
    case 'project_impact':
      return (
        <div>
          <div className="font-semibold capitalize">{row.metric_type.replace(/_/g, ' ')}</div>
          <div className="text-xs font-mono text-muted-foreground mt-1">
            Value: {row.metric_value ?? '—'} {row.unit ?? ''}
            {row.target_value ? ` · Target: ${row.target_value}` : ''}
            {row.measured_at ? ` · ${row.measured_at}` : ''}
          </div>
          {row.notes && <p className="text-sm mt-1">{row.notes}</p>}
          <Source url={sourceUrl} />
        </div>
      );
    case 'project_procurement':
      return (
        <div>
          <div className="font-semibold">{row.tender_title} <Badge variant="outline" className="text-[10px] uppercase font-mono ml-1">{row.status}</Badge></div>
          <div className="text-xs font-mono text-muted-foreground mt-1">
            {row.awardee_name && `Awardee: ${row.awardee_name}`}
            {row.contract_value_npr ? ` · NPR ${formatNPR(row.contract_value_npr)}` : ''}
            {row.contract_awarded_at ? ` · Awarded ${row.contract_awarded_at}` : ''}
          </div>
          <Source url={sourceUrl} />
        </div>
      );
    case 'project_compliance':
      return (
        <div>
          <div className="font-semibold capitalize">
            {row.item_type.replace(/_/g, ' ')}
            <Badge variant="outline" className="text-[10px] uppercase font-mono ml-2">{row.status.replace(/_/g, ' ')}</Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {row.authority && `Authority: ${row.authority}`}{row.decided_at && ` · ${row.decided_at}`}
          </div>
          {row.finding && <p className="text-sm mt-1"><strong>Finding:</strong> {row.finding}</p>}
          <Source url={sourceUrl} />
        </div>
      );
    default:
      return <pre className="text-xs">{JSON.stringify(row, null, 2)}</pre>;
  }
}

function Source({ url }: { url?: string | null }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-accent inline-flex items-center gap-1 font-mono mt-2">
      Source <ExternalLink className="h-2.5 w-2.5" />
    </a>
  );
}
