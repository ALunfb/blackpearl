#!/usr/bin/env node
/**
 * Fetches all Black Pearl knife data from CSFloat and saves to data/listings.json.
 * Run locally before deploying: node fetch-data.mjs
 * Respects rate limits by fetching one knife at a time with delays.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchBlackPearls, KNIVES } from './csfloat.mjs';
import { recordMarketCap } from './price-history.mjs';
import { getDbCounts } from './db-counts.mjs';
import { recordTrackerUpdate } from './listings-tracker.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, 'data', 'listings.json');

async function main() {
  console.log(`Fetching data for ${KNIVES.length} knives...\n`);
  const allData = [];

  for (let i = 0; i < KNIVES.length; i++) {
    const knife = KNIVES[i];
    process.stdout.write(`[${i + 1}/${KNIVES.length}] ${knife.name}... `);
    try {
      const data = await fetchBlackPearls(knife.id);
      allData.push(data);
      console.log(`${data.count} listings, floor $${Math.min(...Object.values(data.floor_prices).filter(p => p != null)) || '—'}`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      allData.push({
        knife_id: knife.id,
        knife_name: knife.name,
        count: 0,
        floor_prices: {},
        float_min: null,
        float_max: null,
        listings: [],
        error: err.message,
      });
    }

    // Wait between requests to avoid rate limits
    if (i < KNIVES.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Update the new-listings tracker BEFORE stripping all_listings, so it can
  // see the full set of items (not just the top-20 cheapest per knife).
  try {
    recordTrackerUpdate(allData);
  } catch (e) {
    console.error('[Tracker] Update failed:', e.message);
  }

  // Strip the transient `all_listings` field — it's only needed by the tracker
  // and would otherwise bloat listings.json substantially.
  const knivesForOutput = allData.map(d => {
    const { all_listings, ...rest } = d;
    return rest;
  });

  const output = {
    fetched_at: new Date().toISOString(),
    knives: knivesForOutput,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nSaved to ${OUT_FILE}`);
  console.log(`Total knives: ${allData.length}, Total listings: ${allData.reduce((s, d) => s + (d.count || 0), 0)}`);

  // Record market cap snapshot (throttled to once per 12 hours internally)
  try {
    recordMarketCap(allData, getDbCounts().counts);
  } catch (e) {
    console.error('[History] Market cap record failed:', e.message);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
