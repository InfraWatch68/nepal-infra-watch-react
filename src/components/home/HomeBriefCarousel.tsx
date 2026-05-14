import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, Banknote, ChevronLeft, ChevronRight, Plus, Sparkles } from 'lucide-react';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

type BriefRow = {
  id: string;
  headline: string;
  body: string | null;
  scope: string;
  scope_province: string | null;
  importance: number | null;
  created_at: string;
};

// Slide kinds:
//   - dynamic brief slides keyed by `brief-<idx>` (up to 5 from global_briefs
//     ranked by importance DESC, created_at DESC)
//   - 4 fixed live-stat slides keyed by 'today' / 'budget' / 'risk' / 'fresh'
type SlideKey = string;
const STAT_KEYS: SlideKey[] = ['today', 'budget', 'risk', 'fresh'];

const ROTATE_MS = 6000;
const MAX_BRIEFS = 5;

const npr = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

function formatStamp(iso: string | undefined) {
  if (!iso) return 'TODAY';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
}

function bigNum(n: number | null) {
  if (n === null) return '—';
  return n.toLocaleString();
}

// Derive the display label for a brief slide header.
//   global → "National"
//   province:Bagmati → "Bagmati"
//   scope_province set → use it
function scopeLabel(brief: BriefRow): string {
  if (brief.scope === 'global') return 'National';
  if (brief.scope_province) return brief.scope_province;
  if (brief.scope.startsWith('province:')) return brief.scope.slice('province:'.length);
  if (brief.scope.startsWith('sector:')) return brief.scope.slice('sector:'.length);
  return brief.scope;
}

export function HomeBriefCarousel() {
  const [briefs, setBriefs] = useState<BriefRow[]>([]);
  const [newToday, setNewToday] = useState<number | null>(null);
  const [budgetWeek, setBudgetWeek] = useState<number | null>(null);
  const [openRisks, setOpenRisks] = useState<number | null>(null);
  const [freshWeek, setFreshWeek] = useState<number | null>(null);

  const [api, setApi] = useState<CarouselApi | null>(null);
  const [selected, setSelected] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useEffect(() => {
    const weekAgoISO = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const todayStartISO = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString();

    Promise.all([
      // Top 5 briefs across ALL scopes by importance. The new daily cron
      // (5 AM NPT) writes 8 briefs/day (1 national + 7 provincial), each
      // scored 0-1 by the AI. NULL importance rows (pre-importance-column
      // legacy briefs) sort last via nullsFirst:false.
      supabase
        .from('global_briefs')
        .select('id, headline, body, scope, scope_province, importance, created_at')
        .order('importance', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(MAX_BRIEFS),
      supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('approval_status', 'approved')
        .gte('created_at', todayStartISO),
      supabase
        .from('projects')
        .select('budget_npr')
        .eq('approval_status', 'approved')
        .gte('created_at', weekAgoISO),
      supabase
        .from('project_risks')
        .select('id', { count: 'exact', head: true })
        .in('severity', ['high', 'critical'])
        .eq('status', 'open')
        .eq('approval_status', 'approved'),
      supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('approval_status', 'approved')
        .gte('last_activity_at', weekAgoISO),
    ]).then(([briefRes, todayRes, budgetRes, riskRes, freshRes]) => {
      setBriefs((briefRes.data ?? []) as BriefRow[]);
      const budgetSum = (budgetRes.data ?? []).reduce(
        (sum: number, row: any) => sum + (Number(row?.budget_npr) || 0),
        0,
      );
      setNewToday(typeof todayRes.count === 'number' ? todayRes.count : 0);
      setBudgetWeek(budgetSum);
      setOpenRisks(typeof riskRes.count === 'number' ? riskRes.count : 0);
      setFreshWeek(typeof freshRes.count === 'number' ? freshRes.count : 0);
    });
  }, []);

  // Slide list: brief slides first (0..N) then 4 live-stat slides.
  const slideKeys: SlideKey[] = useMemo(
    () => [...briefs.map((_, i) => `brief-${i}`), ...STAT_KEYS],
    [briefs],
  );

  // Selected-slide tracker for the dots indicator.
  useEffect(() => {
    if (!api) return;
    const onSelect = () => setSelected(api.selectedScrollSnap());
    onSelect();
    api.on('select', onSelect);
    api.on('reInit', onSelect);
    return () => {
      api.off('select', onSelect);
      api.off('reInit', onSelect);
    };
  }, [api]);

  // Auto-rotate. Pauses on hover/focus + when motion is reduced. The earlier
  // version used api.scrollNext() but a stale `paused` closure could keep
  // the interval alive across pauses on some browsers; depending on `api`
  // identity is the fix. Re-attach interval on every paused-flip.
  useEffect(() => {
    if (!api || paused || reducedMotion) return;
    if (slideKeys.length < 2) return; // nothing to rotate
    const id = window.setInterval(() => {
      try { api.scrollNext(); } catch { /* api may be torn down */ }
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [api, paused, reducedMotion, slideKeys.length]);

  // Render content per slide.
  const renderSlide = (key: SlideKey) => {
    if (key.startsWith('brief-')) {
      const idx = parseInt(key.slice(6), 10);
      const brief = briefs[idx];
      if (!brief) return null;
      const label = scopeLabel(brief).toUpperCase();
      return {
        kicker: `AI BRIEF — ${label} · ${formatStamp(brief.created_at)}`,
        Icon: Sparkles,
        href: '/analytics',
        cta: 'See the full analysis',
        importance: brief.importance ?? null,
        node: (
          <p className="font-display text-lg sm:text-xl md:text-2xl leading-snug line-clamp-5">
            {`"${brief.headline}"`}
          </p>
        ),
      };
    }
    switch (key) {
      case 'today': return {
        kicker: "TODAY'S PULSE", Icon: Plus, href: '/analytics#activity', cta: 'See 30-day activity', importance: null,
        node: (<div>
          <div className="font-display text-4xl sm:text-5xl md:text-6xl font-bold leading-none">{bigNum(newToday)}</div>
          <div className="text-sm text-primary-foreground/75 mt-3">new {newToday === 1 ? 'project' : 'projects'} added today</div>
        </div>),
      };
      case 'budget': return {
        kicker: 'BUDGET FLOW', Icon: Banknote, href: '/analytics', cta: 'Open analytics', importance: null,
        node: (<div>
          <div className="font-display text-4xl sm:text-5xl md:text-6xl font-bold leading-none">
            {budgetWeek === null ? '—' : `NPR ${npr.format(budgetWeek)}`}
          </div>
          <div className="text-sm text-primary-foreground/75 mt-3">committed across projects added this week</div>
        </div>),
      };
      case 'risk': return {
        kicker: 'RISK RADAR', Icon: AlertTriangle, href: '/analytics#slips', cta: 'See worst slips', importance: null,
        node: (<div>
          <div className="font-display text-4xl sm:text-5xl md:text-6xl font-bold leading-none">{bigNum(openRisks)}</div>
          <div className="text-sm text-primary-foreground/75 mt-3">high or critical {openRisks === 1 ? 'risk' : 'risks'} open across the portfolio</div>
        </div>),
      };
      case 'fresh': return {
        kicker: 'FRESHNESS', Icon: Activity, href: '/analytics#stalest', cta: 'See stalest data', importance: null,
        node: (<div>
          <div className="font-display text-4xl sm:text-5xl md:text-6xl font-bold leading-none">{bigNum(freshWeek)}</div>
          <div className="text-sm text-primary-foreground/75 mt-3">{freshWeek === 1 ? 'project' : 'projects'} updated in the last 7 days</div>
        </div>),
      };
    }
    return null;
  };

  // Arrow controls — visible on desktop hover OR always on touch devices.
  // Touch devices keep them visible because hover doesn't fire on tap.
  const showArrows = hovering || (typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches);

  return (
    <Card
      ref={cardRef}
      className="relative bg-primary-glow/40 backdrop-blur border-primary-foreground/10 text-primary-foreground p-4 sm:p-6 shadow-elegant"
      onMouseEnter={() => { setPaused(true); setHovering(true); }}
      onMouseLeave={() => { setPaused(false); setHovering(false); }}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* Dots indicator + status line */}
      <div className="flex items-center justify-between mb-4 sm:mb-5 gap-2">
        <div className="flex gap-1.5 items-center flex-wrap" role="tablist" aria-label="Brief slides">
          {slideKeys.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === selected}
              aria-label={`Show slide ${i + 1}`}
              onClick={() => api?.scrollTo(i)}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i === selected ? 'w-6 bg-accent' : 'w-1.5 bg-primary-foreground/30 hover:bg-primary-foreground/50',
              )}
            />
          ))}
        </div>
        <span className="text-[10px] uppercase tracking-wider font-mono text-primary-foreground/60 shrink-0">
          {briefs.length > 0 ? `${briefs.length} brief${briefs.length === 1 ? '' : 's'} · live snapshot` : 'live snapshot'}
        </span>
      </div>

      <Carousel
        opts={{ loop: slideKeys.length > 1, align: 'start', duration: 28 }}
        setApi={setApi}
        orientation="horizontal"
        className="-mx-1"
      >
        <CarouselContent className="-ml-0">
          {slideKeys.map((key) => {
            const slide = renderSlide(key);
            if (!slide) return null;
            const Icon = slide.Icon;
            return (
              <CarouselItem key={key} className="pl-0">
                <div className="px-1 min-h-[180px] flex flex-col justify-between gap-4 sm:gap-5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Icon className="h-4 w-4 text-accent shrink-0" />
                    <span className="text-[10px] sm:text-xs uppercase tracking-wider font-mono text-primary-foreground/70 truncate">
                      {slide.kicker}
                    </span>
                    {slide.importance !== null && slide.importance >= 0.8 && (
                      <span className="text-[9px] uppercase tracking-wider font-mono rounded px-1.5 py-0.5 bg-destructive/30 text-destructive-foreground shrink-0">
                        important
                      </span>
                    )}
                  </div>
                  <div key={`${key}-${selected}`} className="animate-fade-in flex-1">
                    {slide.node}
                  </div>
                  <Link
                    to={slide.href}
                    className="text-sm text-accent hover:underline inline-flex items-center gap-1 self-start"
                  >
                    {slide.cta} <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </CarouselItem>
            );
          })}
        </CarouselContent>
      </Carousel>

      {/* Hover-reveal arrows (desktop) + always-visible on touch.
          Positioned inside the card edges so they don't overlap site chrome.
          Sized larger on mobile (44px target) for thumb-tap reachability. */}
      {slideKeys.length > 1 && (
        <>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Previous slide"
            onClick={() => api?.scrollPrev()}
            className={cn(
              'absolute left-1 sm:left-2 top-1/2 -translate-y-1/2 h-9 w-9 sm:h-8 sm:w-8 rounded-full',
              'bg-primary-glow/60 backdrop-blur border-primary-foreground/20 text-primary-foreground',
              'hover:bg-primary-glow/80 transition-opacity duration-200',
              showArrows ? 'opacity-100' : 'opacity-0 pointer-events-none',
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Next slide"
            onClick={() => api?.scrollNext()}
            className={cn(
              'absolute right-1 sm:right-2 top-1/2 -translate-y-1/2 h-9 w-9 sm:h-8 sm:w-8 rounded-full',
              'bg-primary-glow/60 backdrop-blur border-primary-foreground/20 text-primary-foreground',
              'hover:bg-primary-glow/80 transition-opacity duration-200',
              showArrows ? 'opacity-100' : 'opacity-0 pointer-events-none',
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </>
      )}
    </Card>
  );
}
