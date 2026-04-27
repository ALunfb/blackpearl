#!/usr/bin/env node
/**
 * Phase 4 healthcheck for the CSFloat fetcher.
 *
 *   node check-fetch-health.mjs           # check the last 6 runs
 *   node check-fetch-health.mjs --last 12 # check the last 12 runs
 *
 * Exit codes:
 *   0  All recent runs are healthy.
 *   1  One or more recent runs had errors / 429s / fatal failures, OR the
 *      health log is missing entirely (i.e. fetch-data.mjs has not run).
 *
 * Wire this into Droplet cron once an hour as a hands-off canary, e.g.:
 *   30 * * * * cd /opt/blackpearl && node check-fetch-health.mjs || \
 *     curl -fsS -X POST -d "fetch unhealthy" https://your-alerting-endpoint
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEALTH_FILE = path.join(__dirname, 'data', 'fetch-health.json');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

const N = parseInt(arg('--last', '6'), 10);

if (!fs.existsSync(HEALTH_FILE)) {
  console.error(`UNHEALTHY: ${HEALTH_FILE} does not exist — fetch-data.mjs has not run.`);
  process.exit(1);
}

let log;
try {
  log = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
} catch (err) {
  console.error(`UNHEALTHY: cannot parse ${HEALTH_FILE}: ${err.message}`);
  process.exit(1);
}

const runs = (log.runs || []).slice(-N);
if (runs.length === 0) {
  console.error('UNHEALTHY: no runs recorded in health log');
  process.exit(1);
}

const bad = runs.filter(r =>
  r.fatal ||
  (r.error_count ?? 0) > 0 ||
  (r.rate_limit_hits ?? 0) > 0 ||
  // a clean run hits all 18 knives — anything less is suspicious
  (typeof r.knives_with_data === 'number' && r.knives_with_data < 18)
);

if (bad.length > 0) {
  console.error(`UNHEALTHY: ${bad.length}/${runs.length} of the last runs had problems.`);
  for (const r of bad) {
    const summary = [
      r.finished_at,
      r.fatal ? `fatal=${r.fatal}` : null,
      r.error_count ? `errors=${r.error_count}` : null,
      r.rate_limit_hits ? `429s=${r.rate_limit_hits}` : null,
      typeof r.knives_with_data === 'number' && r.knives_with_data < 18
        ? `knives_with_data=${r.knives_with_data}/18` : null,
    ].filter(Boolean).join(' | ');
    console.error('  -', summary);
    if (r.errors?.length) {
      for (const e of r.errors.slice(0, 3)) console.error('     ·', e.knife, '→', e.message);
    }
  }
  process.exit(1);
}

const last = runs[runs.length - 1];
console.log(`HEALTHY: last ${runs.length} runs clean. Most recent: ${last.finished_at} (${last.total_listings} listings across ${last.knives_with_data} knives).`);
process.exit(0);
