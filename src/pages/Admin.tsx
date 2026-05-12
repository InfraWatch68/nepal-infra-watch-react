// After any schema migration, regenerate types with:
//   npx supabase gen types typescript --project-id vlioybqqswbohdhpnjym > src/integrations/supabase/types.ts

import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Shield, Megaphone, Sparkles, Loader2, ExternalLink, Users as UsersIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SECTORS, PROVINCES, districtsFor } from '@/lib/constants';
import { VerifyDialog } from '@/components/admin/VerifyDialog';
import { SherlockManager } from '@/components/admin/SherlockManager';
import { ProjectModerationTab } from '@/components/admin/ProjectModerationTab';
import { AdminRemovalPanel } from '@/components/admin/AdminRemovalPanel';
import { ReviewHistoryIcon } from '@/components/ReviewHistoryIcon';

const APPROVAL_COLORS: Record<string, string> = {
  pending: 'bg-warning/15 text-warning',
  approved: 'bg-success/15 text-success',
  rejected: 'bg-destructive/15 text-destructive',
  changes_requested: 'bg-info/15 text-info',
};

// Per-status status-light dot — surfaces queue state at a glance.
// 🟢 approved · 🔵 changes_requested · 🟠 pending · 🔴 rejected
const APPROVAL_DOT: Record<string, string> = {
  approved: 'bg-success',
  changes_requested: 'bg-info',
  pending: 'bg-warning',
  rejected: 'bg-destructive',
};
function StatusDot({ status }: { status: string }) {
  return <span className={cn('inline-block h-2.5 w-2.5 rounded-full shrink-0', APPROVAL_DOT[status] ?? 'bg-muted')} aria-label={status} />;
}

// supabase.functions.invoke returns a generic "non-2xx status" message and
// stashes the actual response on error.context. Pull the JSON body so the
// admin sees the real error text from the function (Tavily 502, no keys, etc.)
async function extractFnError(error: any): Promise<string> {
  if (!error) return 'Unknown error';
  try {
    const ctx = error.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    }
  } catch {
    /* fall through to default message */
  }
  return error.message ?? 'Unknown error';
}

const AiBadge = ({ tag }: { tag?: string | null }) => (
  <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-mono border-accent text-accent">
    <Sparkles className="h-3 w-3 mr-1" /> {tag || 'AI'}
  </Badge>
);

// AI-rated confidence. Green ≥ auto-approve threshold (drove auto-publish),
// amber 0.60-0.84 (held for moderation), red below 0.60 (low-trust extract).
// Tooltip mirrors the rubric in the ai-discover-projects extraction prompt —
// keep these strings in sync with that prompt's CONFIDENCE RUBRIC section.
const confidenceReason = (score: number): string => {
  if (score >= 0.95) return 'Project unambiguously named with budget, agency, dates and location all stated';
  if (score >= 0.80) return 'Project named clearly with 3+ concrete fields (sector, location, agency, or budget)';
  if (score >= 0.60) return 'Project named but key fields like location or budget are inferred or vague';
  if (score >= 0.40) return 'Project mentioned in passing; significant fields guessed by the model';
  return 'Very low confidence — model would normally skip records below 0.40';
};

const ConfidenceBadge = ({ score }: { score: number | null | undefined }) => {
  if (score == null || !Number.isFinite(score)) return null;
  const pct = Math.round(score * 100);
  const tone = score >= 0.85 ? 'border-success text-success'
    : score >= 0.60 ? 'border-warning text-warning'
    : 'border-destructive text-destructive';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn('text-[10px] uppercase tracking-wider font-mono cursor-help', tone)}>
          {pct}%
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
        {confidenceReason(score)}
      </TooltipContent>
    </Tooltip>
  );
};

export default function Admin() {
  const { user, isReviewer, isAdmin, isCoadmin, loading } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [pendingUpdates, setPendingUpdates] = useState<any[]>([]);
  const [pendingSources, setPendingSources] = useState<any[]>([]);
  const [ads, setAds] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [stats, setStats] = useState({ pending: 0, approved: 0, total: 0, aiInserted: 0, aiApproved: 0 });
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [globalScope, setGlobalScope] = useState<'all' | 'province' | 'sector'>('all');
  const [globalProvince, setGlobalProvince] = useState<string>('');
  const [globalSector, setGlobalSector] = useState<string>('');
  const [busyGlobal, setBusyGlobal] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; current?: string } | null>(null);

  const refresh = async () => {
    const { data } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
    setProjects(data ?? []);
    const d = data ?? [];
    setStats({
      pending: d.filter(p => p.approval_status === 'pending').length,
      approved: d.filter(p => p.approval_status === 'approved').length,
      total: d.length,
      aiInserted: d.filter(p => p.submitted_by_ai).length,
      aiApproved: d.filter(p => p.submitted_by_ai && p.approval_status === 'approved').length,
    });

    const { data: pu } = await supabase
      .from('project_updates')
      .select('id, title, content, update_type, created_at, approval_status, submitted_by_ai, project_id, projects(title, slug)')
      .in('approval_status', ['pending', 'changes_requested'])
      .order('created_at', { ascending: false });
    setPendingUpdates(pu ?? []);

    const { data: ps } = await supabase
      .from('project_sources')
      .select('id, title, url, source_type, created_at, approval_status, submitted_by_ai, project_id, projects(title, slug)')
      .in('approval_status', ['pending', 'changes_requested'])
      .order('created_at', { ascending: false });
    setPendingSources(ps ?? []);

    if (isAdmin || isCoadmin) {
      const { data: a } = await supabase.from('ad_slots').select('*').order('created_at', { ascending: false });
      setAds(a ?? []);
    }

    if (isAdmin) {
      const [{ data: profiles }, { data: roleRows }] = await Promise.all([
        supabase.from('profiles').select('id, email, full_name, organization, created_at').order('created_at', { ascending: false }),
        supabase.from('user_roles').select('user_id, role'),
      ]);
      const rolesByUser = new Map<string, string[]>();
      (roleRows ?? []).forEach((r: any) => {
        const arr = rolesByUser.get(r.user_id) ?? [];
        arr.push(r.role);
        rolesByUser.set(r.user_id, arr);
      });
      setUsers((profiles ?? []).map((p: any) => ({ ...p, roles: rolesByUser.get(p.id) ?? [] })));
    }
  };

  useEffect(() => { if (user && isReviewer) refresh(); /* eslint-disable-next-line */ }, [user, isReviewer, isAdmin, isCoadmin]);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isReviewer) return (
    <div className="min-h-screen flex flex-col"><SiteHeader />
      <div className="container py-20 text-center">
        <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h1 className="font-display text-2xl font-bold mb-2">Reviewer access required</h1>
        <p className="text-muted-foreground mb-6">Ask an admin to grant you the reviewer role.</p>
        <Button asChild><Link to="/dashboard">Back to dashboard</Link></Button>
      </div>
      <SiteFooter />
    </div>
  );

  // Reviewers (non-admin/non-coadmin) get a 24-hour publish delay so admins can
  // override before the row goes public. Admin and coadmin publishes are instant.
  const isInstantPublisher = isAdmin || isCoadmin;
  const computePublishedAt = (approval: string): string | null => {
    if (approval !== 'approved') return null;
    return isInstantPublisher
      ? new Date().toISOString()
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  };
  const logReview = async (target_table: string, target_id: string, action: string, notes?: string) => {
    const role = isAdmin ? 'admin' : isCoadmin ? 'coadmin' : 'reviewer';
    await supabase.from('project_reviews').insert({
      target_table, target_id: String(target_id),
      reviewer_id: user.id, reviewer_role: role,
      action, notes: notes ?? null,
      was_admin: isInstantPublisher,
    });
  };

  const review = async (
    id: string,
    approval_status: string,
    review_notes?: string,
    status?: string,
    edits?: Record<string, any>,
  ) => {
    const update: any = { ...(edits ?? {}), approval_status, reviewed_by: user.id };
    if (review_notes !== undefined) update.review_notes = review_notes;
    if (status) update.status = status;
    if (approval_status === 'approved' && !status) update.status = 'approved';
    update.published_at = computePublishedAt(approval_status);
    const { error } = await supabase.from('projects').update(update).eq('id', id);
    if (error) return toast.error(error.message);
    await logReview('projects', id, approval_status, review_notes);
    toast.success(approval_status === 'approved' && !isInstantPublisher
      ? 'Approved — will publish in 24h (admin can override)'
      : 'Updated');
    refresh();
  };

  const reviewUpdate = async (
    id: string,
    approval: 'approved' | 'rejected' | 'changes_requested',
    notes?: string,
    edits?: Record<string, any>,
  ) => {
    const upd: any = { ...(edits ?? {}), approval_status: approval, reviewed_by: user.id };
    if (notes !== undefined) upd.review_notes = notes;
    if (approval === 'approved') upd.published = true;
    if (approval === 'rejected') upd.published = false;
    upd.published_at = computePublishedAt(approval);
    const { error } = await supabase.from('project_updates').update(upd).eq('id', id);
    if (error) return toast.error(error.message);
    await logReview('project_updates', id, approval, notes);
    toast.success(approval === 'approved' && !isInstantPublisher ? 'Approved — publish in 24h' : 'Update reviewed');
    refresh();
  };

  const reviewSource = async (
    id: string,
    approval: 'approved' | 'rejected' | 'changes_requested',
    notes?: string,
    edits?: Record<string, any>,
  ) => {
    const upd: any = { ...(edits ?? {}), approval_status: approval, reviewed_by: user.id };
    if (notes !== undefined) upd.review_notes = notes;
    if (approval === 'approved') upd.verified = true;
    if (approval === 'rejected') upd.verified = false;
    upd.published_at = computePublishedAt(approval);
    const { error } = await supabase.from('project_sources').update(upd).eq('id', id);
    if (error) return toast.error(error.message);
    await logReview('project_sources', id, approval, notes);
    toast.success(approval === 'approved' && !isInstantPublisher ? 'Approved — publish in 24h' : 'Source reviewed');
    refresh();
  };

  // Admin override: instantly publish a row that was approved by a reviewer
  // and is still in the 24-hour delay window.
  const pushNow = async (target_table: string, id: string) => {
    if (!isInstantPublisher) return toast.error('Only admin or coadmin can push immediately');
    const { error } = await supabase.from(target_table as any).update({ published_at: new Date().toISOString() }).eq('id', id);
    if (error) return toast.error(error.message);
    await logReview(target_table, id, 'edited', 'Push to live (admin override)');
    toast.success('Pushed to live');
    refresh();
  };

  const fetchNews = async (projectId: string) => {
    setBusyRow(projectId + ':news');
    const { data, error } = await supabase.functions.invoke('ai-fetch-project-news', {
      body: { projectId, maxResults: 3 },
    });
    setBusyRow(null);
    if (error) return toast.error(await extractFnError(error));
    const errs: string[] = data?.errors ?? [];
    toast.success(`Inserted ${data?.inserted ?? 0} news update${(data?.inserted ?? 0) === 1 ? '' : 's'}${errs.length ? ` (${errs.length} errors)` : ''}`);
    if (errs.length) console.warn('ai-fetch-project-news errors:', errs);
    refresh();
  };

  const setUserRole = async (targetUserId: string, role: 'admin' | 'coadmin' | 'reviewer', enabled: boolean) => {
    if (targetUserId === user.id && role === 'admin' && !enabled) {
      return toast.error("You can't revoke your own admin role from this UI.");
    }
    if (enabled) {
      const { error } = await supabase.from('user_roles').insert({ user_id: targetUserId, role });
      if (error && !error.message.includes('duplicate')) return toast.error(error.message);
    } else {
      const { error } = await supabase.from('user_roles').delete().eq('user_id', targetUserId).eq('role', role);
      if (error) return toast.error(error.message);
    }
    toast.success(`${enabled ? 'Granted' : 'Revoked'} ${role}`);
    refresh();
  };

  const generateBrief = async (projectId: string) => {
    setBusyRow(projectId + ':brief');
    const { data, error } = await supabase.functions.invoke('ai-generate-brief', {
      body: { projectId },
    });
    setBusyRow(null);
    if (error) return toast.error(await extractFnError(error));
    if (data?.updateId) toast.success('AI brief queued for review');
    else toast.error('Brief generation returned no update');
    refresh();
  };

  const runGlobalBrief = async () => {
    const body: any = {};
    if (globalScope === 'province') {
      if (!globalProvince) return toast.error('Pick a province');
      body.province = globalProvince;
    } else if (globalScope === 'sector') {
      if (!globalSector) return toast.error('Pick a sector');
      body.sector = globalSector;
    }
    setBusyGlobal('brief');
    const { data, error } = await supabase.functions.invoke('ai-generate-global-brief', { body });
    setBusyGlobal(null);
    if (error) return toast.error(await extractFnError(error));
    toast.success(`Global brief published (${data?.scope ?? 'global'})`);
  };

  const runBulkComprehensive = async () => {
    // Pick approved projects that have never been analysed, or whose last
    // analysis is older than 30 days. Cap at 10 to keep one run reasonable.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: stale, error } = await supabase
      .from('projects')
      .select('id, title, last_comprehensive_analysis_at')
      .eq('approval_status', 'approved')
      .or(`last_comprehensive_analysis_at.is.null,last_comprehensive_analysis_at.lt.${cutoff}`)
      .order('last_comprehensive_analysis_at', { ascending: true, nullsFirst: true })
      .limit(10);
    if (error) return toast.error(error.message);
    if (!stale || stale.length === 0) return toast.success('No stale projects — all approved projects are up-to-date.');

    setBulkProgress({ done: 0, total: stale.length });
    let okCount = 0;
    const errs: string[] = [];
    for (let i = 0; i < stale.length; i++) {
      const p = stale[i];
      setBulkProgress({ done: i, total: stale.length, current: p.title });
      try {
        const { error: fnErr } = await supabase.functions.invoke('ai-comprehensive-analysis', {
          body: { projectId: Number(p.id) },
        });
        if (fnErr) errs.push(`${p.title}: ${await extractFnError(fnErr)}`);
        else okCount += 1;
      } catch (e: any) {
        errs.push(`${p.title}: ${e.message ?? 'unknown'}`);
      }
      // Pace between projects to stay under Mistral RPM. ~6s gives ~10 req/min budget.
      if (i < stale.length - 1) await new Promise(r => setTimeout(r, 6000));
    }
    setBulkProgress(null);
    toast.success(`Comprehensive analysis: ${okCount}/${stale.length} succeeded${errs.length ? `, ${errs.length} errors` : ''}`);
    if (errs.length) console.warn('Bulk comprehensive errors:', errs);
    refresh();
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <section className="border-b bg-primary text-primary-foreground">
        <div className="container py-8">
          <p className="text-xs uppercase tracking-[0.2em] font-mono text-accent mb-2">Internal</p>
          <h1 className="font-display text-4xl font-bold flex items-center gap-3">
            <Shield className="h-8 w-8 text-accent" /> {isAdmin ? 'Admin' : isCoadmin ? 'Co-admin' : 'Reviewer'} console
          </h1>
        </div>
      </section>

      <div className="container py-8 space-y-6">
        <div className="grid sm:grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="p-5"><div className="text-xs uppercase font-mono text-muted-foreground">Pending</div><div className="font-display text-3xl font-bold mt-2">{stats.pending}</div></Card>
          <Card className="p-5"><div className="text-xs uppercase font-mono text-muted-foreground">Approved</div><div className="font-display text-3xl font-bold mt-2 text-success">{stats.approved}</div></Card>
          <Card className="p-5"><div className="text-xs uppercase font-mono text-muted-foreground">Total</div><div className="font-display text-3xl font-bold mt-2">{stats.total}</div></Card>
          <Card className="p-5 border-accent/30">
            <div className="text-xs uppercase font-mono text-muted-foreground flex items-center gap-1"><Sparkles className="h-3 w-3 text-accent" /> AI discovered</div>
            <div className="font-display text-3xl font-bold mt-2">{stats.aiInserted}</div>
          </Card>
          <Card className="p-5 border-accent/30">
            <div className="text-xs uppercase font-mono text-muted-foreground flex items-center gap-1"><Sparkles className="h-3 w-3 text-accent" /> AI approval rate</div>
            <div className="font-display text-3xl font-bold mt-2">
              {stats.aiInserted > 0 ? `${Math.round((stats.aiApproved / stats.aiInserted) * 100)}%` : '—'}
            </div>
          </Card>
        </div>

        <Card className="p-5 border-accent/30 bg-accent/5 space-y-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" />
            <h3 className="font-semibold">AI tools</h3>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Global brief.</span>{' '}
              Aggregates approved projects into a single brief shown on the homepage hero. Optionally narrow by province or sector.
            </p>
            <div className="flex gap-2 flex-wrap items-center">
              <Select value={globalScope} onValueChange={v => setGlobalScope(v as any)}>
                <SelectTrigger className="max-w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  <SelectItem value="province">By province</SelectItem>
                  <SelectItem value="sector">By sector</SelectItem>
                </SelectContent>
              </Select>
              {globalScope === 'province' && (
                <Select value={globalProvince} onValueChange={setGlobalProvince}>
                  <SelectTrigger className="max-w-[180px]"><SelectValue placeholder="Province" /></SelectTrigger>
                  <SelectContent>{PROVINCES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {globalScope === 'sector' && (
                <Select value={globalSector} onValueChange={setGlobalSector}>
                  <SelectTrigger className="max-w-[200px]"><SelectValue placeholder="Sector" /></SelectTrigger>
                  <SelectContent>{SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <Button disabled={busyGlobal === 'brief'} onClick={runGlobalBrief} variant="outline">
                {busyGlobal === 'brief' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Generate global brief'}
              </Button>
            </div>
          </div>

          <AutoApproveSettingsCard />

          <SherlockManager />

          <div className="space-y-2 pt-3 border-t border-accent/20">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Refresh stale projects.</span>{' '}
              Enqueues a comprehensive analysis for up to 10 approved projects whose last analysis is missing or older than 30 days. Jobs flow through the analysis queue — each one populates funding/documents/stakeholders/risks/impact/procurement/compliance plus the milestones/updates/sources/images. New rows land as pending review.
            </p>
            <div className="flex gap-2 flex-wrap items-center">
              <Button disabled={!!bulkProgress} onClick={runBulkComprehensive} variant="outline">
                {bulkProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {bulkProgress
                  ? `Enqueueing ${bulkProgress.done + 1} / ${bulkProgress.total}${bulkProgress.current ? ` — ${bulkProgress.current.slice(0, 40)}…` : ''}`
                  : 'Refresh stale approved projects'}
              </Button>
            </div>
          </div>
        </Card>

        <Tabs defaultValue="queue">
          <TabsList>
            <TabsTrigger value="queue">Review queue ({projects.filter(p => p.approval_status === 'pending' || p.approval_status === 'changes_requested').length})</TabsTrigger>
            <TabsTrigger value="all">All projects</TabsTrigger>
            <TabsTrigger value="moderation">Moderation status</TabsTrigger>
            <TabsTrigger value="updates">Pending updates ({pendingUpdates.length})</TabsTrigger>
            <TabsTrigger value="sources">Pending sources ({pendingSources.length})</TabsTrigger>
            {isAdmin && <TabsTrigger value="users"><UsersIcon className="h-4 w-4 mr-1" /> Users ({users.length})</TabsTrigger>}
            {(isAdmin || isCoadmin) && <TabsTrigger value="ads"><Megaphone className="h-4 w-4 mr-1" /> Ad slots</TabsTrigger>}
          </TabsList>

          <TabsContent value="queue" className="mt-4">
            <ProjectList
              projects={projects.filter(p => p.approval_status === 'pending' || p.approval_status === 'changes_requested')}
              onReview={review}
              onFetchNews={fetchNews}
              onGenerateBrief={generateBrief}
              onPushNow={pushNow}
              canPushNow={isInstantPublisher}
              busyRow={busyRow}
              refresh={refresh}
            />
          </TabsContent>
          <TabsContent value="all" className="mt-4">
            <ProjectList
              projects={projects}
              onReview={review}
              onFetchNews={fetchNews}
              onGenerateBrief={generateBrief}
              onPushNow={pushNow}
              canPushNow={isInstantPublisher}
              busyRow={busyRow}
              refresh={refresh}
            />
          </TabsContent>
          <TabsContent value="moderation" className="mt-4">
            <ProjectModerationTab />
          </TabsContent>
          <TabsContent value="updates" className="mt-4">
            <PendingUpdatesList items={pendingUpdates} onReview={reviewUpdate} refresh={refresh} />
          </TabsContent>
          <TabsContent value="sources" className="mt-4">
            <PendingSourcesList items={pendingSources} onReview={reviewSource} refresh={refresh} />
          </TabsContent>
          {isAdmin && (
            <TabsContent value="users" className="mt-4 space-y-4">
              <AdminRemovalPanel admins={users.filter((u: any) => (u.roles ?? []).includes('admin')).map((u: any) => ({ id: u.id, full_name: u.full_name, email: u.email }))} />
              <UsersManager users={users} currentUserId={user.id} onSetRole={setUserRole} />
            </TabsContent>
          )}
          {(isAdmin || isCoadmin) && (
            <TabsContent value="ads" className="mt-4">
              <AdsManager ads={ads} onChange={refresh} />
            </TabsContent>
          )}
        </Tabs>
      </div>
      <SiteFooter />
    </div>
  );
}

function ProjectList({ projects, onReview, onFetchNews, onGenerateBrief, onPushNow, busyRow, canPushNow, refresh }: any) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Every project is selectable now, regardless of approval_status. The
  // "All projects" tab needs bulk-actions on approved rows too (e.g. mass
  // reject a batch that turned out to be junk after publication). The bulk
  // confirm dialog is explicit about the count so destructive moves stay
  // intentional.
  const allIds = projects.map((p: any) => String(p.id));
  const some = allIds.some((id: string) => sel.has(id));
  const all = allIds.length > 0 && allIds.every((id: string) => sel.has(id));
  const toggle = (id: string) => setSel(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = (v: boolean) => setSel(v ? new Set(allIds) : new Set());
  if (projects.length === 0) return <Card className="p-12 text-center text-muted-foreground">Queue empty.</Card>;
  return (
    <Card>
      <AdminBulkBar
        table="projects"
        selectedIds={[...sel]}
        rowCount={projects.length}
        allSelected={all}
        someSelected={some}
        onToggleAll={toggleAll}
        afterAction={() => { setSel(new Set()); refresh && refresh(); }}
      />
      <div className="divide-y">
        {projects.map((p: any) => {
          const isApproved = p.approval_status === 'approved';
          const scheduled = p.published_at && new Date(p.published_at) > new Date();
          const selectable = true;
          return (
            <div key={p.id} className="p-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                {selectable ? (
                  <Checkbox checked={sel.has(String(p.id))} onCheckedChange={() => toggle(String(p.id))} className="mt-1" aria-label="Select project" />
                ) : <div className="w-4" /* spacer */ />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <StatusDot status={p.approval_status} />
                    <Badge className={cn("text-[10px] uppercase tracking-wider font-mono", APPROVAL_COLORS[p.approval_status])}>{p.approval_status.replace('_', ' ')}</Badge>
                    {scheduled && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-mono border-info text-info">
                        Publishes {new Date(p.published_at).toLocaleString()}
                      </Badge>
                    )}
                    {p.submitted_by_ai && <AiBadge tag={p.ai_tag} />}
                    {p.submitted_by_ai && <ConfidenceBadge score={p.confidence_score} />}
                    <span className="text-xs text-muted-foreground">{p.sector} · {p.province ?? '—'} · {new Date(p.created_at).toLocaleDateString()}</span>
                    <ReviewHistoryIcon targetTable="projects" targetId={p.id} />
                  </div>
                  <Link to={`/projects/${p.slug}`} className="font-semibold hover:text-accent">{p.title}</Link>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{p.description}</p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/projects/${p.slug}`} target="_blank" rel="noreferrer">View</Link>
                </Button>
                <VerifyDialog projectId={p.id} projectTitle={p.title} />
                {scheduled && canPushNow && (
                  <Button size="sm" variant="default" onClick={() => onPushNow('projects', p.id)}>Push now</Button>
                )}
                {isApproved && (
                  <>
                    <Button size="sm" variant="outline" disabled={busyRow === p.id + ':news'} onClick={() => onFetchNews(p.id)}>
                      {busyRow === p.id + ':news' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Fetch news'}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busyRow === p.id + ':brief'} onClick={() => onGenerateBrief(p.id)}>
                      {busyRow === p.id + ':brief' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Generate brief'}
                    </Button>
                  </>
                )}
                <Dialog>
                  <DialogTrigger asChild><Button size="sm">Review</Button></DialogTrigger>
                  <ReviewDialog project={p} onReview={onReview} />
                </Dialog>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ReviewDialog({ project, onReview }: any) {
  const [title, setTitle] = useState(project.title ?? '');
  const [description, setDescription] = useState(project.description ?? '');
  const [sector, setSector] = useState(project.sector ?? SECTORS[0]);
  const [province, setProvince] = useState<string>(project.province ?? '');
  const [district, setDistrict] = useState<string>(project.district ?? '');
  const districtOptions = districtsFor(province || null);
  const [contractor, setContractor] = useState(project.contractor ?? '');
  const [agency, setAgency] = useState(project.implementing_agency ?? '');
  const [budget, setBudget] = useState<string>(
    project.budget_npr === null || project.budget_npr === undefined ? '' : String(project.budget_npr),
  );
  const [notes, setNotes] = useState(project.review_notes ?? '');
  const [status, setStatus] = useState(project.status);
  const [isRastraGaurav, setIsRastraGaurav] = useState<boolean>(!!project.is_rastra_gaurav);

  const collectEdits = (): Record<string, any> => {
    const edits: Record<string, any> = {
      title: title.trim(),
      description: description.trim() || null,
      sector,
      province: province || null,
      district: district.trim() || null,
      contractor: contractor.trim() || null,
      implementing_agency: agency.trim() || null,
      is_rastra_gaurav: isRastraGaurav,
    };
    if (budget === '') edits.budget_npr = null;
    else edits.budget_npr = Number(budget);
    return edits;
  };

  const validate = (): boolean => {
    if (!title.trim()) { toast.error('Title cannot be empty'); return false; }
    if (budget !== '' && (Number.isNaN(Number(budget)) || Number(budget) < 0)) {
      toast.error('Budget must be a positive number or leave it blank');
      return false;
    }
    return true;
  };

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Review: {project.title}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">Edit any field below. Changes save with your approval/rejection.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="sm:col-span-2">
            <Label>Description</Label>
            <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={5000} />
          </div>
          <div>
            <Label>Sector</Label>
            <Select value={sector} onValueChange={setSector}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Province</Label>
            <Select value={province || '__none'} onValueChange={v => { setProvince(v === '__none' ? '' : v); setDistrict(''); }}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— none —</SelectItem>
                {PROVINCES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>District</Label>
            <Select value={district || '__none'} onValueChange={v => setDistrict(v === '__none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— none —</SelectItem>
                {districtOptions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Budget (NPR)</Label>
            <Input type="number" value={budget} onChange={e => setBudget(e.target.value)} />
          </div>
          <div>
            <Label>Contractor</Label>
            <Input value={contractor} onChange={e => setContractor(e.target.value)} maxLength={200} />
          </div>
          <div>
            <Label>Implementing agency</Label>
            <Input value={agency} onChange={e => setAgency(e.target.value)} maxLength={200} />
          </div>
          <div>
            <Label>Project status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['proposed','approved','in_progress','delayed','completed','cancelled'].map(s =>
                  <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-between border rounded-md px-3 py-2">
          <div>
            <Label className="cursor-pointer">Rastra Gaurav (national-pride) project</Label>
            <p className="text-xs text-muted-foreground">Pin a flag-bearer project for the Browse filter chip and homepage rotation.</p>
          </div>
          <Switch checked={isRastraGaurav} onCheckedChange={setIsRastraGaurav} />
        </div>
        <div>
          <Label>Reviewer notes</Label>
          <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} />
        </div>
        <div className="flex gap-2 pt-2 flex-wrap">
          <Button className="bg-success hover:bg-success/90" onClick={() => { if (validate()) onReview(project.id, 'approved', notes, status, collectEdits()); }}>Approve</Button>
          <Button variant="outline" onClick={() => { if (validate()) onReview(project.id, 'changes_requested', notes, status, collectEdits()); }}>Request changes</Button>
          <Button variant="destructive" onClick={() => { if (validate()) onReview(project.id, 'rejected', notes, status, collectEdits()); }}>Reject</Button>
        </div>
      </div>
    </DialogContent>
  );
}

function PendingUpdatesList({ items, onReview, refresh }: any) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const ids = items.map((u: any) => String(u.id));
  const some = ids.some((id: string) => sel.has(id));
  const all = ids.length > 0 && ids.every((id: string) => sel.has(id));
  const toggle = (id: string) => setSel(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = (v: boolean) => setSel(v ? new Set(ids) : new Set());
  if (items.length === 0) return <Card className="p-12 text-center text-muted-foreground">No pending updates.</Card>;
  return (
    <Card>
      <AdminBulkBar
        table="project_updates"
        selectedIds={[...sel]}
        rowCount={items.length}
        allSelected={all}
        someSelected={some}
        onToggleAll={toggleAll}
        afterAction={() => { setSel(new Set()); refresh && refresh(); }}
      />
      <div className="divide-y">
        {items.map((u: any) => (
          <div key={u.id} className="p-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <Checkbox checked={sel.has(String(u.id))} onCheckedChange={() => toggle(String(u.id))} className="mt-1" aria-label="Select update" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <Badge className={cn("text-[10px] uppercase tracking-wider font-mono", APPROVAL_COLORS[u.approval_status])}>{u.approval_status.replace('_', ' ')}</Badge>
                  {u.submitted_by_ai && <AiBadge />}
                  <span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">{u.update_type}</span>
                  <span className="text-xs text-muted-foreground">· {new Date(u.created_at).toLocaleDateString()}</span>
                </div>
                {u.projects?.slug
                  ? <Link to={`/projects/${u.projects.slug}`} className="text-xs text-accent hover:underline">{u.projects?.title ?? '—'}</Link>
                  : <span className="text-xs text-muted-foreground">{u.projects?.title ?? '—'}</span>}
                <h4 className="font-semibold mt-1">{u.title}</h4>
                <p className="text-xs text-muted-foreground line-clamp-3 mt-1 whitespace-pre-wrap">{u.content}</p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Dialog>
                <DialogTrigger asChild><Button size="sm" variant="outline">Review</Button></DialogTrigger>
                <ReviewUpdateDialog item={u} onReview={onReview} />
              </Dialog>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PendingSourcesList({ items, onReview, refresh }: any) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const ids = items.map((s: any) => String(s.id));
  const some = ids.some((id: string) => sel.has(id));
  const all = ids.length > 0 && ids.every((id: string) => sel.has(id));
  const toggle = (id: string) => setSel(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = (v: boolean) => setSel(v ? new Set(ids) : new Set());
  if (items.length === 0) return <Card className="p-12 text-center text-muted-foreground">No pending sources.</Card>;
  return (
    <Card>
      <AdminBulkBar
        table="project_sources"
        selectedIds={[...sel]}
        rowCount={items.length}
        allSelected={all}
        someSelected={some}
        onToggleAll={toggleAll}
        afterAction={() => { setSel(new Set()); refresh && refresh(); }}
      />
      <div className="divide-y">
        {items.map((s: any) => (
          <div key={s.id} className="p-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <Checkbox checked={sel.has(String(s.id))} onCheckedChange={() => toggle(String(s.id))} className="mt-1" aria-label="Select source" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <Badge className={cn("text-[10px] uppercase tracking-wider font-mono", APPROVAL_COLORS[s.approval_status])}>{s.approval_status.replace('_', ' ')}</Badge>
                  {s.submitted_by_ai && <AiBadge />}
                  <span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">{s.source_type}</span>
                  <span className="text-xs text-muted-foreground">· {new Date(s.created_at).toLocaleDateString()}</span>
                </div>
                {s.projects?.slug
                  ? <Link to={`/projects/${s.projects.slug}`} className="text-xs text-accent hover:underline">{s.projects?.title ?? '—'}</Link>
                  : <span className="text-xs text-muted-foreground">{s.projects?.title ?? '—'}</span>}
                <div className="font-semibold mt-1 truncate">{s.title}</div>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline inline-flex items-center gap-1 mt-1 truncate max-w-full">
                  {s.url} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Dialog>
                <DialogTrigger asChild><Button size="sm" variant="outline">Review</Button></DialogTrigger>
                <ReviewSourceDialog item={s} onReview={onReview} />
              </Dialog>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Shared admin bulk-action bar. Selection lives in the parent list. Actions
// hit the DB directly here (we already have service-role-equivalent access
// for moderators via RLS). Triggers afterAction so the parent can refresh
// + clear selection.
function AdminBulkBar({
  table, selectedIds, rowCount, allSelected, someSelected, onToggleAll, afterAction,
}: {
  table: 'project_updates' | 'project_sources' | 'projects';
  selectedIds: string[];
  rowCount: number;
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: (v: boolean) => void;
  afterAction: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const labelMap: Record<typeof table, string> = { project_updates: 'update', project_sources: 'source', projects: 'project' };
  const label = labelMap[table];
  const act = async (action: 'approved' | 'rejected' | 'delete') => {
    if (!selectedIds.length) return;
    const verb = action === 'delete' ? 'Delete' : action === 'approved' ? 'Approve' : 'Reject';
    if (!confirm(`${verb} ${selectedIds.length} ${label}${selectedIds.length === 1 ? '' : 's'}?`)) return;
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const userId = u.user?.id ?? null;
    // Convert numeric-shaped strings back to numbers (Supabase quirk on bigint).
    const ids: any[] = selectedIds.map(s => { const n = Number(s); return Number.isFinite(n) && String(n) === s ? n : s; });
    let err: string | null = null;
    if (action === 'delete') {
      const { error } = await supabase.from(table as any).delete().in('id', ids);
      if (error) err = error.message;
      else await supabase.from('project_reviews').insert(ids.map(id => ({
        target_table: table, target_id: String(id),
        reviewer_id: userId, reviewer_role: 'admin', action: 'rejected', notes: 'Bulk-deleted', was_admin: true,
      })));
    } else {
      const patch: any = { approval_status: action, reviewed_by: userId };
      if (table === 'projects' && action === 'approved') patch.status = 'approved';
      const { error } = await supabase.from(table as any).update(patch).in('id', ids);
      if (error) err = error.message;
      else await supabase.from('project_reviews').insert(ids.map(id => ({
        target_table: table, target_id: String(id),
        reviewer_id: userId, reviewer_role: 'admin', action, notes: `Bulk ${action}`, was_admin: true,
      })));
    }
    setBusy(false);
    if (err) toast.error(`${table}: ${err}`);
    else toast.success(`${selectedIds.length} ${label}${selectedIds.length === 1 ? '' : 's'} ${action === 'delete' ? 'deleted' : action}`);
    afterAction();
  };
  // Bar hidden until something is selected — the per-row checkboxes are the
  // entry point. Keeps the moderation page visually clean when there's
  // nothing pending action.
  if (!someSelected) return null;
  return (
    <div className="flex items-center justify-between gap-2 p-2.5 border-b border-info/40 bg-info/5 flex-wrap">
      <label className="flex items-center gap-2 cursor-pointer text-xs">
        <Checkbox checked={allSelected} onCheckedChange={(v) => onToggleAll(!!v)} aria-label="Select all" />
        <span>{selectedIds.length} of {rowCount} selected</span>
      </label>
      <div className="flex items-center gap-1">
        <Button disabled={busy} size="sm" variant="ghost" className="h-7 text-xs text-success hover:bg-success/10" onClick={() => act('approved')}>
          {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
          Approve
        </Button>
        <Button disabled={busy} size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-destructive/10" onClick={() => act('rejected')}>
          Reject
        </Button>
        {table !== 'projects' && (
          <Button disabled={busy} size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-destructive/10" onClick={() => act('delete')}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewUpdateDialog({ item, onReview }: any) {
  const [editTitle, setEditTitle] = useState(item.title ?? '');
  const [editContent, setEditContent] = useState(item.content ?? '');
  const [notes, setNotes] = useState(item.review_notes ?? '');
  const edits = () => ({
    title: editTitle.trim() || item.title,
    content: editContent.trim() || item.content,
  });
  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Review update: {item.title}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">Edit any field below. Changes save with your approval/rejection.</p>
        <div>
          <Label>Title</Label>
          <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} maxLength={200} />
        </div>
        <div>
          <Label>Content</Label>
          <Textarea rows={8} value={editContent} onChange={e => setEditContent(e.target.value)} maxLength={5000} />
        </div>
        <div>
          <Label>Reviewer notes</Label>
          <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} />
        </div>
        <div className="flex gap-2 pt-2 flex-wrap">
          <Button className="bg-success hover:bg-success/90" onClick={() => onReview(item.id, 'approved', notes, edits())}>Approve</Button>
          <Button variant="outline" onClick={() => onReview(item.id, 'changes_requested', notes, edits())}>Request changes</Button>
          <Button variant="destructive" onClick={() => onReview(item.id, 'rejected', notes, edits())}>Reject</Button>
        </div>
      </div>
    </DialogContent>
  );
}

function ReviewSourceDialog({ item, onReview }: any) {
  const [editTitle, setEditTitle] = useState(item.title ?? '');
  const [editUrl, setEditUrl] = useState(item.url ?? '');
  const [notes, setNotes] = useState(item.review_notes ?? '');
  const edits = () => ({
    title: editTitle.trim() || item.title,
    url: editUrl.trim() || item.url,
  });
  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>Review source: {item.title}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">Edit any field below. Changes save with your approval/rejection.</p>
        <div>
          <Label>Title</Label>
          <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} maxLength={200} />
        </div>
        <div>
          <Label>URL</Label>
          <Input value={editUrl} onChange={e => setEditUrl(e.target.value)} />
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline inline-flex items-center gap-1 mt-1">
              Open original <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div>
          <Label>Reviewer notes</Label>
          <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} />
        </div>
        <div className="flex gap-2 pt-2 flex-wrap">
          <Button className="bg-success hover:bg-success/90" onClick={() => onReview(item.id, 'approved', notes, edits())}>Approve</Button>
          <Button variant="outline" onClick={() => onReview(item.id, 'changes_requested', notes, edits())}>Request changes</Button>
          <Button variant="destructive" onClick={() => onReview(item.id, 'rejected', notes, edits())}>Reject</Button>
        </div>
      </div>
    </DialogContent>
  );
}

function UsersManager({ users, currentUserId, onSetRole }: any) {
  if (users.length === 0) return <Card className="p-12 text-center text-muted-foreground">No users yet.</Card>;
  return (
    <Card>
      <div className="p-5 border-b">
        <h3 className="font-display text-lg font-semibold">Users &amp; roles</h3>
        <p className="text-xs text-muted-foreground mt-1">
          <span className="font-mono">admin</span> grants full access including user management.
          <span className="font-mono"> coadmin</span> grants reviewer powers + ad management.
          <span className="font-mono"> reviewer</span> grants moderation queue access only.
        </p>
      </div>
      <div className="divide-y">
        {users.map((u: any) => {
          const roles: string[] = u.roles ?? [];
          const isSelf = u.id === currentUserId;
          return (
            <div key={u.id} className="p-4 flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-semibold truncate">{u.full_name || '(no name)'}</span>
                  {isSelf && <Badge variant="outline" className="text-[10px]">you</Badge>}
                  {roles.length === 0 && <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-mono">contributor</Badge>}
                  {roles.map(r => (
                    <Badge key={r} className={cn(
                      'text-[10px] uppercase tracking-wider font-mono',
                      r === 'admin' && 'bg-destructive/15 text-destructive',
                      r === 'coadmin' && 'bg-warning/15 text-warning',
                      r === 'reviewer' && 'bg-info/15 text-info',
                    )}>{r}</Badge>
                  ))}
                </div>
                {u.email && <div className="text-xs text-foreground font-mono truncate">{u.email}</div>}
                <div className="text-xs text-muted-foreground font-mono truncate">
                  {u.organization ? `${u.organization} · ` : ''}joined {new Date(u.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="flex flex-wrap gap-3 items-center shrink-0">
                <RoleToggle label="Admin" enabled={roles.includes('admin')} disabled={isSelf && roles.includes('admin')}
                  onChange={v => onSetRole(u.id, 'admin', v)} />
                <RoleToggle label="Co-admin" enabled={roles.includes('coadmin')}
                  onChange={v => onSetRole(u.id, 'coadmin', v)} />
                <RoleToggle label="Reviewer" enabled={roles.includes('reviewer')}
                  onChange={v => onSetRole(u.id, 'reviewer', v)} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RoleToggle({ label, enabled, disabled, onChange }: { label: string; enabled: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn("flex items-center gap-2 text-xs cursor-pointer", disabled && "opacity-60 cursor-not-allowed")}>
      <Switch checked={enabled} disabled={disabled} onCheckedChange={onChange} />
      <span className="font-mono uppercase tracking-wider">{label}</span>
    </label>
  );
}

function AdsManager({ ads, onChange }: any) {
  const [form, setForm] = useState<any>({ active: true });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.slot_key || !form.title) return toast.error('Slot key and title required');
    const { error } = await supabase.from('ad_slots').insert({
      slot_key: form.slot_key, title: form.title,
      image_url: form.image_url || null, target_url: form.target_url || null,
      advertiser: form.advertiser || null, active: form.active,
    });
    if (error) toast.error(error.message); else { toast.success('Ad added'); setForm({ active: true }); onChange(); }
  };

  const toggle = async (id: string, active: boolean) => {
    await supabase.from('ad_slots').update({ active }).eq('id', id); onChange();
  };
  const remove = async (id: string) => { await supabase.from('ad_slots').delete().eq('id', id); onChange(); };

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-6">
      <Card>
        <div className="p-5 border-b"><h3 className="font-display text-lg font-semibold">Ad slots</h3></div>
        {ads.length === 0 ? <div className="p-8 text-center text-muted-foreground text-sm">No ads yet.</div> :
          <div className="divide-y">
            {ads.map((a: any) => (
              <div key={a.id} className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{a.title}</div>
                  <div className="text-xs text-muted-foreground font-mono">{a.slot_key} · {a.advertiser ?? '—'}</div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={a.active} onCheckedChange={v => toggle(a.id, v)} />
                  <Button size="sm" variant="outline" onClick={() => remove(a.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        }
      </Card>
      <Card className="p-5 space-y-3 h-fit">
        <h3 className="font-semibold">Add ad slot</h3>
        <Input placeholder="Slot key (e.g. home_mid)" value={form.slot_key ?? ''} onChange={e => set('slot_key', e.target.value)} />
        <Input placeholder="Title" value={form.title ?? ''} onChange={e => set('title', e.target.value)} />
        <Input placeholder="Advertiser" value={form.advertiser ?? ''} onChange={e => set('advertiser', e.target.value)} />
        <Input placeholder="Image URL (optional)" value={form.image_url ?? ''} onChange={e => set('image_url', e.target.value)} />
        <Input placeholder="Target URL" value={form.target_url ?? ''} onChange={e => set('target_url', e.target.value)} />
        <div className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={v => set('active', v)} /><Label>Active</Label></div>
        <Button onClick={save} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">Add slot</Button>
        <p className="text-xs text-muted-foreground">Slot keys used: home_hero, home_mid, home_cta, browse_sidebar, project_sidebar, analytics_bottom</p>
      </Card>
    </div>
  );
}

// Site-wide auto-approval controller. Lives on the admin page so a moderator
// can dial the trust level for AI-submitted projects without touching SQL.
// Writes to public.site_settings (singleton row id=1). When enabled, the
// BEFORE INSERT trigger on projects auto-approves any AI submission with
// confidence_score >= threshold, which cascades through the analysis +
// child-row triggers (so a "trusted" Sherlock hit ends up with a fully
// populated detail page within minutes).
function AutoApproveSettingsCard() {
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState(0.85);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('site_settings').select('*').eq('id', 1).maybeSingle();
      if (data) {
        setEnabled(!!(data as any).auto_approve_enabled);
        setThreshold(Number((data as any).auto_approve_threshold ?? 0.85));
        setUpdatedAt((data as any).updated_at ?? null);
      }
      setLoaded(true);
    })();
  }, []);

  const save = async (nextEnabled: boolean, nextThreshold: number) => {
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('site_settings').update({
      auto_approve_enabled: nextEnabled,
      auto_approve_threshold: Number(nextThreshold.toFixed(2)),
      updated_at: new Date().toISOString(),
      updated_by: u.user?.id ?? null,
    }).eq('id', 1);
    setBusy(false);
    if (error) return toast.error(error.message);
    setEnabled(nextEnabled);
    setThreshold(nextThreshold);
    setUpdatedAt(new Date().toISOString());
    toast.success(nextEnabled ? `Auto-approve ON — AI rows ≥ ${Math.round(nextThreshold * 100)}% will publish automatically.` : 'Auto-approve OFF — all AI rows stay pending.');
  };

  if (!loaded) return null;
  return (
    <Card className={cn("p-4 border-2", enabled ? "border-success/40 bg-success/5" : "border-muted")}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Switch checked={enabled} onCheckedChange={(v) => save(v, threshold)} disabled={busy} />
          <div className="min-w-0">
            <div className="text-sm font-semibold">
              Auto-approve high-confidence AI submissions
              <span className={cn("ml-2 text-xs font-mono", enabled ? "text-success" : "text-muted-foreground")}>
                {enabled ? '· ON' : '· off'}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              When ON, any Sherlock-discovered project with AI confidence ≥ <strong>{Math.round(threshold * 100)}%</strong> publishes immediately. Lower-confidence rows + manual submissions stay in the moderation queue.
            </div>
            {updatedAt && (
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">last changed {new Date(updatedAt).toLocaleString()}</div>
            )}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">Threshold</Label>
            <Select value={String(Math.round(threshold * 100))} onValueChange={(v) => save(enabled, Number(v) / 100)}>
              <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[70, 75, 80, 85, 90, 95, 100].map(n => <SelectItem key={n} value={String(n)}>{n}%</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </Card>
  );
}
