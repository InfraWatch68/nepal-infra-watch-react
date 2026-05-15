import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Plus, FileText, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserBadge } from '@/components/UserBadge';
import { ReviewHistoryIcon } from '@/components/ReviewHistoryIcon';

const APPROVAL_COLORS: Record<string, string> = {
  pending: 'bg-warning/15 text-warning',
  approved: 'bg-success/15 text-success',
  rejected: 'bg-destructive/15 text-destructive',
  changes_requested: 'bg-info/15 text-info',
};

export default function Dashboard() {
  const { user, loading } = useAuth();
  const [mine, setMine] = useState<any[]>([]);
  const [profile, setProfile] = useState<{ full_name: string | null; avatar_url: string | null; organization: string | null } | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from('projects').select('*').eq('submitted_by', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setMine(data ?? []));
    supabase.from('profiles').select('full_name, avatar_url, organization').eq('id', user.id).maybeSingle()
      .then(({ data }) => setProfile(data as any));
  }, [user]);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/auth" replace />;

  const stats = {
    total: mine.length,
    pending: mine.filter(p => p.approval_status === 'pending').length,
    approved: mine.filter(p => p.approval_status === 'approved').length,
    changes: mine.filter(p => p.approval_status === 'changes_requested').length,
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <section className="border-b bg-secondary/30">
        <div className="container py-6 sm:py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6">
          <div className="flex items-center gap-3 sm:gap-5 min-w-0">
            <Avatar className="h-16 w-16 sm:h-20 sm:w-20 ring-4 ring-background shadow-md shrink-0">
              {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={profile?.full_name ?? 'User'} />}
              <AvatarFallback className="bg-accent/15 text-accent text-xl sm:text-2xl font-bold">
                {(profile?.full_name || user.email || '?').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?'}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] font-mono text-accent mb-1">Your workspace</p>
              <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-bold truncate flex items-center gap-2">
                {profile?.full_name || user.email?.split('@')[0] || 'Welcome'}
                <UserBadge userId={user.id} />
              </h1>
              {profile?.organization && (
                <p className="text-sm text-muted-foreground mt-0.5 truncate">{profile.organization}</p>
              )}
            </div>
          </div>
          <Button className="bg-accent hover:bg-accent/90 text-accent-foreground shrink-0 w-full sm:w-auto" asChild>
            <Link to="/dashboard/submit"><Plus className="h-4 w-4" /> New project</Link>
          </Button>
        </div>
      </section>

      <div className="container py-6 sm:py-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <StatCard icon={FileText} label="Total submitted" value={stats.total} />
          <StatCard icon={Clock} label="Pending review" value={stats.pending} />
          <StatCard icon={CheckCircle2} label="Approved" value={stats.approved} color="text-success" />
          <StatCard icon={AlertCircle} label="Changes requested" value={stats.changes} color="text-info" />
        </div>

        <Card>
          <div className="p-5 border-b">
            <h2 className="font-display text-xl font-semibold">My submissions</h2>
          </div>
          {mine.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <p className="mb-4">You haven't submitted any projects yet.</p>
              <Button asChild><Link to="/dashboard/submit">Submit your first project</Link></Button>
            </div>
          ) : (
            <div className="divide-y">
              {mine.map(p => (
                <div key={p.id} className="p-5 flex items-center justify-between gap-4 hover:bg-muted/30">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge className={cn("text-[10px] uppercase tracking-wider font-mono", APPROVAL_COLORS[p.approval_status])}>{p.approval_status.replace('_', ' ')}</Badge>
                      <span className="text-xs text-muted-foreground">{p.sector} · {new Date(p.created_at).toLocaleDateString()}</span>
                      <ReviewHistoryIcon targetTable="projects" targetId={p.id} />
                    </div>
                    <div className="font-semibold truncate">{p.title}</div>
                    {p.review_notes && <p className="text-xs text-muted-foreground mt-1">Reviewer note: {p.review_notes}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {(p.approval_status === 'pending' || p.approval_status === 'changes_requested') && (
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/dashboard/submit?edit=${p.id}`}>Edit</Link>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" asChild><Link to={`/projects/${p.slug}`}>View</Link></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <SiteFooter />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: any) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center">
          <Icon className={cn("h-5 w-5", color ?? "text-muted-foreground")} />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider font-mono text-muted-foreground">{label}</div>
          <div className="font-display text-2xl font-bold">{value}</div>
        </div>
      </div>
    </Card>
  );
}
