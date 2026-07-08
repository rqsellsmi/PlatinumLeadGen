/**
 * Verify our OData $select field list against the live Realcomp $metadata
 * (IDX spec: "confirm OData field names against $metadata before finalizing").
 *
 * Fetches $metadata for the Property entity, extracts declared property names,
 * and reports any field in SELECT_FIELDS (or the office-key filter fields) that
 * Realcomp does not declare. Run locally or via a GitHub Action once creds are
 * set — no code change ships without a green run.
 *
 * Usage: tsx scripts/idx-verify-metadata.ts
 */
import 'dotenv/config';
import { fetchMetadata, isRealcompConfigured } from '../lib/realcomp';
import { SELECT_FIELDS } from '../lib/idxSync';

const EXTRA_FIELDS = [
  'ListOfficeKey', 'BuyerOfficeKey', 'CoListOfficeKey', 'CoBuyerOfficeKey', 'Media',
  'MediaURL', 'Order', 'MediaCategory',
];

async function main() {
  if (!isRealcompConfigured()) {
    throw new Error('Realcomp is not configured — set REALCOMP_CLIENT_ID / REALCOMP_CLIENT_SECRET.');
  }

  const xml = await fetchMetadata();
  // Property names appear as <Property Name="X" .../> and navigation props as
  // <NavigationProperty Name="X" ... />. Collect every declared name.
  const declared = new Set<string>();
  for (const m of xml.matchAll(/<(?:Property|NavigationProperty)\s+Name="([^"]+)"/g)) {
    declared.add(m[1]);
  }
  console.log(`[verify] $metadata declares ${declared.size} property/navigation names.`);

  const wanted = [...new Set([...SELECT_FIELDS.split(','), ...EXTRA_FIELDS])];
  const missing = wanted.filter((f) => !declared.has(f));

  if (missing.length === 0) {
    console.log(`[verify] OK — all ${wanted.length} requested fields exist in $metadata.`);
    return;
  }
  console.error(`[verify] ${missing.length} requested field(s) NOT found in $metadata:`);
  for (const f of missing) console.error(`  - ${f}`);
  console.error('\nUpdate SELECT_FIELDS / the mapping in lib/idxSync.ts to match the live schema.');
  process.exit(2);
}

main().catch((err) => {
  console.error('[verify] FAILED:', err);
  process.exit(1);
});
