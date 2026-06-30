/**
 * Offer window logic (Section 5.3) — 7am–8pm ET.
 *
 * The 3-hour acceptance timer starts when the offer email is SENT, not when the
 * lead arrives. Offers created outside the window are left unsent (offerSentAt
 * null) and dispatched by the cron job at the next 7am open.
 *
 * All times are evaluated in America/New_York regardless of server timezone.
 */

const ET_TZ = 'America/New_York';

const DEFAULT_START_HOUR = 7; // 7am ET
const DEFAULT_END_HOUR = 20; // 8pm ET

/** Returns the wall-clock hour (0-23) in America/New_York for the given instant. */
export function etHour(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TZ,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hourPart = parts.find((p) => p.type === 'hour');
  const hour = hourPart ? parseInt(hourPart.value, 10) : 0;
  // Intl may emit "24" for midnight under hour12:false — normalize to 0.
  return hour === 24 ? 0 : hour;
}

/**
 * Whether `date` falls inside the configured offer window [startHour, endHour).
 * Defaults to 7am–8pm ET.
 */
export function isWithinOfferWindow(
  date: Date = new Date(),
  startHour: number = DEFAULT_START_HOUR,
  endHour: number = DEFAULT_END_HOUR,
): boolean {
  const h = etHour(date);
  return h >= startHour && h < endHour;
}

/**
 * The next instant at which the window opens at `startHour` ET.
 * If currently before today's open, returns today's open; otherwise tomorrow's.
 */
export function nextWindowOpen(
  from: Date = new Date(),
  startHour: number = DEFAULT_START_HOUR,
): Date {
  // Work out the ET calendar date + hour for `from`.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(from);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour')) === 24 ? 0 : Number(get('hour'));

  // Determine the ET offset (in minutes) for `from` so we can build a UTC instant
  // that corresponds to a given ET wall-clock time.
  const offsetMinutes = etOffsetMinutes(from);

  const targetDay = hour < startHour ? day : day + 1;
  // Build a UTC date for targetDay startHour:00 ET.
  const utcMs = Date.UTC(year, month - 1, targetDay, startHour, 0, 0) - offsetMinutes * 60_000;
  return new Date(utcMs);
}

/** ET UTC-offset in minutes for the given instant (e.g. -240 for EDT, -300 for EST). */
function etOffsetMinutes(date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TZ,
    timeZoneName: 'shortOffset',
  });
  const tzName = dtf.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-5';
  // tzName like "GMT-4" or "GMT-5"
  const match = tzName.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!match) return -300;
  const hours = parseInt(match[1], 10);
  const mins = match[2] ? parseInt(match[2], 10) : 0;
  return hours * 60 + (hours < 0 ? -mins : mins);
}
