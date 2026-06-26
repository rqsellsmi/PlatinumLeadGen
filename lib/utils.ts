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
