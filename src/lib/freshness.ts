// Freshness label for project rows. Drives the public "updated N days ago"
// badge on ProjectCard / ProjectDetail and the stalest-first admin sort.
// Read against `projects.last_activity_at` (denormalised; maintained by
// triggers across all 10 child tables — see supabase/migrations/20260515000000).

export type FreshnessColor = 'green' | 'amber' | 'gray';

export type FreshnessLabel = {
  color: FreshnessColor;
  text: string;
  /** Days since last activity. null when last_activity_at is null/unparseable. */
  days: number | null;
};

const DAY_MS = 86_400_000;

export function freshnessLabel(
  lastActivityAt: string | null | undefined,
  now: Date = new Date()
): FreshnessLabel {
  if (!lastActivityAt) return { color: 'gray', text: 'No activity', days: null };
  const ts = Date.parse(lastActivityAt);
  if (!isFinite(ts)) return { color: 'gray', text: 'No activity', days: null };

  const diff = now.getTime() - ts;
  const days = Math.max(0, Math.floor(diff / DAY_MS));

  let color: FreshnessColor;
  if (days < 14) color = 'green';
  else if (days < 30) color = 'amber';
  else color = 'gray';

  let text: string;
  if (days === 0) text = 'Updated today';
  else if (days === 1) text = 'Updated yesterday';
  else if (days < 30) text = `Updated ${days}d ago`;
  else if (days < 365) text = `Updated ${Math.floor(days / 30)}mo ago`;
  else text = `Updated ${Math.floor(days / 365)}y ago`;

  return { color, text, days };
}

// Tailwind utility class strings for each freshness color. Centralised so the
// badge looks the same wherever it's rendered.
export const FRESHNESS_CLASSES: Record<FreshnessColor, string> = {
  green: 'bg-success/10 text-success border-success/30',
  amber: 'bg-warning/10 text-warning border-warning/30',
  gray:  'bg-muted text-muted-foreground border-muted-foreground/20',
};
