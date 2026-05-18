import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, ChevronDown, ChevronRight, Check, RefreshCw, ExternalLink, Sparkles, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Per-bucket entry returned by public.project_moderation_summary().
type BucketStats = { approved: number; pending: number; pending_eligible: number };
type BucketName =
  | 'funding' | 'documents' | 'stakeholders' | 'risks'
  | 'impact' | 'procurement' | 'compliance'
  | 'sources' | 'updates' | 'milestones';

type ProjectRow = {
  project_id: number;
  title: string;
  slug: string;
  confidence_score: number | null;
  total_approved: number;
  total_pending: number;
  total_pending_eligible: number;
  buckets: Record<BucketName, BucketStats>;
  progress_percent: number | null;
  progress_stage: string | null;
};

type DuplicatePair = {
  project_a_id: number;
  project_b_id: number;
  title_a: string;
  title_b: string;
  similarity_score: number;
  district: string | null;
  province: string | null;
  sector: string | null;
  status_a: string | null;
  status_b: string | null;
  created_a: string | null;
  created_b: string | null;
  slug_a?: string | null;
  slug_b?: string | null;
};

// Fixed display order for the 9 buckets. Sources/updates render last because
// they're cascade-trusted and shouldn't normally have pending rows — visually
// de-emphasising them mirrors the trust model.
const BUCKETS: { name: BucketName; label: string }[] = [
  { name: 'funding',      label: 'Funding' },
  { name: 'documents',    label: 'Documents' },
  { name: 'stakeholders', label: 'Stakeholders' },
  { name: 'risks',        label: 'Risks' },
  { name: 'impact',       label: 'Impact' },
  { name: 'procurement',  label: 'Procurement' },
  { name: 'compliance',   label: 'Compliance' },
  { name: 'sources',      label: 'Sources' },
  { name: 'updates',      label: 'Updates' },
  { name: 'milestones',   label: 'Milestones' },
];

// Small chip pair that appears at every level (project total + per-bucket).
// Approved is muted; pending is amber so the eye is drawn to the action work.
const StatChips = ({ approved, pending }: { approved: number; pending: number }) => (
  <span className="flex items-center gap-1.5">
    <Badge variant="outline" className="text-[10px] font-mono border-success/40 text-success">
      ✓ {approved}
    </Badge>
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] font-mono',
        pending > 0 ? 'border-warning/60 text-warning' : 'border-border text-muted-foreground/60',
      )}
    >
      ⏳ {pending}
    </Badge>
  </span>
);

const BulkEnrichmentCard = () => {
  const [open, setOpen] = useState(true);
  const [includeCoords, setIncludeCoords] = useState(true);
  const [includeFy, setIncludeFy] = useState(true);
  const [counts, setCounts] = useState({ coordinates: 0, fiscal_year: 0 });
  const [countsLoading, setCountsLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const loadCounts = useCallback(async () => {
    setCountsLoading(true);
    const [coords, fy] = await Promise.all([
      supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('approval_status', 'approved')
        .is('coordinates', null),
      supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('approval_status', 'approved')
        .is('fiscal_year' as any, null),
    ]);
    setCountsLoading(false);
    if (coords.error || fy.error) {
      toast.error(`Enrichment counts failed: ${coords.error?.message ?? fy.error?.message}`);
      return;
    }
    setCounts({ coordinates: coords.count ?? 0, fiscal_year: fy.count ?? 0 });
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  const selectedFields = useMemo(() => {
    const out: string[] = [];
    if (includeCoords) out.push('coordinates');
    if (includeFy) out.push('fiscal_year');
    return out;
  }, [includeCoords, includeFy]);

  const selectedMissing = (includeCoords ? counts.coordinates : 0) + (includeFy ? counts.fiscal_year : 0);
  const canRun = selectedFields.length > 0 && selectedMissing > 0 && !running;

  const run = async () => {
    if (!canRun) return;
    setRunning(true);
    const { data, error } = await supabase.functions.invoke('ai-enrich-coords-fy', {
      body: { fields: selectedFields },
    });
    setRunning(false);
    if (error) {
      toast.error(`Enrichment failed: ${error.message}`);
      return;
    }
    const r: any = data ?? {};
    const total = Number(r.enriched_projects ?? (Number(r.enriched_coords ?? 0) + Number(r.enriched_fy ?? 0)));
    toast.success(
      `Enriched ${total} projects (coords: ${Number(r.enriched_coords ?? 0)}, FY: ${Number(r.enriched_fy ?? 0)}). Skipped ${Number(r.skipped_low_conf ?? 0)} for low confidence.`
    );
    loadCounts();
  };

  return (
    <Card className="p-0 overflow-hidden border-accent/30 bg-accent/5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="w-full px-3 py-2 flex items-center justify-between gap-3 text-left hover:bg-accent/10 transition-colors">
          <div className="flex items-center gap-2 min-w-0">
            {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">Bulk enrich missing fields</div>
              <div className="text-[11px] text-muted-foreground">
                Approved projects missing coordinates or fiscal year
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="outline" className="text-[10px] font-mono border-accent/40 text-accent">
              {countsLoading ? '...' : counts.coordinates + counts.fiscal_year} missing
            </Badge>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-accent/20 p-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox checked={includeCoords} onCheckedChange={(v) => setIncludeCoords(!!v)} />
                <span className="font-medium">Coordinates</span>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {countsLoading ? '...' : counts.coordinates} projects missing
                </Badge>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox checked={includeFy} onCheckedChange={(v) => setIncludeFy(!!v)} />
                <span className="font-medium">Fiscal year</span>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {countsLoading ? '...' : counts.fiscal_year} projects missing
                </Badge>
              </label>
            </div>
            <Button size="sm" className="h-8 text-xs" onClick={run} disabled={!canRun}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {running ? `Processing ${selectedMissing} missing fields...` : 'Run enrichment'}
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return 'Unknown date';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const movedSummary = (result: any) => {
  const moved = (result?.moved_rows_per_table ?? {}) as Record<string, number>;
  const labels: Record<string, string> = {
    project_funding: 'funding',
    project_documents: 'documents',
    project_stakeholders: 'stakeholders',
    project_risks: 'risks',
    project_impact: 'impact',
    project_procurement: 'procurement',
    project_compliance: 'compliance',
    project_updates: 'updates',
    project_sources: 'sources',
    project_milestones: 'milestones',
    analysis_jobs: 'analysis jobs',
    project_analysis_runs: 'analysis runs',
    project_reviews: 'reviews',
  };
  const parts = Object.entries(moved)
    .filter(([, count]) => Number(count) > 0)
    .slice(0, 4)
    .map(([table, count]) => `${count} ${labels[table] ?? table}`);
  return parts.length > 0 ? ` - moved ${parts.join(', ')}` : '';
};

const ProjectCompareCard = ({
  id,
  title,
  status,
  district,
  province,
  sector,
  created,
  slug,
}: {
  id: number;
  title: string;
  status: string | null;
  district: string | null;
  province: string | null;
  sector: string | null;
  created: string | null;
  slug?: string | null;
}) => (
  <div className="rounded-md border bg-card p-2.5 min-w-0 space-y-1.5">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[10px] font-mono text-muted-foreground">#{id}</div>
        <div className="text-xs font-semibold leading-snug">{title}</div>
      </div>
      {status && (
        <Badge variant="outline" className="text-[10px] shrink-0">
          {status}
        </Badge>
      )}
    </div>
    <div className="text-[11px] text-muted-foreground">
      {[district, province, sector].filter(Boolean).join(' - ') || 'No location metadata'}
    </div>
    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span>{formatDate(created)}</span>
      {slug ? (
        <Link to={`/projects/${slug}`} target="_blank" rel="noreferrer" className="hover:text-accent inline-flex items-center gap-1">
          Open <ExternalLink className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  </div>
);

const ConfirmActionButton = ({
  label,
  description,
  variant = 'outline',
  disabled,
  onConfirm,
}: {
  label: string;
  description: string;
  variant?: 'outline' | 'destructive';
  disabled?: boolean;
  onConfirm: () => void;
}) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button size="sm" variant={variant} className="h-7 text-[11px] shrink-0" disabled={disabled}>
        {label}
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Confirm duplicate action</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

const DuplicateDetectionCard = () => {
  const [open, setOpen] = useState(true);
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(true);

  const sortedPairs = useMemo(() => {
    return [...pairs].sort((a, b) => (
      sortDesc
        ? b.similarity_score - a.similarity_score
        : a.similarity_score - b.similarity_score
    ));
  }, [pairs, sortDesc]);

  const scan = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc('find_duplicate_projects', { p_min_similarity: 0.55 });
    if (error) {
      setLoading(false);
      toast.error(`Duplicate scan failed: ${error.message}`);
      return;
    }

    const found = (data ?? []) as DuplicatePair[];
    const ids = Array.from(new Set(found.flatMap(p => [p.project_a_id, p.project_b_id])));
    let slugs = new Map<number, string | null>();
    if (ids.length > 0) {
      const { data: projectRows, error: slugError } = await supabase
        .from('projects')
        .select('id, slug')
        .in('id', ids);
      if (slugError) {
        toast.error(`Project links failed: ${slugError.message}`);
      } else {
        slugs = new Map((projectRows ?? []).map((p: any) => [p.id, p.slug]));
      }
    }

    setPairs(found.map(p => ({
      ...p,
      slug_a: slugs.get(p.project_a_id) ?? null,
      slug_b: slugs.get(p.project_b_id) ?? null,
    })));
    setHasScanned(true);
    setLoading(false);
  };

  const removePair = (a: number, b: number) => {
    setPairs(prev => prev.filter(p => p.project_a_id !== a || p.project_b_id !== b));
  };

  const merge = async (pair: DuplicatePair, canonicalId: number, duplicateId: number) => {
    const key = `merge-${canonicalId}-${duplicateId}`;
    setBusyKey(key);
    removePair(pair.project_a_id, pair.project_b_id);
    const { data, error } = await (supabase as any).rpc('merge_projects', {
      p_canonical_id: canonicalId,
      p_duplicate_id: duplicateId,
    });
    setBusyKey(null);
    if (error) {
      toast.error(`Merge failed: ${error.message}`);
      setPairs(prev => [...prev, pair]);
      return;
    }
    toast.success(`Merged into project #${canonicalId}${movedSummary(data)}`);
  };

  const softDelete = async (pair: DuplicatePair, duplicateId: number) => {
    const key = `delete-${duplicateId}`;
    setBusyKey(key);
    removePair(pair.project_a_id, pair.project_b_id);
    const { error } = await (supabase as any).rpc('delete_duplicate_project', {
      p_duplicate_id: duplicateId,
      p_reason: 'duplicate',
    });
    setBusyKey(null);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      setPairs(prev => [...prev, pair]);
      return;
    }
    toast.success(`Soft-deleted project #${duplicateId} as duplicate`);
  };

  return (
    <Card className="p-0 overflow-hidden border-accent/30 bg-accent/5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="w-full px-3 py-2 flex items-center justify-between gap-3 text-left hover:bg-accent/10 transition-colors">
          <div className="flex items-center gap-2 min-w-0">
            {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <Search className="h-3.5 w-3.5 text-accent" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">Find duplicates</div>
              <div className="text-[11px] text-muted-foreground">
                Fuzzy title matches in the same district
              </div>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono border-accent/40 text-accent">
            {hasScanned ? `${pairs.length} pairs` : 'not scanned'}
          </Badge>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-accent/20 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-muted-foreground">
              {hasScanned ? `Found ${pairs.length} candidate pair${pairs.length === 1 ? '' : 's'} - review below` : 'Scan approved and pending projects for likely duplicates.'}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSortDesc(v => !v)} disabled={pairs.length < 2}>
                Similarity {sortDesc ? 'high to low' : 'low to high'}
              </Button>
              <Button size="sm" className="h-8 text-xs" onClick={scan} disabled={loading}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                {loading ? 'Scanning...' : 'Scan for duplicates'}
              </Button>
            </div>
          </div>

          {hasScanned && sortedPairs.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No candidate duplicate pairs found.</p>
          ) : (
            <div className="space-y-2">
              {sortedPairs.map(pair => {
                const pairKey = `${pair.project_a_id}-${pair.project_b_id}`;
                const disabled = busyKey != null;
                return (
                  <div key={pairKey} className="rounded-md border bg-background/70 p-2.5 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 items-center">
                      <ProjectCompareCard
                        id={pair.project_a_id}
                        title={pair.title_a}
                        status={pair.status_a}
                        district={pair.district}
                        province={pair.province}
                        sector={pair.sector}
                        created={pair.created_a}
                        slug={pair.slug_a}
                      />
                      <div className="flex sm:flex-col items-center justify-center gap-1 text-accent">
                        <Badge variant="outline" className="text-[10px] font-mono border-accent/40 text-accent">
                          {Math.round(Number(pair.similarity_score || 0) * 100)}%
                        </Badge>
                        <ChevronRight className="h-4 w-4 rotate-90 sm:rotate-0" />
                      </div>
                      <ProjectCompareCard
                        id={pair.project_b_id}
                        title={pair.title_b}
                        status={pair.status_b}
                        district={pair.district}
                        province={pair.province}
                        sector={pair.sector}
                        created={pair.created_b}
                        slug={pair.slug_b}
                      />
                    </div>
                    <div className="flex flex-row gap-1.5 overflow-x-auto pb-1">
                      <ConfirmActionButton
                        label="Merge -> keep A"
                        description="Move all detail rows from B into A and delete B. This cannot be undone."
                        disabled={disabled}
                        onConfirm={() => merge(pair, pair.project_a_id, pair.project_b_id)}
                      />
                      <ConfirmActionButton
                        label="Merge -> keep B"
                        description="Move all detail rows from A into B and delete A. This cannot be undone."
                        disabled={disabled}
                        onConfirm={() => merge(pair, pair.project_b_id, pair.project_a_id)}
                      />
                      <ConfirmActionButton
                        label="Delete A"
                        description="Soft-delete A by marking it rejected with duplicate as the review reason."
                        variant="destructive"
                        disabled={disabled}
                        onConfirm={() => softDelete(pair, pair.project_a_id)}
                      />
                      <ConfirmActionButton
                        label="Delete B"
                        description="Soft-delete B by marking it rejected with duplicate as the review reason."
                        variant="destructive"
                        disabled={disabled}
                        onConfirm={() => softDelete(pair, pair.project_b_id)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

const EditProgressPopover = ({
  row,
  onSaved,
}: {
  row: ProjectRow;
  onSaved: (projectId: number, progress_percent: number | null, progress_stage: string | null) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState(row.progress_percent == null ? '' : String(row.progress_percent));
  const [stage, setStage] = useState(row.progress_stage ?? '');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setPercent(row.progress_percent == null ? '' : String(row.progress_percent));
    setStage(row.progress_stage ?? '');
  };

  const save = async () => {
    const trimmedStage = stage.trim();
    const nextPercent = percent === '' ? null : Math.max(0, Math.min(100, Number(percent)));
    const nextStage = trimmedStage === '' ? null : trimmedStage;

    if (percent !== '' && !Number.isFinite(Number(percent))) {
      toast.error('Progress percent must be a number.');
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from('projects')
      .update({ progress_percent: nextPercent, progress_stage: nextStage })
      .eq('id', row.project_id);
    setSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    onSaved(row.project_id, nextPercent, nextStage);
    toast.success('Progress updated');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) reset(); }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]">
          Edit progress
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,28rem)] space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="space-y-1 text-[10px] font-medium text-muted-foreground">
            Progress %
            <Input
              type="number"
              min={0}
              max={100}
              step={1}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              className="h-8 text-xs"
            />
          </label>
          <label className="space-y-1 text-[10px] font-medium text-muted-foreground">
            Stage
            <Input
              type="text"
              maxLength={60}
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="h-8 text-xs"
            />
          </label>
        </div>
        <div className="flex justify-end">
          <Button size="sm" className="h-7 text-xs" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export function ProjectModerationTab() {
  const { isReviewer } = useAuth();
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [threshold, setThreshold] = useState<number>(0.85);
  const [loading, setLoading] = useState<boolean>(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [busyProject, setBusyProject] = useState<number | null>(null);
  const [busyGlobal, setBusyGlobal] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('project_moderation_summary', { p_threshold: threshold });
    if (error) {
      setLoading(false);
      toast.error(`Load failed: ${error.message}`);
      return;
    }

    const summaryRows = (data ?? []) as ProjectRow[];
    const ids = summaryRows.map(r => r.project_id);
    let progressByProject = new Map<number, { progress_percent: number | null; progress_stage: string | null }>();
    if (ids.length > 0) {
      const { data: progressRows, error: progressError } = await supabase
        .from('projects')
        .select('id, progress_percent, progress_stage')
        .in('id', ids);
      if (progressError) {
        toast.error(`Progress load failed: ${progressError.message}`);
      } else {
        progressByProject = new Map((progressRows ?? []).map(p => [
          p.id,
          { progress_percent: p.progress_percent, progress_stage: p.progress_stage },
        ]));
      }
    }

    setLoading(false);
    setRows(summaryRows.map(r => ({
      ...r,
      progress_percent: progressByProject.get(r.project_id)?.progress_percent ?? null,
      progress_stage: progressByProject.get(r.project_id)?.progress_stage ?? null,
    })));
  }, [threshold]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const updateProgressRow = (projectId: number, progress_percent: number | null, progress_stage: string | null) => {
    setRows(prev => prev.map(r => (
      r.project_id === projectId ? { ...r, progress_percent, progress_stage } : r
    )));
  };

  // Aggregate totals across every approved project, shown in the top strip.
  const totals = useMemo(() => {
    let approved = 0, pending = 0, eligible = 0;
    for (const r of rows) {
      approved += r.total_approved;
      pending  += r.total_pending;
      eligible += r.total_pending_eligible;
    }
    return { approved, pending, eligible };
  }, [rows]);

  const approveOne = async (projectId: number) => {
    setBusyProject(projectId);
    const { data, error } = await supabase.rpc('bulk_approve_pending', {
      p_project_id: projectId,
      p_threshold: threshold,
    });
    setBusyProject(null);
    if (error) { toast.error(error.message); return; }
    const total = Object.values((data ?? {}) as Record<string, number>).reduce((a, b) => a + Number(b || 0), 0);
    toast.success(`Approved ${total} row${total === 1 ? '' : 's'} for this project`);
    load();
  };

  const approveGlobal = async () => {
    if (totals.eligible === 0) return;
    if (!confirm(`Approve ${totals.eligible} pending row${totals.eligible === 1 ? '' : 's'} across all approved projects at threshold ≥ ${Math.round(threshold * 100)}%? Sources & updates on these projects (cascade-trusted) will also be approved.`)) return;
    setBusyGlobal(true);
    const { data, error } = await supabase.rpc('bulk_approve_pending', {
      p_project_id: null,
      p_threshold: threshold,
    });
    setBusyGlobal(false);
    if (error) { toast.error(error.message); return; }
    const total = Object.values((data ?? {}) as Record<string, number>).reduce((a, b) => a + Number(b || 0), 0);
    toast.success(`Approved ${total} row${total === 1 ? '' : 's'} across all approved projects`);
    load();
  };

  return (
    <div className="space-y-3">
      <BulkEnrichmentCard />
      <DuplicateDetectionCard />

      {/* Top strip: totals + global threshold + global approve.
          Mirrors the Sherlock queue header (counts on the left, action on the right). */}
      <div className="flex items-center justify-between flex-wrap gap-2 p-2 rounded-md border bg-card">
        <div className="text-xs text-muted-foreground">
          {rows.length} approved project{rows.length === 1 ? '' : 's'} ·
          <span className="text-success ml-1">{totals.approved} approved</span> ·
          <span className={cn('ml-1', totals.pending > 0 ? 'text-warning' : 'text-muted-foreground')}>
            {totals.pending} pending
          </span>
          {totals.eligible > 0 && (
            <span className="text-accent ml-1">({totals.eligible} eligible at ≥ {Math.round(threshold * 100)}%)</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Threshold
            <Input
              type="number"
              step={0.05}
              min={0}
              max={1}
              value={threshold}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setThreshold(Math.max(0, Math.min(1, v)));
              }}
              className="h-7 w-16 text-xs font-mono"
            />
          </label>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={approveGlobal}
            disabled={busyGlobal || totals.eligible === 0}
            title="Approve every pending row across all approved projects that meets the threshold"
          >
            {busyGlobal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Approve all eligible ({totals.eligible})
          </Button>
        </div>
      </div>

      {/* Project list — same compact Card row style as the Sherlock queue. */}
      {loading && rows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No approved projects yet.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map(r => {
            const isOpen = expanded.has(r.project_id);
            return (
              <Card key={r.project_id} className="p-2.5 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => toggleExpand(r.project_id)}
                    className="flex items-center gap-1 hover:text-accent transition-colors"
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                  >
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                  <span className="font-semibold truncate flex-1 min-w-0">{r.title}</span>
                  {typeof r.confidence_score === 'number' && (
                    <Badge variant="outline" className="text-[10px] font-mono border-accent/40 text-accent">
                      {Math.round(r.confidence_score * 100)}%
                    </Badge>
                  )}
                  <StatChips approved={r.total_approved} pending={r.total_pending} />
                  <Link to={`/projects/${r.slug}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-accent">
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                  {isReviewer && (
                    <EditProgressPopover row={r} onSaved={updateProgressRow} />
                  )}
                  {r.total_pending_eligible > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => approveOne(r.project_id)}
                      disabled={busyProject === r.project_id}
                      title={`Approve ${r.total_pending_eligible} pending row(s) at ≥ ${Math.round(threshold * 100)}%`}
                    >
                      {busyProject === r.project_id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Check className="h-3 w-3" />}
                      Approve {r.total_pending_eligible}
                    </Button>
                  )}
                </div>

                {isOpen && (
                  <div className="mt-2 pl-5 border-l border-border space-y-1">
                    {BUCKETS.map(b => {
                      const stats = r.buckets?.[b.name] ?? { approved: 0, pending: 0, pending_eligible: 0 };
                      const isEmpty = stats.approved === 0 && stats.pending === 0;
                      return (
                        <div
                          key={b.name}
                          className={cn(
                            'flex items-center gap-2 flex-wrap py-0.5',
                            isEmpty && 'opacity-50',
                          )}
                        >
                          <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground w-24 shrink-0">
                            {b.label}
                          </span>
                          <StatChips approved={stats.approved} pending={stats.pending} />
                          {stats.pending_eligible > 0 && (
                            <span className="text-[10px] text-accent">
                              {stats.pending_eligible} eligible
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
