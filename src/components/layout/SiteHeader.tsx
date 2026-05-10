import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Mountain, Shield, LogOut, LayoutDashboard, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { UserBadge } from '@/components/UserBadge';

export function SiteHeader() {
  const { user, isReviewer, signOut } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<{ full_name: string | null; avatar_url: string | null } | null>(null);

  useEffect(() => {
    if (!user) { setProfile(null); return; }
    supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).maybeSingle()
      .then(({ data }) => setProfile(data as any));
  }, [user]);

  const links = [
    { to: '/projects', label: 'Browse' },
    { to: '/map', label: 'Map' },
    { to: '/compare', label: 'Compare' },
    { to: '/analytics', label: 'Analytics' },
  ];

  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'Account';
  const initials = (profile?.full_name || user?.email || '?')
    .split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?';

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="container flex h-16 items-center justify-between gap-6">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="relative">
            <div className="h-9 w-9 rounded-md gradient-hero flex items-center justify-center">
              <Mountain className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-background" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-lg font-bold tracking-tight">Nepal Infra Watch</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground -mt-0.5">Public Project Tracker</div>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {links.map(l => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => cn(
              "px-3 py-2 text-sm font-medium rounded-md transition-colors",
              isActive ? "text-accent" : "text-foreground/70 hover:text-foreground hover:bg-muted"
            )}>{l.label}</NavLink>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          {user ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link to="/dashboard" aria-label={displayName} className="mr-1 flex items-center gap-1.5">
                    <Avatar className="h-9 w-9 ring-2 ring-border hover:ring-accent transition">
                      {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={displayName} />}
                      <AvatarFallback className="bg-accent/15 text-accent text-xs font-semibold">{initials}</AvatarFallback>
                    </Avatar>
                    <UserBadge userId={user.id} compact />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>{displayName}</TooltipContent>
              </Tooltip>

              {isReviewer && (
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/admin"><Shield className="h-4 w-4" /> Admin</Link>
                </Button>
              )}
              <Button variant="ghost" size="sm" asChild>
                <Link to="/dashboard"><LayoutDashboard className="h-4 w-4" /> Dashboard</Link>
              </Button>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" aria-label="Log out" onClick={async () => { await signOut(); nav('/'); }}>
                    <LogOut className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Log out</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild><Link to="/auth">Sign in</Link></Button>
              <Button size="sm" className="bg-accent hover:bg-accent/90 text-accent-foreground" asChild>
                <Link to="/auth?mode=signup">Submit a project</Link>
              </Button>
            </>
          )}
        </div>

        <button className="md:hidden p-2" onClick={() => setOpen(!open)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t bg-background">
          <div className="container py-3 flex flex-col gap-1">
            {links.map(l => (
              <NavLink key={l.to} to={l.to} onClick={() => setOpen(false)}
                className="px-3 py-2 text-sm font-medium rounded-md hover:bg-muted">{l.label}</NavLink>
            ))}
            <div className="border-t my-2" />
            {user ? (
              <>
                <Link to="/dashboard" onClick={() => setOpen(false)} className="px-3 py-2 text-sm font-medium flex items-center gap-2">
                  <Avatar className="h-7 w-7">
                    {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={displayName} />}
                    <AvatarFallback className="bg-accent/15 text-accent text-[10px] font-semibold">{initials}</AvatarFallback>
                  </Avatar>
                  {displayName}
                </Link>
                {isReviewer && <Link to="/admin" onClick={() => setOpen(false)} className="px-3 py-2 text-sm font-medium">Admin</Link>}
                <button onClick={async () => { await signOut(); setOpen(false); nav('/'); }} className="px-3 py-2 text-sm font-medium text-left">Log out</button>
              </>
            ) : (
              <>
                <Link to="/auth" onClick={() => setOpen(false)} className="px-3 py-2 text-sm font-medium">Sign in</Link>
                <Link to="/auth?mode=signup" onClick={() => setOpen(false)} className="px-3 py-2 text-sm font-medium text-accent">Submit a project</Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
