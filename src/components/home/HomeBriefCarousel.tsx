import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, Banknote, Plus, Sparkles } from 'lucide-react';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

type BriefRow = { headline: string; created_at: string };

type SlideKind = 'brief' | 'today' | 'budget' | 'risk' | 'fresh';

type SlideData = {
  brief: BriefRow | null;
  newToday: number | null;
  budgetWeek: number | null;
  openRisks: number | null;
  freshWeek: number | null;
};

const SLIDE_ORDER: SlideKind[] = ['brief', 'today', 'budget', 'risk', 'fresh'];
const ROTATE_MS = 6000;

const npr = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

function formatStamp(iso: string | undefined) {
  if (!iso) return 'TODAY';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
}

function bigNum(n: number | null) {
  if (n === null) return '—';
  return n.toLocaleString();
}

export function HomeBriefCarousel() {
  const [data, setData] = useState<SlideData>({
    brief: null,
    newToday: null,
    budgetWeek: null,
    openRisks: null,
    freshWeek: null,
  });
  const [api, setApi] = useState<CarouselApi | null>(null);
  const [selected, setSelected] = useState(0);
  const [paused, setPaused] = useState(false);
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
      supabase
        .from('global_briefs')
        .select('headline, created_at')
        .eq('scope', 'global')
        .order('created_at', { ascending: false })
        .limit(1),
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
      const briefRow = briefRes.data && briefRes.data.length > 0 ? (briefRes.data[0] as BriefRow) : null;
      const budgetSum = (budgetRes.data ?? []).reduce(
        (sum: number, row: any) => sum + (Number(row?.budget_npr) || 0),
        0,
      );
      setData({
        brief: briefRow,
        newToday: typeof todayRes.count === 'number' ? todayRes.count : 0,
        budgetWeek: budgetSum,
        openRisks: typeof riskRes.count === 'number' ? riskRes.count : 0,
        freshWeek: typeof freshRes.count === 'number' ? freshRes.count : 0,
      });
    });
  }, []);

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

  useEffect(() => {
    if (!api || paused || reducedMotion) return;
    const id = window.setInterval(() => api.scrollNext(), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [api, paused, reducedMotion]);

  const briefStamp = formatStamp(data.brief?.created_at);

  const slides: Record<SlideKind, { kicker: string; Icon: typeof Sparkles; render: () => JSX.Element; href: string; cta: string }> = {
    brief: {
      kicker: `AI BRIEF — ${briefStamp}`,
      Icon: Sparkles,
      href: '/analytics',
      cta: 'See the full analysis',
      render: () => (
        <p className="font-display text-xl md:text-2xl leading-snug">
          {data.brief
            ? `"${data.brief.headline}"`
            : 'No AI brief published yet — an admin can generate one from the Admin → AI tools panel.'}
        </p>
      ),
    },
    today: {
      kicker: "TODAY'S PULSE",
      Icon: Plus,
      href: '/projects',
      cta: 'Browse projects',
      render: () => (
        <div>
          <div className="font-display text-5xl md:text-6xl font-bold leading-none">
            {bigNum(data.newToday)}
          </div>
          <div className="text-sm text-primary-foreground/75 mt-3">
            new {data.newToday === 1 ? 'project' : 'projects'} added today
          </div>
        </div>
      ),
    },
    budget: {
      kicker: 'BUDGET FLOW',
      Icon: Banknote,
      href: '/analytics',
      cta: 'Open analytics',
      render: () => (
        <div>
          <div className="font-display text-5xl md:text-6xl font-bold leading-none">
            {data.budgetWeek === null ? '—' : `NPR ${npr.format(data.budgetWeek)}`}
          </div>
          <div className="text-sm text-primary-foreground/75 mt-3">
            committed across projects added this week
          </div>
        </div>
      ),
    },
    risk: {
      kicker: 'RISK RADAR',
      Icon: AlertTriangle,
      href: '/projects',
      cta: 'Inspect projects',
      render: () => (
        <div>
          <div className="font-display text-5xl md:text-6xl font-bold leading-none">
            {bigNum(data.openRisks)}
          </div>
          <div className="text-sm text-primary-foreground/75 mt-3">
            high or critical {data.openRisks === 1 ? 'risk' : 'risks'} open across the portfolio
          </div>
        </div>
      ),
    },
    fresh: {
      kicker: 'FRESHNESS',
      Icon: Activity,
      href: '/projects',
      cta: 'See active projects',
      render: () => (
        <div>
          <div className="font-display text-5xl md:text-6xl font-bold leading-none">
            {bigNum(data.freshWeek)}
          </div>
          <div className="text-sm text-primary-foreground/75 mt-3">
            {data.freshWeek === 1 ? 'project' : 'projects'} updated in the last 7 days
          </div>
        </div>
      ),
    },
  };

  return (
    <Card
      ref={cardRef}
      className="bg-primary-glow/40 backdrop-blur border-primary-foreground/10 text-primary-foreground p-6 shadow-elegant"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex gap-1.5 items-center" role="tablist" aria-label="Brief slides">
          {SLIDE_ORDER.map((_, i) => (
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
        <span className="text-[10px] uppercase tracking-wider font-mono text-primary-foreground/60">
          Live snapshot
        </span>
      </div>

      <Carousel
        opts={{ loop: true, align: 'start', duration: 28 }}
        setApi={setApi}
        orientation="horizontal"
        className="-mx-1"
      >
        <CarouselContent className="-ml-0">
          {SLIDE_ORDER.map((kind) => {
            const slide = slides[kind];
            const Icon = slide.Icon;
            return (
              <CarouselItem key={kind} className="pl-0">
                <div className="px-1 min-h-[180px] flex flex-col justify-between gap-5">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-accent" />
                    <span className="text-xs uppercase tracking-wider font-mono text-primary-foreground/70">
                      {slide.kicker}
                    </span>
                  </div>
                  <div key={`${kind}-${selected}`} className="animate-fade-in flex-1">
                    {slide.render()}
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
    </Card>
  );
}
