import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface Ad {
  id: string;
  title: string;
  image_url: string | null;
  target_url: string | null;
  advertiser: string | null;
}

export function AdSlot({ slotKey, className, variant = 'banner' }: { slotKey: string; className?: string; variant?: 'banner' | 'sidebar' | 'inline' }) {
  const [ad, setAd] = useState<Ad | null>(null);
  useEffect(() => {
    supabase.from('ad_slots').select('id,title,image_url,target_url,advertiser')
      .eq('slot_key', slotKey).eq('active', true).limit(1)
      .then(({ data }) => setAd(data?.[0] ?? null));
  }, [slotKey]);

  const sizes = {
    banner: 'min-h-[100px]',
    sidebar: 'min-h-[280px]',
    inline: 'min-h-[140px]',
  };

  return (
    <div className={cn(
      "relative rounded-lg border border-dashed border-border bg-muted/30 overflow-hidden group",
      sizes[variant], className
    )}>
      <div className="absolute top-2 left-2 text-[9px] uppercase tracking-wider font-mono text-muted-foreground/70 z-10 bg-background/80 px-1.5 py-0.5 rounded">Ad</div>
      {ad ? (
        <a href={ad.target_url ?? '#'} target="_blank" rel="noopener noreferrer sponsored" className="block h-full">
          {ad.image_url ? (
            <img src={ad.image_url} alt={ad.title} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
          ) : (
            <div className="h-full p-6 flex flex-col justify-center gradient-hero text-primary-foreground">
              <p className="text-xs uppercase tracking-wider opacity-70 mb-1">{ad.advertiser}</p>
              <p className="font-display text-lg font-semibold">{ad.title}</p>
            </div>
          )}
        </a>
      ) : (
        <div className="h-full flex items-center justify-center text-xs text-muted-foreground/60 font-mono px-4 text-center">
          Sponsored slot · {slotKey}
        </div>
      )}
    </div>
  );
}
