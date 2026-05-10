import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Loader2, Search, Trash2, Play, Plus } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

type Filter = {
  id: string;
  label: string;
  topic: string | null;
  region: string | null;
  max_results: number;
  active: boolean;
  last_run_at: string | null;
  last_inserted: number | null;
};

export function SherlockManager() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<Filter[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  // New filter draft
  const [draftLabel, setDraftLabel] = useState('');
  const [draftTopic, setDraftTopic] = useState('');
  const [draftRegion, setDraftRegion] = useState('');
  const [draftMax, setDraftMax] = useState(3);

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('sherlock_filters').select('*').order('created_at', { ascending: true });
    setFilters((data ?? []) as Filter[]);
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
    toast.success(`Sherlock filter "${draftLabel}" added`);
    setDraftLabel(''); setDraftTopic(''); setDraftRegion(''); setDraftMax(3);
    refresh();
  };

  const toggleActive = async (f: Filter) => {
    await supabase.from('sherlock_filters').update({ active: !f.active }).eq('id', f.id);
    refresh();
  };

  const deleteFilter = async (id: string) => {
    if (!confirm('Delete this Sherlock filter?')) return;
    await supabase.from('sherlock_filters').delete().eq('id', id);
    toast.success('Filter removed');
    refresh();
  };

  const runOne = async (f: Filter) => {
    setBusyId(f.id);
    const { data, error } = await supabase.functions.invoke('ai-discover-projects', {
      body: {
        topic: f.topic ?? undefined,
        region: f.region ?? undefined,
        maxResults: f.max_results,
        aiTag: 'Sherlock',
      },
    });
    if (error) { setBusyId(null); toast.error(error.message); return; }
    const inserted = Number(data?.inserted ?? 0);
    await supabase.from('sherlock_filters').update({
      last_run_at: new Date().toISOString(),
      last_inserted: inserted,
    }).eq('id', f.id);
    setBusyId(null);
    toast.success(`Sherlock "${f.label}": ${inserted} new project${inserted === 1 ? '' : 's'}, ${data?.skipped ?? 0} skipped`);
    refresh();
  };

  const runAllActive = async () => {
    const active = filters.filter(f => f.active);
    if (active.length === 0) return toast.error('No active filters');
    setBulkBusy(true);
    let total = 0;
    for (let i = 0; i < active.length; i++) {
      const f = active[i];
      try {
        const { data, error } = await supabase.functions.invoke('ai-discover-projects', {
          body: { topic: f.topic ?? undefined, region: f.region ?? undefined, maxResults: f.max_results, aiTag: 'Sherlock' },
        });
        if (!error) {
          const inserted = Number(data?.inserted ?? 0);
          total += inserted;
          await supabase.from('sherlock_filters').update({
            last_run_at: new Date().toISOString(),
            last_inserted: inserted,
          }).eq('id', f.id);
        }
      } catch { /* keep going */ }
      // Pace between calls — Mistral RPM friendliness.
      if (i < active.length - 1) await new Promise(r => setTimeout(r, 4000));
    }
    setBulkBusy(false);
    toast.success(`Sherlock pass complete: ${total} new project${total === 1 ? '' : 's'} across ${active.length} filter${active.length === 1 ? '' : 's'}`);
    refresh();
  };

  return (
    <div className="space-y-3 pt-3 border-t border-accent/20">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Search className="h-3.5 w-3.5" /> Sherlock — autonomous discovery</p>
          <p className="text-xs text-muted-foreground">Stored filters that run AI discovery and tag every find with a Sherlock badge in the review queue.</p>
        </div>
        <Button onClick={runAllActive} disabled={bulkBusy || filters.filter(f => f.active).length === 0}>
          {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run all active
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
                  {f.last_run_at && (
                    <> · last run {new Date(f.last_run_at).toLocaleString()}{f.last_inserted != null ? ` (+${f.last_inserted})` : ''}</>
                  )}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => runOne(f)} disabled={busyId === f.id || bulkBusy}>
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
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add a Sherlock filter</div>
        <div className="grid sm:grid-cols-[1fr_1fr_1fr_120px_auto] gap-2 items-start">
          <Input placeholder="Label e.g. Bagmati hydro" value={draftLabel} onChange={e => setDraftLabel(e.target.value)} />
          <Input placeholder="Topic (optional)" value={draftTopic} onChange={e => setDraftTopic(e.target.value)} />
          <Input placeholder="Region (optional)" value={draftRegion} onChange={e => setDraftRegion(e.target.value)} />
          <Select value={String(draftMax)} onValueChange={(v) => setDraftMax(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{[1,2,3,5,8,10].map(n => <SelectItem key={n} value={String(n)}>{n}/run</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={createFilter}>Add</Button>
        </div>
      </Card>

      <p className="text-[10px] text-muted-foreground font-mono">
        Tip: schedule "run all active" via pg_cron or a GitHub Action calling /functions/v1/ai-discover-projects with aiTag="Sherlock" to make discovery truly continuous.
      </p>
    </div>
  );
}
