'use client';

/**
 * Lead attribution capture (v1.6 §C, with §K.5 corrections).
 *
 * First-touch is stored in localStorage and preserved across sessions; latest
 * touch is stored too and updated each call. getLeadAttribution() both reads and
 * writes: it merges stored first-touch with the current URL params, persists,
 * and returns the merged object to spread into form submissions.
 *
 * Storage keys and device detection match the original system exactly (§K.5).
 */

const FIRST_TOUCH_KEY = 'remax_first_touch_attribution';
const LATEST_TOUCH_KEY = 'remax_latest_touch_attribution';
const SESSION_ID_KEY = 'remax_session_id';

export interface Attribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  referrer?: string;
  landingPageUrl?: string;
  deviceType?: string;
  sessionId?: string;
  firstSeenAt?: string; // ISO
  lastSeenAt?: string; // ISO
}

/** Device type by viewport width (§K.5 — NOT user agent). */
function getDeviceType(): string {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  if (w < 768) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    let id = sessionStorage.getItem(SESSION_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `s_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
      sessionStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
  } catch {
    return 'server';
  }
}

function readJson(key: string): Attribution {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Attribution;
  } catch {
    return {};
  }
}

/**
 * Read stored first-touch, merge with current URL params, persist first/latest
 * touch, and return the merged attribution to send with a lead.
 * SSR-safe: returns { sessionId: 'server' } when there is no window.
 */
export function getLeadAttribution(): Attribution {
  if (typeof window === 'undefined') return { sessionId: 'server' };

  const params = new URLSearchParams(window.location.search);
  const now = new Date().toISOString();
  const sessionId = getOrCreateSessionId();

  const fromUrl: Attribution = {
    utmSource: params.get('utm_source') ?? undefined,
    utmMedium: params.get('utm_medium') ?? undefined,
    utmCampaign: params.get('utm_campaign') ?? undefined,
    utmContent: params.get('utm_content') ?? undefined,
    utmTerm: params.get('utm_term') ?? undefined,
    gclid: params.get('gclid') ?? undefined,
    gbraid: params.get('gbraid') ?? undefined,
    wbraid: params.get('wbraid') ?? undefined,
    referrer: document.referrer || undefined,
    landingPageUrl: window.location.href,
    deviceType: getDeviceType(),
    sessionId,
    lastSeenAt: now,
  };

  try {
    // First-touch: write only once, preserving the original source/medium/etc.
    const existingFirst = localStorage.getItem(FIRST_TOUCH_KEY);
    let first: Attribution;
    if (!existingFirst) {
      first = { ...fromUrl, firstSeenAt: now };
      localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(first));
    } else {
      first = readJson(FIRST_TOUCH_KEY);
    }
    // Latest-touch: always overwrite.
    localStorage.setItem(LATEST_TOUCH_KEY, JSON.stringify(fromUrl));

    // Merge: first-touch wins for acquisition fields; keep latest timestamps +
    // current page context.
    return {
      ...fromUrl,
      ...stripUndefined(first),
      sessionId,
      lastSeenAt: now,
      firstSeenAt: first.firstSeenAt ?? now,
    };
  } catch {
    return { ...fromUrl };
  }
}

function stripUndefined(a: Attribution): Attribution {
  const out: Attribution = {};
  (Object.keys(a) as (keyof Attribution)[]).forEach((k) => {
    if (a[k] !== undefined && a[k] !== null && a[k] !== '') out[k] = a[k] as never;
  });
  return out;
}
