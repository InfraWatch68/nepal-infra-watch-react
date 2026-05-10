import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { History, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const ACTION_COLORS: Record<string, string> = {
  approved: 'bg-success/15 text-success',
  rejected: 'bg-destructive/15 text-destructive',
  changes_requested: 'bg-info/15 text-info',
  submitted: 'bg-muted text-muted-foreground',
  edited: 'bg-warning/15 text-warning',
};

type Review = {
  id: string;
  reviewer_id: string | null;
  reviewer_role: string | null;
  action: string;
  notes: string | null;
  was_admin: boolean;
  created_at: string;
  profile?: { full_name: string | null; email: string | null } | null;
};

export function ReviewHistoryIcon({
  targetTable,
  targetId,
  className,
}: {
  targetTable: string;
  targetId: string | number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => {
    if (!open || reviews.length > 0) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('project_reviews')
        .select('id, reviewer_id, reviewer_role, action, notes, was_admin, created_at')
        .eq('target_table', targetTable)
        .eq('target_id', String(targetId))
        .order('created_at', { ascending: false });
      const rows = (data ?? []) as Review[];
      // Hydrate reviewer names from profiles. RLS should permit selecting public name fields.
      const ids = Array.from(new Set(rows.map(r => r.reviewer_id).filter(Boolean) as string[]));
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', ids);
        const byId = new Map((profs ?? []).map((p: any) => [p.id, p]));
        rows.forEach(r => { r.profile = r.reviewer_id ? byId.get(r.reviewer_id) ?? null : null; });
      }
      setReviews(rows);
      setLoading(false);
    })();
  }, [open, reviews.length, targetTable, targetId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-accent', className)}
          aria-label="Review history"
        >
          <History className="h-3.5 w-3.5" />
          {reviews.length > 0 && <span className="font-mono">{reviews.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 max-h-96 overflow-y-auto" align="end">
        <div className="text-xs font-semibold mb-2 flex items-center gap-1">
          <History className="h-3.5 w-3.5" /> Review history
        </div>
        {loading ? (
          <div className="py-6 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
        ) : reviews.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted-foreground">No review actions yet.</div>
        ) : (
          <ul className="space-y-2.5">
            {reviews.map(r => (
              <li key={r.id} className="text-xs border-l-2 border-border pl-2.5 py-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge className={cn('text-[10px] uppercase font-mono', ACTION_COLORS[r.action])}>
                    {r.action.replace(/_/g, ' ')}
                  </Badge>
                  {r.was_admin && <Badge variant="outline" className="text-[10px] uppercase font-mono border-accent text-accent">admin push</Badge>}
                  <span className="text-muted-foreground font-mono">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                <div className="mt-1 text-foreground">
                  {r.profile?.full_name ?? r.profile?.email ?? 'Unknown reviewer'}
                  {r.reviewer_role && <span className="text-muted-foreground"> · {r.reviewer_role}</span>}
                </div>
                {r.notes && <div className="mt-0.5 italic text-muted-foreground">"{r.notes}"</div>}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
