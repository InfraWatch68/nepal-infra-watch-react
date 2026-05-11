import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Search, Trash2, Plus, MapPin, ListChecks, Clock, Filter as FilterIcon, Play } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { PROVINCES, SECTORS, districtsFor, type Province } from '@/lib/constants';
import { useMunicipalities } from '@/lib/municipalities';

type TopicFilter = {
  id: string;
  label: string;
  topic: string | null;
  region: string | null;
  max_results: number;
  active: boolean;
  last_run_at: string | null;
  last_inserted: number | null;
};

type Job = {
  id: string;
  kind: 'topic' | 'geo' | 'sweep_child';
  params: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'failed';
  inserted: number | null;
  skipped: number | null;
  error_text: string | null;
  priority: number;
  enqueued_at: string;
  started_at: string | null;
  finished_at: string | null;
  sweep_id: string | null;
};

type Sweep = {
  id: string;
  label: string;
  enabled: boolean;
  cadence: string;
  provinces: string[];
  sectors: string[];
  per_query_max: number;
  cron_job_id: number | null;
  last_run_at: string | null;
  last_run_note: string | null;
};

const CADENCE_PRESETS: { label: string; value: string }[] = [
  { label: 'Every 6 hours', value: '17 */6 * * *' },
  { label: 'Every 12 hours', value: '17 */12 * * *' },
  { label: 'Daily at 03:00', value: '0 3 * * *' },
  { label: 'Twice weekly (Mon/Thu 03:00)', value: '0 3 * * 1,4' },
  { label: 'Weekly (Sun 03:00)', value: '0 3 * * 0' },
];

// Loose cron sanity: 5 space-separated tokens. Real validation happens
// server-side when the trigger calls cron.schedule().
const looksLikeCron = (s: string) => /^\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+\s*$/.test(s);

const SWEEP_CAP = 50;

export function SherlockManager() {
  return (
    <div className="space-y-3 pt-3 border-t border-accent/20">
      <div>
        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5" /> Sherlock — autonomous discovery
        </p>
        <p className="text-xs text-muted-foreground">
          Async job queue, geo-seeded fan-out, and scheduled sweeps. Findings tag with a Sherlock badge in the review queue.
        </p>
      </div>

      <Tabs defaultValue="queue" className="w-full">
        <TabsList className="w-full grid grid-cols-4 h-auto">
          <TabsTrigger value="queue" className="text-xs"><ListChecks className="h-3.5 w-3.5 mr-1" />Queue</TabsTrigger>
          <TabsTrigger value="geo" className="text-xs"><MapPin className="h-3.5 w-3.5 mr-1" />Discover by location</TabsTrigger>
          <TabsTrigger value="topic" className="text-xs"><FilterIcon className="h-3.5 w-3.5 mr-1" />Topic filters</TabsTrigger>
          <TabsTrigger value="sweeps" className="text-xs"><Clock className="h-3.5 w-3.5 mr-1" />Scheduled sweeps</TabsTrigger>
        </TabsList>
        <TabsContent value="queue" className="mt-3"><QueueTab /></TabsContent>
        <TabsContent value="geo" className="mt-3"><GeoDiscoverTab /></TabsContent>
        <TabsContent value="topic" className="mt-3"><TopicFiltersTab /></TabsContent>
        <TabsContent value="sweeps" className="mt-3"><SweepsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Queue ────────────────────────────────────────────────────────────────────

function QueueTab() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('sherlock_jobs')
      .select('id, kind, params, status, inserted, skipped, error_text, priority, enqueued_at, started_at, finished_at, sweep_id')
      .order('enqueued_at', { ascending: false })
      .limit(50);
    setJobs((data ?? []) as Job[]);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll while anything is queued or running.
  useEffect(() => {
    const active = jobs.some(j => j.status === 'queued' || j.status === 'running');
    if (!active) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [jobs, refresh]);

  const clearCompleted = async () => {
    setClearing(true);
    const { error } = await supabase
      .from('sherlock_jobs')
      .delete()
      .in('status', ['done', 'failed']);
    setClearing(false);
    if (error) return toast.error(error.message);
    toast.success('Cleared completed jobs');
    refresh();
  };

  const summarize = (j: Job) => {
    const p = j.params || {};
    const pieces: string[] = [];
    if (p.province) pieces.push(String(p.province));
    if (p.district) pieces.push(String(p.district));
    if (p.municipality) pieces.push(String(p.municipality));
    if (Array.isArray(p.sectors) && p.sectors.length) pieces.push(`[${p.sectors.join(', ')}]`);
    if (p.topic) pieces.push(`topic="${p.topic}"`);
    if (p.region) pieces.push(`region="${p.region}"`);
    if (p.maxResults) pieces.push(`max=${p.maxResults}`);
    return pieces.join(' ') || '—';
  };

  const statusBadge = (s: Job['status']) => {
    switch (s) {
      case 'queued':  return <Badge variant="outline" className="text-[10px]">queued</Badge>;
      case 'running': return <Badge className="bg-info/15 text-info text-[10px]"><Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />running</Badge>;
      case 'done':    return <Badge className="bg-success/15 text-success text-[10px]">done</Badge>;
      case 'failed':  return <Badge className="bg-destructive/15 text-destructive text-[10px]">failed</Badge>;
    }
  };

  const counts = useMemo(() => {
    const c = { queued: 0, running: 0, done: 0, failed: 0 };
    for (const j of jobs) c[j.status] += 1;
    return c;
  }, [jobs]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-muted-foreground">
          {counts.queued} queued · {counts.running} running · {counts.done} done · {counts.failed} failed
          {(counts.queued > 0 || counts.running > 0) && <span className="ml-2 italic">(polling every 5s)</span>}
        </div>
        <Button size="sm" variant="outline" onClick={clearCompleted} disabled={clearing || (counts.done === 0 && counts.failed === 0)}>
          {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Clear completed
        </Button>
      </div>

      {jobs.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No jobs yet. Enqueue one from "Discover by location" or "Topic filters".</p>
      ) : (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
          {jobs.map(j => (
            <Card key={j.id} className="p-2.5 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                {statusBadge(j.status)}
                <span className="font-mono text-[10px] text-muted-foreground">{j.kind}</span>
                <span className="font-mono text-[10px] truncate flex-1 min-w-0">{summarize(j)}</span>
                {j.status === 'done' && (
                  <span className="text-[10px] text-success">+{j.inserted ?? 0} · skipped {j.skipped ?? 0}</span>
                )}
                <span className="text-[10px] text-muted-foreground">{new Date(j.enqueued_at).toLocaleString()}</span>
              </div>
              {j.error_text && (
                <p className="mt-1 text-[10px] text-destructive font-mono truncate" title={j.error_text}>
                  {j.error_text}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Geo discovery ────────────────────────────────────────────────────────────

function GeoDiscoverTab() {
  const { user } = useAuth();
  const [province, setProvince] = useState<string>('');
  const [district, setDistrict] = useState<string>('');
  const [municipality, setMunicipality] = useState<string>('');
  const [sectors, setSectors] = useState<string[]>([...SECTORS]);
  const [maxResults, setMaxResults] = useState<number>(3);
  const [busy, setBusy] = useState(false);

  const districts = useMemo(() => districtsFor(province), [province]);
  const munQuery = useMunicipalities(province || null, district || null);

  // Reset cascaded selections when an upstream changes.
  useEffect(() => { setDistrict(''); setMunicipality(''); }, [province]);
  useEffect(() => { setMunicipality(''); }, [district]);

  const toggleSector = (sec: string) => {
    setSectors(prev => prev.includes(sec) ? prev.filter(s => s !== sec) : [...prev, sec]);
  };

  const enqueue = async () => {
    if (!province) return toast.error('Pick a province');
    if (sectors.length === 0) return toast.error('Pick at least one sector');
    setBusy(true);
    // One row per sector. A bundled all-sectors row blows past the edge function's
    // wall-time limit (~150s on free tier); per-sector rows are ~30-50s each and
    // each completes inside the limit.
    const rows = sectors.map(sec => {
      const params: Record<string, unknown> = {
        province,
        sectors: [sec],
        maxResults,
      };
      if (district) params.district = district;
      if (municipality) params.municipality = municipality;
      return {
        kind: 'geo' as const,
        params,
        priority: 10, // user-initiated; drain before sweep_child
        enqueued_by: user?.id ?? null,
      };
    });

    const { error } = await supabase.from('sherlock_jobs').insert(rows);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Enqueued ${sectors.length} geo job${sectors.length === 1 ? '' : 's'} for ${[municipality, district, province].filter(Boolean).join(' / ')}`);
  };

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-2">
        <div>
          <Label className="text-xs">Province *</Label>
          <Select value={province} onValueChange={setProvince}>
            <SelectTrigger><SelectValue placeholder="Pick a province" /></SelectTrigger>
            <SelectContent>
              {PROVINCES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">District</Label>
          <Select value={district} onValueChange={setDistrict} disabled={!province}>
            <SelectTrigger><SelectValue placeholder={province ? 'Optional' : 'Pick province first'} /></SelectTrigger>
            <SelectContent>
              {districts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Municipality</Label>
          <Select value={municipality} onValueChange={setMunicipality} disabled={!district || munQuery.isLoading}>
            <SelectTrigger>
              <SelectValue placeholder={!district ? 'Pick district first' : (munQuery.isLoading ? 'Loading…' : 'Optional')} />
            </SelectTrigger>
            <SelectContent>
              {(munQuery.data ?? []).map(m => (
                <SelectItem key={m.id} value={m.name}>
                  {m.name} <span className="text-[10px] text-muted-foreground ml-1">({m.kind.replace('_', ' ')})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <Label className="text-xs">Sectors ({sectors.length}/{SECTORS.length} selected)</Label>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setSectors([...SECTORS])}>All</Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setSectors([])}>None</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {SECTORS.map(sec => (
            <label key={sec} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox checked={sectors.includes(sec)} onCheckedChange={() => toggleSector(sec)} />
              <span>{sec}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <Label className="text-xs">Per-sector max</Label>
          <Select value={String(maxResults)} onValueChange={(v) => setMaxResults(Number(v))}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>{[1, 2, 3, 5, 8, 10].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button onClick={enqueue} disabled={busy || !province || sectors.length === 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Enqueue discovery
        </Button>
        <p className="text-[10px] text-muted-foreground self-center">
          Enqueues {sectors.length} job{sectors.length === 1 ? '' : 's'} (one per sector, {maxResults} article{maxResults === 1 ? '' : 's'}/job) so each fits the edge-function timeout
        </p>
      </div>
    </div>
  );
}

// ─── Topic filters (legacy, kept) ─────────────────────────────────────────────

function TopicFiltersTab() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<TopicFilter[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftTopic, setDraftTopic] = useState('');
  const [draftRegion, setDraftRegion] = useState('');
  const [draftMax, setDraftMax] = useState(3);

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('sherlock_filters').select('*').order('created_at', { ascending: true });
    setFilters((data ?? []) as TopicFilter[]);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const createFilter = async () => {
    if (!draftLabel.trim()) return toast.error('Give the filter a short label');
    const { error } = await supabase.from('sherlock_filters').insert({
      label: draftLabel.trim(),
      topic: draftTopic.trim() || null,
      region: draftRegion.trim() || null,
      max_results: draftMax,
      active: true,
      created_by: user?.id ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success(`Saved filter "${draftLabel}"`);
    setDraftLabel(''); setDraftTopic(''); setDraftRegion(''); setDraftMax(3);
    refresh();
  };

  const toggleActive = async (f: TopicFilter) => {
    await supabase.from('sherlock_filters').update({ active: !f.active }).eq('id', f.id);
    refresh();
  };

  const deleteFilter = async (id: string) => {
    if (!confirm('Delete this filter?')) return;
    await supabase.from('sherlock_filters').delete().eq('id', id);
    toast.success('Filter removed');
    refresh();
  };

  // "Run" now enqueues into sherlock_jobs instead of calling the function directly.
  const runOne = async (f: TopicFilter) => {
    setBusyId(f.id);
    const params: Record<string, unknown> = { maxResults: f.max_results };
    if (f.topic) params.topic = f.topic;
    if (f.region) params.region = f.region;
    const { error } = await supabase.from('sherlock_jobs').insert({
      kind: 'topic',
      params,
      priority: 5,
      enqueued_by: user?.id ?? null,
    });
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success(`Enqueued "${f.label}". Watch the Queue tab.`);
  };

  const enqueueAllActive = async () => {
    const active = filters.filter(f => f.active);
    if (active.length === 0) return toast.error('No active filters');
    const rows = active.map(f => ({
      kind: 'topic' as const,
      params: {
        maxResults: f.max_results,
        ...(f.topic ? { topic: f.topic } : {}),
        ...(f.region ? { region: f.region } : {}),
      },
      priority: 5,
      enqueued_by: user?.id ?? null,
    }));
    const { error } = await supabase.from('sherlock_jobs').insert(rows);
    if (error) return toast.error(error.message);
    toast.success(`Enqueued ${active.length} filter${active.length === 1 ? '' : 's'}. Watch the Queue tab.`);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-muted-foreground">
          Saved topic presets. <strong>Run</strong> enqueues into the job queue — it no longer blocks the page.
        </p>
        <Button size="sm" onClick={enqueueAllActive} disabled={filters.filter(f => f.active).length === 0}>
          Enqueue all active
        </Button>
      </div>

      {filters.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No filters yet. Add one below.</p>
      ) : (
        <div className="space-y-1.5">
          {filters.map(f => (
            <Card key={f.id} className="p-3 flex items-center gap-3 flex-wrap">
              <Switch checked={f.active} onCheckedChange={() => toggleActive(f)} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate">{f.label}</div>
                <div className="text-xs text-muted-foreground font-mono truncate">
                  {f.topic && <>topic="{f.topic}" </>}
                  {f.region && <>region="{f.region}" </>}
                  max={f.max_results}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => runOne(f)} disabled={busyId === f.id}>
                {busyId === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Run'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => deleteFilter(f.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-3">
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add a topic filter</div>
        <div className="grid sm:grid-cols-[1fr_1fr_1fr_120px_auto] gap-2 items-start">
          <Input placeholder="Label e.g. Bagmati hydro" value={draftLabel} onChange={e => setDraftLabel(e.target.value)} />
          <Input placeholder="Topic (optional)" value={draftTopic} onChange={e => setDraftTopic(e.target.value)} />
          <Input placeholder="Region (optional)" value={draftRegion} onChange={e => setDraftRegion(e.target.value)} />
          <Select value={String(draftMax)} onValueChange={(v) => setDraftMax(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{[1, 2, 3, 5, 8, 10].map(n => <SelectItem key={n} value={String(n)}>{n}/run</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={createFilter}>Add</Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Scheduled sweeps ─────────────────────────────────────────────────────────

function SweepsTab() {
  const { user } = useAuth();
  const [sweeps, setSweeps] = useState<Sweep[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);

  // Draft form state for "Add sweep"
  const [draftLabel, setDraftLabel] = useState('');
  const [draftCadencePreset, setDraftCadencePreset] = useState<string>(CADENCE_PRESETS[0].value);
  const [draftCustomCron, setDraftCustomCron] = useState('');
  const [draftCustomMode, setDraftCustomMode] = useState(false);
  const [draftProvinces, setDraftProvinces] = useState<string[]>([]); // empty = all
  const [draftSectors, setDraftSectors] = useState<string[]>([]);     // empty = all
  const [draftMax, setDraftMax] = useState(3);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('sherlock_sweeps')
      .select('id, label, enabled, cadence, provinces, sectors, per_query_max, cron_job_id, last_run_at, last_run_note')
      .order('created_at', { ascending: true });
    setSweeps((data ?? []) as Sweep[]);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const provCount = draftProvinces.length || PROVINCES.length;
  const secCount = draftSectors.length || SECTORS.length;
  const combos = provCount * secCount;
  const capped = combos > SWEEP_CAP;

  const finalCadence = draftCustomMode ? draftCustomCron.trim() : draftCadencePreset;

  const addSweep = async () => {
    if (!draftLabel.trim()) return toast.error('Give the sweep a label');
    if (!finalCadence || !looksLikeCron(finalCadence)) {
      return toast.error('Cadence must be a 5-field cron expression');
    }
    const { error } = await supabase.from('sherlock_sweeps').insert({
      label: draftLabel.trim(),
      enabled: true,
      cadence: finalCadence,
      provinces: draftProvinces, // empty = all
      sectors: draftSectors,     // empty = all
      per_query_max: draftMax,
      created_by: user?.id ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success(`Sweep "${draftLabel}" added`);
    setDraftLabel(''); setDraftCustomCron(''); setDraftCustomMode(false);
    setDraftCadencePreset(CADENCE_PRESETS[0].value);
    setDraftProvinces([]); setDraftSectors([]); setDraftMax(3);
    refresh();
  };

  const toggleEnabled = async (s: Sweep) => {
    const { error } = await supabase.from('sherlock_sweeps').update({ enabled: !s.enabled }).eq('id', s.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const deleteSweep = async (id: string) => {
    if (!confirm('Delete this sweep? Its pg_cron job will be removed.')) return;
    const { error } = await supabase.from('sherlock_sweeps').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Sweep removed');
    refresh();
  };

  // Fires the sweep ahead of cadence. Bypasses `enabled`, so you can spot-check
  // a paused config without registering a real pg_cron job for it.
  const runNow = async (s: Sweep) => {
    setRunningId(s.id);
    // `sherlock_run_sweep_now` isn't in the generated Database types yet; cast to bypass.
    const { data, error } = await (supabase.rpc as any)('sherlock_run_sweep_now', { p_sweep_id: s.id });
    setRunningId(null);
    if (error) return toast.error(error.message);
    const r = data as { enqueued?: number; total_combos?: number; enabled?: boolean; skipped?: boolean; reason?: string } | null;
    if (r?.skipped) return toast.error(`Skipped: ${r.reason ?? 'unknown'}`);
    const enq = r?.enqueued ?? 0;
    const tot = r?.total_combos ?? 0;
    const cappedNote = enq < tot ? ` (capped from ${tot})` : '';
    const pausedNote = r?.enabled === false ? ' — sweep is paused but ran anyway' : '';
    toast.success(`Enqueued ${enq} combo${enq === 1 ? '' : 's'}${cappedNote}${pausedNote}. Watch the Queue tab.`);
    refresh();
  };

  const toggleProv = (p: string) => setDraftProvinces(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  const toggleSec = (s: string) => setDraftSectors(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  return (
    <div className="space-y-3">
      {sweeps.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No sweeps yet. Add one below.</p>
      ) : (
        <div className="space-y-1.5">
          {sweeps.map(s => {
            const totalCombos = (s.provinces.length || PROVINCES.length) * (s.sectors.length || SECTORS.length);
            return (
              <Card key={s.id} className="p-3 flex items-center gap-3 flex-wrap">
                <Switch checked={s.enabled} onCheckedChange={() => toggleEnabled(s)} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">{s.label}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    <span className="text-foreground">{s.cadence}</span>
                    {' · '}
                    {s.provinces.length ? `${s.provinces.length} province${s.provinces.length === 1 ? '' : 's'}` : 'all 7 provinces'}
                    {' × '}
                    {s.sectors.length ? `${s.sectors.length} sector${s.sectors.length === 1 ? '' : 's'}` : 'all 9 sectors'}
                    {' = '}
                    {Math.min(totalCombos, SWEEP_CAP)} combo{Math.min(totalCombos, SWEEP_CAP) === 1 ? '' : 's'}/run
                    {totalCombos > SWEEP_CAP && <span className="text-warning"> (capped from {totalCombos})</span>}
                    {' · max '}{s.per_query_max}/query
                  </div>
                  {s.last_run_at && (
                    <div className="text-[10px] text-muted-foreground">
                      last run {new Date(s.last_run_at).toLocaleString()}{s.last_run_note ? ` — ${s.last_run_note}` : ''}
                    </div>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => runNow(s)} disabled={runningId === s.id}>
                  {runningId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Run now
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deleteSweep(s.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="p-3 space-y-2.5">
        <div className="text-xs font-semibold flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add a scheduled sweep</div>

        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Label *</Label>
            <Input placeholder="e.g. Nightly all-Nepal sweep" value={draftLabel} onChange={e => setDraftLabel(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Per-query max</Label>
            <Select value={String(draftMax)} onValueChange={(v) => setDraftMax(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{[1, 2, 3, 5, 8, 10].map(n => <SelectItem key={n} value={String(n)}>{n}/combo</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label className="text-xs">Cadence</Label>
          <div className="flex gap-2 flex-wrap items-start">
            <Select
              value={draftCustomMode ? '__custom' : draftCadencePreset}
              onValueChange={(v) => {
                if (v === '__custom') setDraftCustomMode(true);
                else { setDraftCustomMode(false); setDraftCadencePreset(v); }
              }}
            >
              <SelectTrigger className="min-w-[260px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CADENCE_PRESETS.map(p => (
                  <SelectItem key={p.value} value={p.value}>{p.label} <span className="text-[10px] text-muted-foreground ml-1 font-mono">{p.value}</span></SelectItem>
                ))}
                <SelectItem value="__custom">Custom cron…</SelectItem>
              </SelectContent>
            </Select>
            {draftCustomMode && (
              <Input
                className="font-mono min-w-[200px]"
                placeholder="e.g. */30 * * * *"
                value={draftCustomCron}
                onChange={e => setDraftCustomCron(e.target.value)}
              />
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label className="text-xs">Provinces (none selected = all 7)</Label>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setDraftProvinces([])}>Clear (= all)</Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {PROVINCES.map(p => (
              <label key={p} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <Checkbox checked={draftProvinces.includes(p)} onCheckedChange={() => toggleProv(p)} />
                <span>{p}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label className="text-xs">Sectors (none selected = all 9)</Label>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setDraftSectors([])}>Clear (= all)</Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {SECTORS.map(s => (
              <label key={s} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <Checkbox checked={draftSectors.includes(s)} onCheckedChange={() => toggleSec(s)} />
                <span>{s}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
          <p className={`text-xs ${capped ? 'text-warning' : 'text-muted-foreground'}`}>
            Each run will enqueue <strong>{Math.min(combos, SWEEP_CAP)}</strong> of {combos} (province × sector) combos
            {capped && <> — capped at {SWEEP_CAP}.</>}
          </p>
          <Button onClick={addSweep}>Add sweep</Button>
        </div>
      </Card>

      <p className="text-[10px] text-muted-foreground">
        Each enabled sweep gets its own pg_cron job. The queue drainer runs every 2 minutes and fires one job at a time to respect AI provider rate limits.
      </p>
    </div>
  );
}
