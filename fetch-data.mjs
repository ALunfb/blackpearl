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
const HEALTH_FILE = path.join(__dirname, 'data', 'fetch-health.json');

// Append a per-run health record. Capped at 500 entries so the file stays
// small. Read after each run to watch for 429/flag-related failures before
// they escalate.
function recordHealth(entry) {
  let log = { runs: [] };
  try {
    if (fs.existsSync(HEALTH_FILE)) log = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
  } catch { log = { runs: [] }; }
  log.runs.push(entry);
  if (log.runs.length > 500) log.runs = log.runs.slice(-500);
  log.updated_at = entry.finished_at;
  fs.writeFileSync(HEALTH_FILE, JSON.stringify(log, null, 2));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  // IP-lock safety: CSFloat will flag the API key if it's used from too many
  // different IPs in a short window. To prevent this, fetch-data.mjs should
  // ONLY run from the production Droplet. Set PRODUCTION_FETCHER=1 in the
  // Droplet's .env to opt in. Any other machine running this without the
  // override will error out to prevent accidental multi-IP usage.
  if (!process.env.PRODUCTION_FETCHER && !process.env.GITHUB_ACTIONS) {
    console.error('ERROR: fetch-data.mjs is IP-locked.');
    console.error('This script should only run on the production Droplet.');
    console.error('If you really need to run it here, set PRODUCTION_FETCHER=1.');
    console.error('Running from multiple IPs will get your CSFloat API key flagged.');
    process.exit(1);
  }

  // Startup jitter: random 0-8 minute delay. Skipped if --now flag is passed
  // (for manual runs or CI where you want it to start immediately).
  const skipJitter = process.argv.includes('--now');
  if (!skipJitter) {
    const jitterMs = randomInt(0, 8 * 60) * 1000;
    if (jitterMs > 0) {
      console.log(`Jitter delay: ${Math.round(jitterMs / 1000)}s before fetch...`);
      await new Promise(r => setTimeout(r, jitterMs));
    }
  }

  console.log(`Fetching data for ${KNIVES.length} knives...\n`);
  const allData = [];
  const runStartedAt = new Date().toISOString();
  const errors = []; // per-knife error messages — surfaced in fetch-health.json

  for (let i = 0; i < KNIVES.length; i++) {
    const knife = KNIVES[i];
    process.stdout.write(`[${i + 1}/${KNIVES.length}] ${knife.name}... `);
    try {
      const data = await fetchBlackPearls(knife.id);
      allData.push(data);
      console.log(`${data.count} listings, floor $${Math.min(...Object.values(data.floor_prices).filter(p => p != null)) || '—'}`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      errors.push({ knife: knife.id, message: err.message });
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

    // Wait between requests — randomized 5-8s to avoid clockwork patterns
    if (i < KNIVES.length - 1) {
      await new Promise(r => setTimeout(r, randomInt(5000, 8000)));
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

  // Write health record — used to spot flag-related regressions early.
  // Look for growing `error_count` or any message containing "rate limit",
  // "429", "403", or CSFloat account-flag language.
  const totalListings = allData.reduce((s, d) => s + (d.count || 0), 0);
  const rateLimitHits = errors.filter(e => /429|rate.?limit/i.test(e.message)).length;
  recordHealth({
    started_at: runStartedAt,
    finished_at: new Date().toISOString(),
    knife_count: allData.length,
    knives_with_data: allData.filter(d => d.count > 0).length,
    total_listings: totalListings,
    error_count: errors.length,
    rate_limit_hits: rateLimitHits,
    errors: errors.slice(0, 20), // cap to keep file small
  });
}

main().catch(err => {
  console.error('Fatal:', err);
  try {
    recordHealth({
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      fatal: err.message,
      error_count: 1,
    });
  } catch {}
  process.exit(1);
});
