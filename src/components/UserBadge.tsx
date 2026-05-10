import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Sparkles, Award, Medal, Trophy, Flame } from 'lucide-react';

// Tier thresholds for the contribution badge. Boundaries are inclusive on the
// lower end. 0 contributions = no badge (component returns null).
const TIERS = [
  { min: 1,   max: 4,    label: 'Contributor',        icon: Sparkles, classes: 'border-info/40 text-info bg-info/5' },
  { min: 5,   max: 19,   label: 'Steady contributor', icon: Medal,    classes: 'border-success/40 text-success bg-success/5' },
  { min: 20,  max: 49,   label: 'Veteran contributor',icon: Award,    classes: 'border-warning/40 text-warning bg-warning/5' },
  { min: 50,  max: 99,   label: 'Champion',           icon: Trophy,   classes: 'border-accent/40 text-accent bg-accent/5' },
  { min: 100, max: Infinity, label: 'Pillar',         icon: Flame,    classes: 'border-destructive/50 text-destructive bg-destructive/5' },
] as const;

function tierFor(count: number) {
  return TIERS.find(t => count >= t.min && count <= t.max) ?? null;
}

const cache = new Map<string, number>();

export function useContributionCount(userId: string | undefined | null) {
  const [count, setCount] = useState<number | null>(userId && cache.has(userId) ? cache.get(userId)! : null);
  useEffect(() => {
    if (!userId) { setCount(null); return; }
    if (cache.has(userId)) { setCount(cache.get(userId)!); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('user_contribution_count', { _user_id: userId });
      if (cancelled) return;
      if (error) { setCount(0); return; }
      const n = Number(data ?? 0);
      cache.set(userId, n);
      setCount(n);
    })();
    return () => { cancelled = true; };
  }, [userId]);
  return count;
}

export function UserBadge({ userId, compact, className }: { userId: string | undefined | null; compact?: boolean; className?: string }) {
  const count = useContributionCount(userId);
  if (!userId || count === null || count === 0) return null;
  const tier = tierFor(count);
  if (!tier) return null;
  const Icon = tier.icon;
  const badge = (
    <Badge variant="outline" className={cn('text-[10px] uppercase tracking-wider font-mono gap-1', tier.classes, className)}>
      <Icon className="h-3 w-3" />
      {compact ? null : tier.label}
    </Badge>
  );
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild><span>{badge}</span></TooltipTrigger>
        <TooltipContent side="top" align="center">
          <div className="text-xs">
            <div className="font-semibold">{tier.label}</div>
            <div className="text-muted-foreground">{count} approved contribution{count === 1 ? '' : 's'}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
