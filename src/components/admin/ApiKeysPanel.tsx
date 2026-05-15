import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Key, Plus, Loader2, Trash2, Activity, Search, Sparkles, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

type Provider = 'tavily' | 'mistral' | 'google' | 'lovable';

type ApiKeyRow = {
  id: string;
  provider: Provider;
  label: string | null;
  key_value: string;
  position: number;
  is_exhausted: boolean;
  exhausted_reason: string | null;
  last_exhausted_at: string | null;
  last_succeeded_at: string | null;
  credits_used: number | null;
  credits_total: number | null;
  credits_checked_at: string | null;
  updated_at: string;
};

// Mask: show first 12 chars of the key, the rest as asterisks.
// `tvly-dev-4ROA**********`, `Axt0aPkpCmHN********************`.
const maskKey = (k: string) => {
  if (!k) return '—';
  if (k.length <= 12) return k;
  return k.slice(0, 12) + '*'.repeat(Math.min(20, k.length - 12));
};

const fmtTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export function ApiKeysPanel() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState<Provider | null>(null);
  const [reshuffling, setReshuffling] = useState<Provider | null>(null);

  const refresh = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('api_keys').select('*')
      .order('provider', { ascending: true })
      .order('is_exhausted', { ascending: true })
      .order('position', { ascending: true });
    setRows((data ?? []) as ApiKeyRow[]);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const tavilyKeys  = rows.filter(r => r.provider === 'tavily');
  const mistralKeys = rows.filter(r => r.provider === 'mistral');

  const checkKey = async (row: ApiKeyRow) => {
    setChecking(row.id);
    const { data, error } = await supabase.functions.invoke('check-api-key', { body: { keyId: row.id } });
    setChecking(null);
    if (error) return toast.error(error.message);
    const result = data as { status: string; detail?: string; credits_used?: number; credits_total?: number };
    if (result.status === 'ok') {
      const credits = result.credits_total
        ? `${result.credits_used ?? 0} used · ${Math.max(0, (result.credits_total ?? 0) - (result.credits_used ?? 0))} left · ${result.credits_total} plan`
        : 'alive (provider doesn\'t expose credit balance)';
      toast.success(`${row.provider} ${row.label ?? ''}: ${credits}`);
    } else {
      toast.error(`${row.provider} ${row.label ?? ''}: ${result.status}${result.detail ? ` — ${result.detail}` : ''}`);
    }
    refresh();
  };

  // Probe every key in the provider's column. Sequentially to avoid
  // hammering the provider, but with no artificial delay between calls.
  const checkAll = async (provider: Provider) => {
    setCheckingAll(provider);
    const targets = rows.filter(r => r.provider === provider);
    let ok = 0, failed = 0;
    for (const row of targets) {
      try {
        const { data } = await supabase.functions.invoke('check-api-key', { body: { keyId: row.id } });
        if ((data as { status?: string })?.status === 'ok') ok++; else failed++;
      } catch { failed++; }
    }
    setCheckingAll(null);
    toast.success(`Checked ${targets.length} ${provider} keys · ${ok} alive · ${failed} exhausted/error`);
    refresh();
  };

  // Compact position numbers per provider — alive keys to 1..N, exhausted
  // keys to N+1..M, preserving the current display order within each
  // group. Useful after several add/exhaust cycles when position values
  // get gappy and a newly-added alive key ends up with a higher position
  // than older still-alive keys (which can hide it in the rotation
  // priority — even though `is_exhausted ASC, position ASC` already
  // puts alive ones first, position numbers being out of order makes
  // the panel confusing to read). Edge functions read the same order,
  // so callers naturally try alive keys first regardless of position
  // numbering — this is mostly a hygiene operation, but it also brings
  // any newly-revived alive key to the top of its group on the next
  // edge-function call.
  const reshuffle = async (provider: Provider) => {
    setReshuffling(provider);
    const { data: keys, error: fetchErr } = await supabase
      .from('api_keys')
      .select('id, position, is_exhausted')
      .eq('provider', provider)
      .order('is_exhausted', { ascending: true })
      .order('position', { ascending: true });
    if (fetchErr || !keys || keys.length === 0) {
      setReshuffling(null);
      return fetchErr
        ? toast.error(fetchErr.message)
        : toast.message(`No ${provider} keys to reshuffle`);
    }
    let changed = 0;
    let aliveCount = 0;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i] as { id: string; position: number; is_exhausted: boolean };
      if (!k.is_exhausted) aliveCount += 1;
      const targetPosition = i + 1;
      if (k.position === targetPosition) continue;
      const { error: updErr } = await supabase
        .from('api_keys')
        .update({ position: targetPosition })
        .eq('id', k.id);
      if (updErr) {
        setReshuffling(null);
        toast.error(`Reshuffle stopped: ${updErr.message}`);
        await refresh();
        return;
      }
      changed += 1;
    }
    setReshuffling(null);
    toast.success(
      `Reshuffled ${keys.length} ${provider} key${keys.length === 1 ? '' : 's'} — ${aliveCount} alive at positions 1..${aliveCount}` +
      (changed === 0 ? ' (already in order)' : `, ${changed} position${changed === 1 ? '' : 's'} updated`)
    );
    refresh();
  };

  const deleteKey = async (row: ApiKeyRow) => {
    if (!confirm(`Delete ${row.provider} key${row.label ? ` "${row.label}"` : ''}? It stops being used immediately.`)) return;
    const { error } = await supabase.from('api_keys').delete().eq('id', row.id);
    if (error) return toast.error(error.message);
    toast.success('Key deleted');
    refresh();
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold flex items-center gap-2">
          <Key className="h-4 w-4 text-accent" /> API Keys
        </h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Keys are tried in order, exhausted ones move to the bottom automatically (Tavily 401/429/432/433 · Mistral 402 / free-tier 429).
        New keys land at the bottom by default. Click <span className="font-mono">Check</span> on a row to probe credits and revive a fixed key.
        Use <span className="font-mono">Reshuffle</span> to compact position numbers — alive keys to positions 1..N, exhausted to the bottom — so newly-revived keys land in front of older exhausted ones on the next call.
      </p>

      {loading && (
        <div className="text-xs text-muted-foreground py-2 inline-flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}

      {!loading && (
        <div className="grid md:grid-cols-2 gap-4">
          <ProviderColumn
            title="Tavily (web search)"
            provider="tavily"
            rows={tavilyKeys}
            checkingId={checking}
            checkingAll={checkingAll === 'tavily'}
            reshuffling={reshuffling === 'tavily'}
            onCheck={checkKey}
            onCheckAll={() => checkAll('tavily')}
            onReshuffle={() => reshuffle('tavily')}
            onDelete={deleteKey}
            onAdded={refresh}
            userId={user?.id ?? null}
            accentClass="border-accent/30 bg-accent/5"
          />
          <ProviderColumn
            title="Mistral (chat / extraction)"
            provider="mistral"
            rows={mistralKeys}
            checkingId={checking}
            checkingAll={checkingAll === 'mistral'}
            reshuffling={reshuffling === 'mistral'}
            onCheck={checkKey}
            onCheckAll={() => checkAll('mistral')}
            onReshuffle={() => reshuffle('mistral')}
            onDelete={deleteKey}
            onAdded={refresh}
            userId={user?.id ?? null}
            accentClass="border-info/30 bg-info/5"
          />
        </div>
      )}
    </Card>
  );
}

type ColumnProps = {
  title: string;
  provider: Provider;
  rows: ApiKeyRow[];
  checkingId: string | null;
  checkingAll: boolean;
  reshuffling: boolean;
  onCheck: (r: ApiKeyRow) => void;
  onCheckAll: () => void;
  onReshuffle: () => void;
  onDelete: (r: ApiKeyRow) => void;
  onAdded: () => void;
  userId: string | null;
  accentClass: string;
};

function ProviderColumn(p: ColumnProps) {
  const aliveCount = p.rows.filter(r => !r.is_exhausted).length;
  const exhaustedCount = p.rows.length - aliveCount;
  const ProviderIcon = p.provider === 'tavily' ? Search : Sparkles;
  return (
    <div className={cn('rounded-md border p-3 space-y-3', p.accentClass)}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-semibold text-sm inline-flex items-center gap-2">
          <ProviderIcon className="h-4 w-4" /> {p.title}
        </div>
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
          <span className="text-success">{aliveCount} alive</span>
          {exhaustedCount > 0 && <span className="text-destructive"> · {exhaustedCount} exhausted</span>}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <AddKeyDialog provider={p.provider} onAdded={p.onAdded} userId={p.userId} />
        <Button
          size="sm" variant="outline"
          disabled={p.rows.length === 0 || p.checkingAll || p.reshuffling}
          onClick={p.onCheckAll}
          title="Probe every key in this column"
        >
          {p.checkingAll ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Activity className="h-3 w-3 mr-1" />}
          Check all
        </Button>
        <Button
          size="sm" variant="outline"
          disabled={p.rows.length === 0 || p.reshuffling || p.checkingAll}
          onClick={p.onReshuffle}
          title="Compact position numbers — alive keys to 1..N, exhausted to the bottom. Ensures any newly-revived alive key sits in front of older exhausted ones."
        >
          {p.reshuffling ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ArrowUpDown className="h-3 w-3 mr-1" />}
          Reshuffle
        </Button>
      </div>

      {p.rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No {p.provider} keys yet. Click "Add key" to register one. Edge functions fall back to env until you do.
        </div>
      ) : (
        // Mirrors the Sherlock queue list (max-h-[400px] overflow-y-auto in
        // SherlockManager.QueueTab). Caps each column so adding the 8th /
        // 9th / 10th Tavily key doesn't push the Mistral column off-screen
        // — only the rows inside the column scroll.
        <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
          {p.rows.map(row => <KeyRow key={row.id} row={row} checkingId={p.checkingId} onCheck={p.onCheck} onDelete={p.onDelete} />)}
        </div>
      )}
    </div>
  );
}

function KeyRow({ row, checkingId, onCheck, onDelete }: {
  row: ApiKeyRow;
  checkingId: string | null;
  onCheck: (r: ApiKeyRow) => void;
  onDelete: (r: ApiKeyRow) => void;
}) {
  const creditPct = row.credits_total
    ? Math.min(100, Math.round(((row.credits_used ?? 0) / row.credits_total) * 100))
    : null;
  const fmtTimeShort = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  return (
    <div className={cn(
      'rounded-md border p-3 space-y-2 bg-background',
      row.is_exhausted && 'opacity-70 border-destructive/30',
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs truncate" title={maskKey(row.key_value)}>
            {maskKey(row.key_value)}
          </div>
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {row.label || <span className="italic">(no label)</span>}
            <span className="font-mono text-[10px] ml-1">· pos {row.position}</span>
          </div>
        </div>
        <Badge variant="outline" className={cn(
          'text-[10px] font-mono shrink-0',
          row.is_exhausted ? 'border-destructive/40 text-destructive bg-destructive/5'
                           : 'border-success/40 text-success bg-success/5',
        )}>
          {row.is_exhausted ? 'exhausted' : 'active'}
        </Badge>
      </div>

      {row.credits_total ? (() => {
        // Three-number display: used · remaining · total. Tavily reports
        // both per-key and account-level counters; we store account-level
        // (the pool every key on the same Tavily account shares), so all
        // alive keys for a given account read the same numbers after a
        // Check. Exhausted keys still show real numbers — if the account
        // hit its 1000-credit cap, every key reads as `1000 · 0 · 1000`.
        const used = row.credits_used ?? 0;
        const total = row.credits_total ?? 0;
        const remaining = Math.max(0, total - used);
        return (
          <div>
            <div className="flex items-baseline justify-between text-[11px] font-mono gap-2">
              <span className="text-muted-foreground">credits</span>
              <span className="tabular-nums">
                {used}
                <span className="text-muted-foreground"> used · </span>
                {remaining}
                <span className="text-muted-foreground"> left · </span>
                {total}
                <span className="text-muted-foreground"> plan</span>
              </span>
            </div>
            <div className="w-full h-1.5 bg-muted rounded-full mt-0.5 overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all',
                  (creditPct ?? 0) > 90 ? 'bg-destructive'
                    : (creditPct ?? 0) > 70 ? 'bg-warning' : 'bg-success'
                )}
                style={{ width: `${creditPct ?? 0}%` }}
              />
            </div>
          </div>
        );
      })() : null}

      {row.exhausted_reason && (
        <div className="text-[10px] text-destructive font-mono truncate" title={row.exhausted_reason}>
          {row.exhausted_reason}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="text-[10px] text-muted-foreground font-mono">
          {row.last_succeeded_at && <span title={row.last_succeeded_at}>last ok {fmtTimeShort(row.last_succeeded_at)}</span>}
          {row.last_succeeded_at && row.last_exhausted_at && ' · '}
          {row.last_exhausted_at && <span className="text-destructive" title={row.last_exhausted_at}>last fail {fmtTimeShort(row.last_exhausted_at)}</span>}
          {!row.last_succeeded_at && !row.last_exhausted_at && <span>never checked</span>}
        </div>
        <div className="inline-flex items-center gap-1">
          <Button
            size="sm" variant="outline" className="h-7 px-2"
            disabled={checkingId === row.id}
            onClick={() => onCheck(row)}
          >
            {checkingId === row.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Activity className="h-3 w-3 mr-1" /> Check</>}
          </Button>
          <Button
            size="sm" variant="ghost" className="h-7 px-1.5 text-destructive hover:text-destructive"
            onClick={() => onDelete(row)}
            title="Delete this key"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddKeyDialog({ provider, onAdded, userId }: { provider: Provider; onAdded: () => void; userId: string | null }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setLabel(''); setValue(''); };

  const submit = async () => {
    if (!value.trim()) return toast.error('Paste the key value');
    setBusy(true);
    // New keys go to the bottom of the column by default (max+1 position).
    const { data: maxRow } = await supabase
      .from('api_keys').select('position').eq('provider', provider)
      .order('position', { ascending: false }).limit(1).maybeSingle();
    const nextPos = ((maxRow as { position?: number })?.position ?? 0) + 1;
    const { error } = await supabase.from('api_keys').insert({
      provider,
      label: label.trim() || null,
      key_value: value.trim(),
      position: nextPos,
      // Tavily plan-limit is 1000 credits/month on free; pre-seed the total
      // so the UI can show progress even before the first Check.
      credits_total: provider === 'tavily' ? 1000 : null,
      created_by: userId,
    });
    setBusy(false);
    if (error) {
      if (error.code === '23505') toast.error('Key already registered for this provider.');
      else toast.error(error.message);
      return;
    }
    toast.success(`Added ${provider} key (position ${nextPos})`);
    reset();
    setOpen(false);
    onAdded();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="h-3 w-3 mr-1" /> Add key
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a {provider} key</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Label (optional)</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder={provider === 'tavily' ? 'e.g. Tavily team account #4' : 'e.g. Mistral fallback'} maxLength={80} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Key value</Label>
            <Input value={value} onChange={e => setValue(e.target.value)} placeholder={provider === 'tavily' ? 'tvly-dev-…' : 'sk-… or raw key'} autoFocus />
            <p className="text-[10px] text-muted-foreground">
              Pasted value is stored in the api_keys table (RLS-protected, moderator-only). The new key goes to the bottom of the rotation; if it works on the next call it stays there until a higher-priority key exhausts.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null} Add key
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
