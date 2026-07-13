/**
 * Market-report narrative: a short, human-sounding write-up of a city's market,
 * generated from the CityMarketReport stats. Prefers an Anthropic API call
 * (ANTHROPIC_API_KEY), falls back to a deterministic template when no key/on
 * error. Cached per city (regenerated only when the stats change) so the model
 * isn't called on every page render.
 *
 * HARD RULE: the output never contains em dashes or en dashes (owner request).
 */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { marketNarratives } from '../drizzle/schema';
import type { CityMarketReport } from './idx';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/** Strip em/en dashes (and dash-as-punctuation) so none ever reach the page. */
export function stripDashes(text: string): string {
  return text
    .replace(/\s*[—–―]\s*/g, ', ')
    .replace(/\s+--\s+/g, ', ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .trim();
}

/** Short signature of the stats that drive the text; cache key for regeneration. */
function signatureFor(r: CityMarketReport): string {
  const round = (n: number | null, step = 1) => (n == null ? 'x' : String(Math.round(n / step) * step));
  return [
    round(r.medianSalePrice, 1000),
    round(r.yoyChangePct, 1) + (r.yoyChangePct != null ? 'y' : ''),
    round(r.monthsOfInventory, 1),
    round(r.avgDaysOnMarket),
    round(r.listToSaleRatio, 1),
    String(r.homesSold90d),
    round(r.soldAboveAskingPct),
  ].join('|');
}

function marketType(moi: number | null): string | null {
  if (moi == null) return null;
  if (moi < 3) return "a seller's market";
  if (moi <= 6) return 'a balanced market';
  return "a buyer's market";
}

/** Deterministic, human-sounding fallback. No em dashes. */
export function fallbackNarrative(city: string, r: CityMarketReport): string {
  const where = city || 'this area';
  const parts: string[] = [];
  const mt = marketType(r.monthsOfInventory);
  if (mt) {
    parts.push(`${where} stayed firmly ${mt} this quarter.`);
  } else {
    parts.push(`Here is how the ${where} market is shaping up this quarter.`);
  }

  const supplyBits: string[] = [];
  if (r.monthsOfInventory != null) supplyBits.push(`about ${r.monthsOfInventory} months of supply`);
  if (r.avgDaysOnMarket != null) supplyBits.push(`a median of roughly ${r.avgDaysOnMarket} days on market`);
  if (r.listToSaleRatio != null) supplyBits.push(`homes selling at ${r.listToSaleRatio}% of list price`);
  if (supplyBits.length) {
    parts.push(`With ${supplyBits.join(', ')}, demand has stayed steady.`);
  }

  const closers: string[] = [];
  if (r.soldAboveAskingPct != null && r.soldAboveAskingPct > 0) {
    closers.push(`${r.soldAboveAskingPct}% of sellers landed at or above asking`);
  }
  if (r.yoyChangePct != null) {
    const dir = r.yoyChangePct >= 0 ? 'up' : 'down';
    closers.push(`the median sale price is ${dir} ${Math.abs(r.yoyChangePct)}% from a year ago`);
  }
  if (closers.length) {
    parts.push(`${closers.join(', and ')}. Sellers who prepared and priced well routinely drew strong interest.`);
  }

  return stripDashes(parts.join(' '));
}

function buildPrompt(city: string, r: CityMarketReport): string {
  const lines = [
    `City: ${city}`,
    `Period: ${r.periodLabel}`,
    r.medianSalePrice != null ? `Median sale price (last 90 days): $${r.medianSalePrice.toLocaleString()}` : null,
    r.yoyChangePct != null ? `Year over year change in median price: ${r.yoyChangePct}%` : null,
    r.medianPricePerSqft != null ? `Median price per square foot: $${r.medianPricePerSqft}` : null,
    r.avgDaysOnMarket != null ? `Average days on market: ${r.avgDaysOnMarket}` : null,
    r.listToSaleRatio != null ? `List to sale ratio: ${r.listToSaleRatio}%` : null,
    `Homes sold in the last 90 days: ${r.homesSold90d}`,
    r.soldAboveAskingPct != null ? `Share sold above asking: ${r.soldAboveAskingPct}%` : null,
    r.monthsOfInventory != null ? `Months of inventory: ${r.monthsOfInventory}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

async function generateWithAnthropic(city: string, r: CityMarketReport): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
  const system =
    'You are a seasoned local real estate agent writing a short market summary for a ' +
    'home valuation report. Write 2 to 3 sentences in a warm, confident, human voice. ' +
    'Use only the numbers provided and do not invent any figures. Do not use bullet points ' +
    'or markdown. IMPORTANT: never use em dashes or en dashes; write in plain sentences ' +
    'with commas and periods only. Return the summary text and nothing else.';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 240,
        system,
        messages: [
          {
            role: 'user',
            content: `Write the market summary for ${city} from this data:\n\n${buildPrompt(city, r)}`,
          },
        ],
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error('[marketNarrative] Anthropic error', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = data.content?.map((c) => (c.type === 'text' ? c.text ?? '' : '')).join('').trim();
    return text ? stripDashes(text) : null;
  } catch (err) {
    console.error('[marketNarrative] Anthropic call failed:', err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Get the market narrative for a city, cached and regenerated only when the
 * stats signature changes. Always returns a non-empty, dash-free string.
 */
export async function getMarketNarrative(city: string, report: CityMarketReport): Promise<string> {
  const cityKey = city.trim().toLowerCase();
  const sig = signatureFor(report);

  // Cache hit — same stats as last time.
  try {
    const rows = await db
      .select()
      .from(marketNarratives)
      .where(eq(marketNarratives.cityKey, cityKey))
      .limit(1);
    const row = rows[0];
    if (row?.narrative && row.signature === sig) return row.narrative;
  } catch (err) {
    console.warn('[marketNarrative] cache read failed:', err);
  }

  const generated = (await generateWithAnthropic(city, report)) ?? fallbackNarrative(city, report);
  const narrative = stripDashes(generated);

  // Cache best-effort.
  try {
    await db
      .insert(marketNarratives)
      .values({ cityKey, narrative, signature: sig, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: marketNarratives.cityKey,
        set: { narrative, signature: sig, updatedAt: new Date() },
      });
  } catch (err) {
    console.warn('[marketNarrative] cache write failed:', err);
  }

  return narrative;
}
