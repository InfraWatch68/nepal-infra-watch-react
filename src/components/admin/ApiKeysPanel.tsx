import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Key, Plus, Loader2, Trash2, Pencil, Activity } from 'lucide-react';
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

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: 'tavily',  label: 'Tavily (web search)' },
  { value: 'mistral', label: 'Mistral (chat / extraction)' },
  { value: 'google',  label: 'Google AI (Gemini)' },
  { value: 'lovable', label: 'Lovable gateway' },
];

const maskKey = (k: string) => {
  if (!k) return '—';
  if (k.length <= 12) return k.slice(0, 3) + '…';
  return k.slice(0, 8) + '…' + k.slice(-6);
};

const fmtTime = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export function ApiKeysPanel() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<string | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');

  const refresh = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('api_keys')
      .select('*')
      .order('provider', { ascending: true })
      .order('is_exhausted', { ascending: true })
      .order('position', { ascending: true });
    setRows((data ?? []) as ApiKeyRow[]);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const checkKey = async (row: ApiKeyRow) => {
    setChecking(row.id);
    const { data, error } = await supabase.functions.invoke('check-api-key', { body: { keyId: row.id } });
    setChecking(null);
    if (error) return toast.error(error.message);
    const result = data as { status: string; detail?: string; credits_used?: number; credits_total?: number };
    if (result.status === 'ok') {
      const credits = result.credits_total
        ? `${result.credits_used ?? 0}/${result.credits_total} credits used`
        : 'check OK (credits not exposed)';
      toast.success(`${row.provider} key: ${credits}`);
    } else {
      toast.error(`${row.provider} key: ${result.status}${result.detail ? ` — ${result.detail}` : ''}`);
    }
    refresh();
  };

  const deleteKey = async (row: ApiKeyRow) => {
    if (!confirm(`Delete this ${row.provider} key${row.label ? ` "${row.label}"` : ''}? It will stop being used immediately.`)) return;
    const { error } = await supabase.from('api_keys').delete().eq('id', row.id);
    if (error) return toast.error(error.message);
    toast.success('Key deleted');
    refresh();
  };

  const saveLabel = async (row: ApiKeyRow) => {
    const trimmed = labelDraft.trim().slice(0, 80) || null;
    const { error } = await supabase.from('api_keys').update({ label: trimmed }).eq('id', row.id);
    if (error) return toast.error(error.message);
    setEditingLabelId(null);
    setLabelDraft('');
    refresh();
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold flex items-center gap-2">
          <Key className="h-4 w-4 text-accent" /> API Keys
        </h3>
        <AddKeyDialog onAdded={refresh} userId={user?.id ?? null} />
      </div>
      <p className="text-xs text-muted-foreground">
        Keys are tried in order. When a key exhausts (Tavily 401/429/432/433 or Mistral 402 / free-tier 429), it's automatically
        flagged and moved to the bottom of its provider's rotation, so subsequent calls skip past it. Click <span className="font-mono">Check</span> to
        probe a key's current credit balance and revive a manually-fixed key.
      </p>

      {loading && (
        <div className="text-xs text-muted-foreground py-2 inline-flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No keys yet. Click <span className="font-mono">Add key</span> above to register one. The edge functions fall back to
          environment secrets until at least one key is added for that provider.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider font-mono text-muted-foreground border-b">
              <tr className="text-left">
                <th className="px-2 py-2">Provider</th>
                <th className="px-2 py-2">Label</th>
                <th className="px-2 py-2">Key</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Credits</th>
                <th className="px-2 py-2">Last ok</th>
                <th className="px-2 py-2">Last fail</th>
                <th className="px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const creditPct = row.credits_total
                  ? Math.min(100, Math.round(((row.credits_used ?? 0) / row.credits_total) * 100))
                  : null;
                return (
                  <tr key={row.id} className="border-b border-border/60 align-top">
                    <td className="px-2 py-3 font-mono text-xs uppercase">{row.provider}</td>
                    <td className="px-2 py-3 text-xs min-w-[140px]">
                      {editingLabelId === row.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={labelDraft}
                            onChange={e => setLabelDraft(e.target.value)}
                            className="h-7 text-xs"
                            autoFocus
                            onKeyDown={e => { if (e.key === 'Enter') saveLabel(row); if (e.key === 'Escape') { setEditingLabelId(null); setLabelDraft(''); } }}
                          />
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => saveLabel(row)}>Save</Button>
                        </div>
                      ) : (
                        <button
                          className="text-left hover:underline w-full truncate"
                          onClick={() => { setEditingLabelId(row.id); setLabelDraft(row.label ?? ''); }}
                          title="Click to edit"
                        >
                          {row.label || <span className="text-muted-foreground italic">(no label)</span>}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-3 font-mono text-[11px]">{maskKey(row.key_value)}</td>
                    <td className="px-2 py-3">
                      {row.is_exhausted ? (
                        <Badge variant="outline" className="text-[10px] font-mono border-destructive/40 text-destructive bg-destructive/5">
                          exhausted
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] font-mono border-success/40 text-success bg-success/5">
                          active
                        </Badge>
                      )}
                      {row.exhausted_reason && (
                        <div className="text-[10px] text-muted-foreground font-mono mt-1 truncate max-w-[140px]" title={row.exhausted_reason}>
                          {row.exhausted_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-3 text-xs">
                      {row.credits_total ? (
                        <div>
                          <div className="font-mono">{row.credits_used ?? 0}/{row.credits_total}</div>
                          <div className="w-20 h-1 bg-muted rounded-full mt-1 overflow-hidden">
                            <div
                              className={cn('h-full', (creditPct ?? 0) > 90 ? 'bg-destructive' : (creditPct ?? 0) > 70 ? 'bg-warning' : 'bg-success')}
                              style={{ width: `${creditPct ?? 0}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground font-mono">—</span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-[11px] font-mono text-muted-foreground">{fmtTime(row.last_succeeded_at)}</td>
                    <td className="px-2 py-3 text-[11px] font-mono text-muted-foreground">{fmtTime(row.last_exhausted_at)}</td>
                    <td className="px-2 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          size="sm" variant="outline" className="h-7 px-2"
                          disabled={checking === row.id}
                          onClick={() => checkKey(row)}
                          title="Probe the provider and update credits + status"
                        >
                          {checking === row.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Activity className="h-3 w-3 mr-1" /> Check</>}
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive"
                          onClick={() => deleteKey(row)}
                          title="Delete this key"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AddKeyDialog({ onAdded, userId }: { onAdded: () => void; userId: string | null }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>('tavily');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setProvider('tavily'); setLabel(''); setValue(''); };

  const submit = async () => {
    if (!value.trim()) return toast.error('Paste the key value');
    setBusy(true);
    // Find the current max position for this provider so the new key goes
    // to the bottom by default (admin can rerun a check to verify it works,
    // then it'll naturally float to the top on success).
    const { data: maxRow } = await supabase
      .from('api_keys').select('position').eq('provider', provider)
      .order('position', { ascending: false }).limit(1).maybeSingle();
    const nextPos = ((maxRow as { position?: number })?.position ?? 0) + 1;
    const { error } = await supabase.from('api_keys').insert({
      provider,
      label: label.trim() || null,
      key_value: value.trim(),
      position: nextPos,
      created_by: userId,
    });
    setBusy(false);
    if (error) {
      // Most likely cause: unique violation on (provider, key_value).
      if (error.code === '23505') {
        toast.error('That key is already registered for this provider.');
      } else {
        toast.error(error.message);
      }
      return;
    }
    toast.success(`Added ${provider} key`);
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
          <DialogTitle>Register an API key</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Provider</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Label (optional)</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Tavily team account #2" maxLength={80} />
            <p className="text-[10px] text-muted-foreground">Free-text — helps you tell keys apart in the list.</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Key value</Label>
            <Input value={value} onChange={e => setValue(e.target.value)} placeholder="tvly-dev-... or full key string" />
            <p className="text-[10px] text-muted-foreground">
              The value is stored in the database (RLS-protected, moderator-only read). Existing matching keys for the same
              provider will be rejected by the unique constraint.
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
