/**
 * SEO structured data (Section 2.5).
 * Builds JSON-LD for the LocalBusiness (RealEstateAgent) and FAQPage schemas,
 * server-side, so stat values come from the database rather than hardcoded copy.
 */
import { formatCurrency } from './utils';

export interface FaqItem {
  question: string;
  answer: string;
}

export interface CityStructuredDataInput {
  cityName: string; // "Brighton"
  state: string; // "MI"
  siteUrl: string;
  officePhone?: string | null;
  faq: FaqItem[];
}

/** Parse the stored faqJson string into a typed array; tolerant of bad input. */
export function parseFaqJson(faqJson: string | null | undefined): FaqItem[] {
  if (!faqJson) return [];
  try {
    const parsed = JSON.parse(faqJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x.question === 'string' && typeof x.answer === 'string')
      .map((x) => ({ question: x.question, answer: x.answer }));
  } catch {
    return [];
  }
}

/** Validate an FAQ JSON string and return a structured result (used by the admin editor). */
export function validateFaqJson(faqJson: string): { valid: boolean; error?: string; items?: FaqItem[] } {
  try {
    const parsed = JSON.parse(faqJson);
    if (!Array.isArray(parsed)) return { valid: false, error: 'FAQ must be a JSON array.' };
    for (const item of parsed) {
      if (!item || typeof item.question !== 'string' || typeof item.answer !== 'string') {
        return { valid: false, error: 'Each FAQ item needs a string question and answer.' };
      }
    }
    return { valid: true, items: parsed };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
}

/** RealEstateAgent (LocalBusiness) schema for a city page. */
export function localBusinessSchema(input: CityStructuredDataInput): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateAgent',
    name: 'RE/MAX Platinum',
    url: input.siteUrl,
    ...(input.officePhone ? { telephone: input.officePhone } : {}),
    address: {
      '@type': 'PostalAddress',
      addressLocality: input.cityName,
      addressRegion: input.state,
      addressCountry: 'US',
    },
    areaServed: {
      '@type': 'City',
      name: input.cityName,
    },
    description: `RE/MAX Platinum — local real estate experts serving ${input.cityName}, ${input.state}`,
  };
}

/** FAQPage schema for a city page (stat values already interpolated into answers). */
export function faqPageSchema(faq: FaqItem[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

/**
 * Build both schemas for a city page. Returns an array suitable for a single
 * <script type="application/ld+json"> tag.
 */
export function generateCityStructuredData(input: CityStructuredDataInput): Record<string, unknown>[] {
  return [localBusinessSchema(input), faqPageSchema(input.faq)];
}

export interface MarketStatValues {
  avgSalePrice?: number | null;
  daysToSell?: number | null;
  homesSold?: number | null;
  percentOfListPrice?: number | null;
}

/**
 * Interpolate market-stat placeholders into FAQ answers when stats exist.
 * Replaces tokens like {avgSalePrice}, {daysToSell}, {percentOfListPrice}.
 * If a stat is missing, the stored fallback answer is kept unchanged.
 */
export function fillFaqStats(faq: FaqItem[], stats: MarketStatValues | null): FaqItem[] {
  if (!stats) return faq;
  const replacements: Record<string, string> = {
    '{avgSalePrice}': stats.avgSalePrice != null ? formatCurrency(stats.avgSalePrice) : '',
    '{daysToSell}': stats.daysToSell != null ? String(stats.daysToSell) : '',
    '{percentOfListPrice}': stats.percentOfListPrice != null ? `${stats.percentOfListPrice}%` : '',
  };
  return faq.map((item) => {
    let answer = item.answer;
    for (const [token, value] of Object.entries(replacements)) {
      if (value) answer = answer.split(token).join(value);
    }
    return { question: item.question, answer };
  });
}
