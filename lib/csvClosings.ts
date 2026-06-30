/**
 * CSV closings parsing + column-alias mapping (v1.6 §A.3).
 *
 * One logical CSV type — an MLS closings export — tagged with an agentRole
 * ('listing' | 'buyer') supplied by the caller (not the CSV). Column names vary
 * by MLS export format, so headers are matched case-insensitively against a set
 * of aliases (first match wins).
 */

export type AgentRole = 'listing' | 'buyer';

/** Header aliases per target column (matched case-insensitively, first wins). */
const COLUMN_ALIASES: Record<string, string[]> = {
  closeDate: ['Close Date', 'CloseDate', 'Closing Date', 'Date Closed'],
  listPrice: ['List Price', 'ListPrice', 'Original Price', 'Original List Price'],
  salePrice: ['Sale Price', 'SalePrice', 'Sold Price', 'Close Price'],
  daysOnMarket: ['Days on Market', 'DOM', 'CDOM', 'Days On Market', 'DaysOnMarket'],
  address: ['Address', 'Property Address', 'Street Address'],
  city: ['City'],
  state: ['State'],
  zipCode: ['Zip', 'ZIP', 'Zip Code', 'Postal Code'],
  propertyType: ['Property Type', 'Type'],
  agentName: ['Agent', 'Agent Name', 'Listing Agent', 'Buyer Agent'],
  mlsNumber: ['MLS', 'MLS #', 'MLS Number'],
  schoolDistrict: ['School District', 'District', 'School'],
  percentOfListPrice: [
    'RATIO Close Price By List Price',
    '% of List Price',
    'Sale to List Ratio',
    'Pct Of List',
    'Sale/List',
  ],
};

export interface MappedClosing {
  mlsNumber: string | null;
  agentRole: AgentRole;
  closeDate: Date;
  listPrice: number | null;
  salePrice: number;
  daysOnMarket: number | null;
  address: string;
  city: string | null;
  state: string;
  zipCode: string | null;
  propertyType: string;
  agentName: string | null;
  schoolDistrict: string | null;
  percentOfListPrice: number | null;
}

export interface ParsedClosings {
  rows: MappedClosing[];
  /** Per-row error messages (skipped rows with missing required fields, etc.). */
  errors: string[];
}

/**
 * Minimal RFC-4180-ish CSV parser. Handles quoted fields, escaped quotes (""),
 * and CRLF/LF line endings. No external dependency.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // ignore — handled by the following \n
    } else {
      field += c;
    }
  }
  // Flush trailing field/row (no newline at EOF).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Parse a date in several common MLS formats. Returns null if unparseable. */
export function parseCloseDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  // YYYY-MM-DD or ISO 8601
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // MM/DD/YYYY or M/D/YYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    const d = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // "January 15, 2025" and other Date-parseable strings
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Strip $ and commas, parse to integer. Returns null if not a number. */
export function parseMoney(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Math.round(Number(cleaned));
  return Number.isNaN(n) ? null : n;
}

/** Parse an integer (days on market). Returns null if not a number. */
export function parseIntOrNull(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[,\s]/g, '');
  if (cleaned === '') return null;
  const n = parseInt(cleaned, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Parse a sale/list ratio. Handles both decimal (0.985) and percentage (98.5)
 * formats: a value between 0 and 5 is treated as a ratio and multiplied by 100.
 */
export function parsePercentOfList(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[%$,\s]/g, '');
  if (cleaned === '') return null;
  let v = Number(cleaned);
  if (Number.isNaN(v)) return null;
  if (v > 0 && v <= 5) v = v * 100;
  return v;
}

/** Build a header → index lookup from the first CSV row. */
function buildHeaderIndex(header: string[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}

function pick(
  cells: string[],
  headerIndex: Map<string, number>,
  aliases: string[],
): string | undefined {
  for (const alias of aliases) {
    const idx = headerIndex.get(alias.toLowerCase());
    if (idx != null) {
      const val = cells[idx];
      if (val != null && val.trim() !== '') return val.trim();
    }
  }
  return undefined;
}

/**
 * Parse + map a closings CSV. Per-row errors are collected without aborting the
 * whole import. Rows missing required fields (salePrice, closeDate, address) are
 * skipped with an error logged.
 */
export function parseClosingsCsv(text: string, agentRole: AgentRole): ParsedClosings {
  const rawRows = parseCsvRows(text);
  const rows: MappedClosing[] = [];
  const errors: string[] = [];

  if (rawRows.length < 2) {
    errors.push('CSV has no data rows.');
    return { rows, errors };
  }

  const headerIndex = buildHeaderIndex(rawRows[0]);

  for (let i = 1; i < rawRows.length; i++) {
    const cells = rawRows[i];
    const rowNum = i + 1; // 1-based incl. header

    const closeRaw = pick(cells, headerIndex, COLUMN_ALIASES.closeDate);
    const closeDate = closeRaw ? parseCloseDate(closeRaw) : null;
    const salePrice = parseMoney(pick(cells, headerIndex, COLUMN_ALIASES.salePrice));
    const address = pick(cells, headerIndex, COLUMN_ALIASES.address) ?? '';

    if (!closeDate) {
      errors.push(`Row ${rowNum}: missing or invalid Close Date — skipped.`);
      continue;
    }
    if (salePrice == null) {
      errors.push(`Row ${rowNum}: missing or invalid Sale Price — skipped.`);
      continue;
    }
    if (!address) {
      errors.push(`Row ${rowNum}: missing Address — skipped.`);
      continue;
    }

    rows.push({
      mlsNumber: pick(cells, headerIndex, COLUMN_ALIASES.mlsNumber) ?? null,
      agentRole,
      closeDate,
      listPrice: parseMoney(pick(cells, headerIndex, COLUMN_ALIASES.listPrice)),
      salePrice,
      daysOnMarket: parseIntOrNull(pick(cells, headerIndex, COLUMN_ALIASES.daysOnMarket)),
      address,
      city: pick(cells, headerIndex, COLUMN_ALIASES.city) ?? null,
      state: pick(cells, headerIndex, COLUMN_ALIASES.state) ?? 'MI',
      zipCode: pick(cells, headerIndex, COLUMN_ALIASES.zipCode) ?? null,
      propertyType: pick(cells, headerIndex, COLUMN_ALIASES.propertyType) ?? 'Single Family',
      agentName: pick(cells, headerIndex, COLUMN_ALIASES.agentName) ?? null,
      schoolDistrict: pick(cells, headerIndex, COLUMN_ALIASES.schoolDistrict) ?? null,
      percentOfListPrice: parsePercentOfList(
        pick(cells, headerIndex, COLUMN_ALIASES.percentOfListPrice),
      ),
    });
  }

  return { rows, errors };
}
