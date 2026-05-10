import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Calendar, Wallet } from 'lucide-react';
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/constants';
import { formatNPR } from '@/lib/parseCoords';
import { cn } from '@/lib/utils';

export function ProjectCard({ p }: { p: any }) {
  return (
    <Link to={`/projects/${p.slug}`}>
      <Card className="group h-full overflow-hidden hover:shadow-elegant transition-all duration-300 hover:-translate-y-0.5 border-border/60">
        <div className="relative aspect-[16/9] overflow-hidden bg-muted">
          {p.cover_image_url ? (
            <img src={p.cover_image_url} alt={p.title} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
          ) : (
            <div className="w-full h-full gradient-hero flex items-center justify-center">
              <span className="font-display text-3xl text-primary-foreground/40">{p.sector?.[0]}</span>
            </div>
          )}
          <div className="absolute top-3 left-3 flex gap-1.5 flex-wrap">
            <Badge className={cn("text-[10px] uppercase tracking-wider font-mono", STATUS_COLORS[p.status])}>
              {STATUS_LABELS[p.status]}
            </Badge>
          </div>
          {typeof p.progress_percent === 'number' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-background/30">
              <div className="h-full bg-accent" style={{ width: `${Math.min(100, p.progress_percent)}%` }} />
            </div>
          )}
        </div>
        <div className="p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground font-mono">
            <span>{p.sector}</span>
            {p.province && <><span>·</span><span>{p.province}</span></>}
          </div>
          <h3 className="font-display text-lg font-semibold leading-snug line-clamp-2 group-hover:text-accent transition-colors">{p.title}</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-2 border-t border-border/60">
            <div className="flex items-center gap-1.5"><MapPin className="h-3 w-3" /><span className="truncate">{p.district || '—'}</span></div>
            <div className="flex items-center gap-1.5"><Wallet className="h-3 w-3" /><span className="truncate">{formatNPR(p.budget_npr)}</span></div>
            <div className="flex items-center gap-1.5 col-span-2"><Calendar className="h-3 w-3" /><span className="truncate">
              {p.start_date ? new Date(p.start_date).getFullYear() : '—'} → {p.expected_completion ? new Date(p.expected_completion).getFullYear() : 'TBD'}
            </span></div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
