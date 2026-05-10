import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ShieldAlert, Loader2, X, Check } from 'lucide-react';
import { toast } from 'sonner';

type Proposal = {
  id: string;
  target_user_id: string;
  proposed_by: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  executed_at: string | null;
  created_at: string;
};

type Vote = { id: string; proposal_id: string; voter_id: string; vote: 'yes' | 'no' };
type ProfileLite = { id: string; full_name: string | null; email: string | null };

export function AdminRemovalPanel({ admins }: { admins: Array<{ id: string; full_name: string | null; email: string | null }> }) {
  const { user } = useAuth();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [proposeFor, setProposeFor] = useState<ProfileLite | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [{ data: ps }, { data: vs }] = await Promise.all([
      supabase.from('admin_removal_proposals').select('*').order('created_at', { ascending: false }),
      supabase.from('admin_removal_votes').select('*'),
    ]);
    setProposals((ps ?? []) as Proposal[]);
    setVotes((vs ?? []) as Vote[]);
    const ids = new Set<string>();
    (ps ?? []).forEach((p: any) => { ids.add(p.target_user_id); ids.add(p.proposed_by); });
    if (ids.size > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', Array.from(ids));
      setProfiles(Object.fromEntries((profs ?? []).map((p: any) => [p.id, p])));
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const propose = async () => {
    if (!proposeFor) return;
    if (reason.trim().length < 10) return toast.error('Give a reason (at least 10 chars)');
    setBusy(true);
    const { error } = await supabase.from('admin_removal_proposals').insert({
      target_user_id: proposeFor.id,
      proposed_by: user!.id,
      reason: reason.trim(),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Proposal opened to remove ${proposeFor.full_name ?? proposeFor.email}`);
    setProposeFor(null); setReason('');
    refresh();
  };

  const vote = async (proposal_id: string, choice: 'yes' | 'no') => {
    setBusy(true);
    const { error } = await supabase.from('admin_removal_votes').insert({ proposal_id, voter_id: user!.id, vote: choice });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Voted ${choice}`);
    refresh();
  };

  const cancel = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.from('admin_removal_proposals').update({ status: 'cancelled' }).eq('id', id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Proposal cancelled');
    refresh();
  };

  const adminCount = admins.length;
  const otherAdmins = admins.filter(a => a.id !== user?.id);
  const pending = proposals.filter(p => p.status === 'pending');

  return (
    <Card className="p-5 border-destructive/30">
      <div className="flex items-start gap-2 mb-3">
        <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold">Admin removal — vote required</h3>
          <p className="text-xs text-muted-foreground">
            Removing another admin needs at least 2 yes-votes from other admins, and a 2/3 majority of admins (excluding the target). Direct role-deletion is blocked at the DB layer.
          </p>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="space-y-2 mb-4">
          {pending.map(p => {
            const target = profiles[p.target_user_id];
            const proposer = profiles[p.proposed_by];
            const myVote = votes.find(v => v.proposal_id === p.id && v.voter_id === user!.id);
            const yesVotes = votes.filter(v => v.proposal_id === p.id && v.vote === 'yes' && v.voter_id !== p.target_user_id).length;
            const eligible = adminCount - 1; // excluding target
            const threshold = Math.max(2, Math.ceil(eligible * 2 / 3));
            const isTarget = user?.id === p.target_user_id;
            const isProposer = user?.id === p.proposed_by;
            return (
              <Card key={p.id} className="p-3 bg-destructive/5 border-destructive/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">Remove {target?.full_name ?? target?.email ?? 'admin'}</div>
                    <div className="text-xs text-muted-foreground">
                      Proposed by {proposer?.full_name ?? proposer?.email ?? 'admin'} on {new Date(p.created_at).toLocaleString()}
                    </div>
                    <p className="text-sm mt-1.5 italic">"{p.reason}"</p>
                    <div className="text-xs font-mono mt-2">
                      Yes: <strong>{yesVotes}</strong> / threshold {threshold} (of {eligible} eligible admins)
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {!isTarget && !myVote && (
                      <>
                        <Button size="sm" variant="default" disabled={busy} onClick={() => vote(p.id, 'yes')}>
                          <Check className="h-3.5 w-3.5" /> Vote yes
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => vote(p.id, 'no')}>
                          <X className="h-3.5 w-3.5" /> Vote no
                        </Button>
                      </>
                    )}
                    {myVote && <Badge variant="outline" className="font-mono">You voted {myVote.vote}</Badge>}
                    {isTarget && <Badge variant="outline" className="font-mono">You're the target</Badge>}
                    {isProposer && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancel(p.id)} className="text-muted-foreground">Cancel proposal</Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {otherAdmins.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">You are the only admin — no removal proposals are possible.</p>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {otherAdmins.map(a => (
            <Dialog key={a.id} open={proposeFor?.id === a.id} onOpenChange={(o) => { if (!o) { setProposeFor(null); setReason(''); } }}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" onClick={() => setProposeFor(a)}>
                  Propose removing {a.full_name ?? a.email}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Propose removing {a.full_name ?? a.email}</DialogTitle></DialogHeader>
                <p className="text-xs text-muted-foreground">Other admins will vote on this proposal. Be specific about why removal is appropriate.</p>
                <Textarea rows={4} placeholder="Reason (visible to all admins)…" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} />
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => { setProposeFor(null); setReason(''); }}>Cancel</Button>
                  <Button variant="destructive" onClick={propose} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Open proposal'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          ))}
        </div>
      )}
    </Card>
  );
}
