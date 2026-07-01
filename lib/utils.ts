/** Small shared UI/formatting helpers. */

/** Tailwind className combiner (shadcn-style, without external deps). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** Format a number of cents/dollars as USD currency with commas, no decimals. */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

/** Format an integer with thousands separators. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US').format(value);
}

/** Format a 0-100 percent value, e.g. 102 -> "102%". */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value}%`;
}

/** Compact currency, e.g. 5800000 -> "$5.8M", 740000 -> "$740K". */
export function formatCompactCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) return '$0';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

/** Price range like "$430K–$470K" from low/high (falls back to estimate). */
export function formatPriceRange(
  low: number | null | undefined,
  high: number | null | undefined,
  estimate?: number | null,
): string | null {
  const k = (n: number) => `$${Math.round(n / 1000)}K`;
  if (low != null && high != null) return `${k(low)}–${k(high)}`;
  if (estimate != null) return `${k(Math.round(estimate * 0.92))}–${k(Math.round(estimate * 1.08))}`;
  return null;
}

/** Relative time label, e.g. "12m ago", "5h ago", "3d ago". */
export function relativeTime(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Format a Date as "Month Year", e.g. "March 2025". */
export function formatMonthYear(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Slugify a city name: "Grand Blanc" -> "grand-blanc". */
export function slugifyCity(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
