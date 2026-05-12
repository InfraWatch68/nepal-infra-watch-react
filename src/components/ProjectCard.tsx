import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Calendar, Wallet, Star, Pencil } from 'lucide-react';
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/constants';
import { formatNPR } from '@/lib/parseCoords';
import { freshnessLabel, FRESHNESS_CLASSES } from '@/lib/freshness';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

export function ProjectCard({ p }: { p: any }) {
  const { isReviewer } = useAuth();
  const freshness = freshnessLabel(p.last_activity_at);
  return (
    <Link to={`/projects/${p.slug}`} className="relative block">
      {isReviewer && (
        <Link
          to={`/dashboard/submit?edit=${p.id}`}
          onClick={(e) => e.stopPropagation()}
          aria-label="Edit project (admin)"
          className="absolute z-10 top-3 right-3 h-8 w-8 rounded-md bg-background/90 backdrop-blur border border-border flex items-center justify-center text-muted-foreground hover:text-accent hover:border-accent shadow-sm"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Link>
      )}
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
            {p.is_rastra_gaurav && (
              <Badge className="text-[10px] uppercase tracking-wider font-mono bg-accent text-accent-foreground gap-1">
                <Star className="h-3 w-3 fill-current" /> Rastra Gaurav
              </Badge>
            )}
          </div>
          <div className="absolute bottom-2 left-3">
            <Badge variant="outline" className={cn('text-[10px] font-mono', FRESHNESS_CLASSES[freshness.color])}>
              {freshness.text}
            </Badge>
          </div>
          {typeof p.progress_percent === 'number' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-background/30">
              <div className="h-full bg-accent" style={{ width: `${Math.min(100, p.progress_percent)}%` }} />
            </div>
          )}
        </div>
        <div className="p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground font-mono flex-wrap">
            <span>{p.sector}</span>
            {/* Secondary sectors from sectors[]: anything beyond the primary
                shows as a small "+ N" badge so multi-sector projects (e.g.
                hydropower that also supplies irrigation) signal that
                breadth in the card. */}
            {Array.isArray(p.sectors) && p.sectors.filter((s: string) => s && s !== p.sector).slice(0, 2).map((s: string) => (
              <span key={s} className="text-[10px] normal-case tracking-normal bg-muted/60 text-foreground/70 rounded px-1.5 py-0.5">+ {s}</span>
            ))}
            {p.province && <><span>·</span><span>{p.province}</span></>}
            {/* Spanning indicator — when provinces[] has more entries than
                just the primary, surface "+ N more" so a 7-province highway
                doesn't read as if it were a single-province project. */}
            {(() => {
              const extras = Array.isArray(p.provinces) ? p.provinces.filter((x: string) => x && x !== p.province).length : 0;
              return extras > 0
                ? <span className="text-[10px] normal-case tracking-normal bg-accent/15 text-accent rounded px-1.5 py-0.5">+ {extras} more</span>
                : null;
            })()}
          </div>
          <h3 className="font-display text-lg font-semibold leading-snug line-clamp-2 group-hover:text-accent transition-colors">{p.title}</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-2 border-t border-border/60">
            <div className="flex items-center gap-1.5"><MapPin className="h-3 w-3" /><span className="truncate">{[p.municipality, p.district].filter(Boolean).join(', ') || '—'}</span></div>
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
