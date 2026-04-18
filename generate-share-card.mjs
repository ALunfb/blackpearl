#!/usr/bin/env node
/**
 * CLI: render the /share-card.html page for a given inspect link to a PNG.
 *   node generate-share-card.mjs "<inspect-link>" [out.png]
 *   node generate-share-card.mjs --listing <listing-id>
 *
 * Requires the dev server to be running on localhost:3000 (see serve.mjs), or
 * pass --url https://blackpearl.gg to render against production.
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let link = null;
let listingId = null;
let out = null;
let base = 'http://localhost:3000';

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--listing') listingId = args[++i];
  else if (a === '--url') base = args[++i];
  else if (a.startsWith('--')) { /* ignore unknown */ }
  else if (!link) link = a;
  else out = a;
}

async function resolveLinkFromListing(id) {
  const listingsPath = path.join(__dirname, 'data', 'listings.json');
  const data = JSON.parse(fs.readFileSync(listingsPath, 'utf8'));
  for (const knife of data.knives) {
    for (const l of (knife.listings || [])) {
      if (String(l.id) === String(id)) return l.inspect_link;
    }
  }
  throw new Error(`Listing ${id} not found in data/listings.json`);
}

if (!link && listingId) link = await resolveLinkFromListing(listingId);
if (!link) {
  console.error('Usage: node generate-share-card.mjs "<inspect-link>" [out.png]');
  console.error('   or: node generate-share-card.mjs --listing <listing-id>');
  process.exit(1);
}

if (!out) {
  const safe = listingId || link.slice(-12).replace(/[^A-Za-z0-9]/g, '');
  out = path.join(__dirname, 'temporary screenshots', `share-card-${safe}.png`);
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
const url = `${base}/share-card.html?link=${encodeURIComponent(link)}`;
console.log('Rendering', url);
await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log('Saved', out);
