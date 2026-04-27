#!/usr/bin/env node
/**
 * Single-request CSFloat probe — the smallest possible test of API access.
 *
 *   PRODUCTION_FETCHER=1 node probe-csfloat.mjs
 *
 * Makes ONE request (Karambit listings, limit=1) and prints the raw HTTP
 * status + body. No retries. Run this BEFORE any fetch-data.mjs invocation
 * after rotating the API key — if this 429s, do not run fetch-data.mjs.
 *
 * IP-locked the same way fetch-data.mjs is: refuses to run anywhere except
 * the production Droplet to avoid adding more IPs to CSFloat's record.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.PRODUCTION_FETCHER) {
  console.error('ERROR: probe-csfloat.mjs is IP-locked.');
  console.error('Run only on the production Droplet with PRODUCTION_FETCHER=1.');
  console.error('Probing from any other IP risks compounding the multi-IP flag.');
  process.exit(1);
}

function loadApiKey() {
  if (process.env.CSFLOAT_API_KEY) return process.env.CSFLOAT_API_KEY;
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const m = env.match(/CSFLOAT_API_KEY\s*=\s*(.+)/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

const apiKey = loadApiKey();
if (!apiKey) {
  console.error('ERROR: CSFLOAT_API_KEY not found in env or .env');
  process.exit(1);
}

const url = 'https://csfloat.com/api/v1/listings?def_index=507&paint_index=417&limit=1';
console.log(`Probing CSFloat with key ${apiKey.slice(0, 4)}...${apiKey.slice(-4)} (1 request, limit=1)`);

const startedAt = Date.now();
try {
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  const elapsedMs = Date.now() - startedAt;
  const text = await res.text();
  console.log(`HTTP ${res.status} in ${elapsedMs}ms`);
  console.log(`Body (first 400 chars): ${text.slice(0, 400)}`);
  if (res.status === 200) {
    console.log('\nPROBE OK — key is working.');
    process.exit(0);
  } else {
    console.error('\nPROBE FAILED — key is not working. Do NOT run fetch-data.mjs.');
    process.exit(1);
  }
} catch (err) {
  console.error(`Network error: ${err.message}`);
  process.exit(1);
}
