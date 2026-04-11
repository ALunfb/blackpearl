import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { recordSnapshot } from './price-history.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load API key from process.env or .env file
function loadApiKey() {
  if (process.env.CSFLOAT_API_KEY) return process.env.CSFLOAT_API_KEY;
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const match = env.match(/CSFLOAT_API_KEY\s*=\s*(.+)/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

const API_BASE = 'https://csfloat.com/api/v1';

// Knife definitions: def_index + paint_index for Black Pearl Doppler
// Most knives use paint_index 417, but Butterfly & Shadow Daggers use 617
export const KNIVES = [
  { id: 'karambit',   name: 'Karambit',        def_index: 507, paint_index: 417 },
  { id: 'butterfly',  name: 'Butterfly Knife',  def_index: 515, paint_index: 617 },
  { id: 'm9',         name: 'M9 Bayonet',       def_index: 508, paint_index: 417 },
  { id: 'bayonet',    name: 'Bayonet',          def_index: 500, paint_index: 417 },
  { id: 'flip',       name: 'Flip Knife',       def_index: 505, paint_index: 417 },
  { id: 'gut',        name: 'Gut Knife',        def_index: 506, paint_index: 417 },
  { id: 'huntsman',   name: 'Huntsman Knife',   def_index: 509, paint_index: 417 },
  { id: 'bowie',      name: 'Bowie Knife',      def_index: 514, paint_index: 417 },
  { id: 'falchion',   name: 'Falchion Knife',   def_index: 512, paint_index: 417 },
  { id: 'stiletto',   name: 'Stiletto Knife',   def_index: 522, paint_index: 417 },
  { id: 'talon',      name: 'Talon Knife',      def_index: 523, paint_index: 417 },
  { id: 'skeleton',   name: 'Skeleton Knife',   def_index: 525, paint_index: 417 },
  { id: 'navaja',     name: 'Navaja Knife',     def_index: 520, paint_index: 417 },
  { id: 'ursus',      name: 'Ursus Knife',      def_index: 519, paint_index: 417 },
  { id: 'shadow',     name: 'Shadow Daggers',   def_index: 516, paint_index: 617 },
  { id: 'paracord',   name: 'Paracord Knife',   def_index: 517, paint_index: 417 },
  { id: 'survival',   name: 'Survival Knife',   def_index: 518, paint_index: 417 },
  { id: 'nomad',      name: 'Nomad Knife',      def_index: 521, paint_index: 417 },
];

// Wear condition mapping from float value
function wearFromFloat(f) {
  if (f <= 0.07) return 'FN';
  if (f <= 0.15) return 'MW';
  if (f <= 0.38) return 'FT';
  if (f <= 0.45) return 'WW';
  return 'BS';
}

// ── In-memory cache ──────────────────────────────────────────────
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const cache = {};

function getCached(key) {
  const entry = cache[key];
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;
  return null;
}

function setCache(key, data) {
  cache[key] = { ts: Date.now(), data };
}

// ── CSFloat API fetch (with retry on 429) ────────────────────────
async function apiFetch(url, apiKey) {
  const res = await fetch(url, {
    headers: { 'Authorization': apiKey },
  });

  if (res.status === 429) {
    // Use x-ratelimit-reset header if available, fall back to Retry-After or 10s
    const resetTs = parseInt(res.headers.get('x-ratelimit-reset') || '0', 10);
    let waitMs;
    if (resetTs > 0) {
      waitMs = Math.max(1000, resetTs * 1000 - Date.now() + 1000); // +1s buffer
      waitMs = Math.min(waitMs, 120_000); // cap at 2 minutes
    } else {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '10', 10);
      waitMs = retryAfter * 1000;
    }
    console.log(`[CSFloat] Rate limited, waiting ${Math.round(waitMs/1000)}s...`);
    await new Promise(r => setTimeout(r, waitMs));
    return apiFetch(url, apiKey);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CSFloat API ${res.status}: ${text}`);
  }

  return res.json();
}

// ── Fetch all pages of Black Pearl listings for one knife ────────
async function fetchAllListings(defIndex, paintIndex, apiKey) {
  const listings = [];
  let page = 0;
  const limit = 50;

  while (true) {
    const url = `${API_BASE}/listings?def_index=${defIndex}&paint_index=${paintIndex}&limit=${limit}&page=${page}&sort_by=lowest_price`;
    const data = await apiFetch(url, apiKey);

    const items = data?.data ?? [];
    if (items.length === 0) break;

    listings.push(...items);

    // CSFloat returns fewer than limit when we've hit the last page
    if (items.length < limit) break;

    page++;
    // Small delay to be respectful of rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  return listings;
}

// ── Transform raw listings into our data shape ───────────────────
function transformListings(rawListings) {
  const byWear = { FN: [], MW: [], FT: [], WW: [], BS: [] };

  const listings = rawListings.map(l => {
    const item = l.item ?? {};
    const float = item.float_value ?? 0;
    const wear = wearFromFloat(float);
    const priceUSD = (l.price ?? 0) / 100; // CSFloat prices are in cents

    byWear[wear].push(priceUSD);

    return {
      id: l.id,
      price: priceUSD,
      wear,
      float_value: float,
      paint_seed: item.paint_seed ?? null,
      stattrak: item.is_stattrak ?? false,
      csfloat_url: `https://csfloat.com/item/${l.id}`,
      inspect_link: item.inspect_link || item.serialized_inspect || null,
      image_url: item.icon_url
        ? `https://community.akamai.steamstatic.com/economy/image/${item.icon_url}/360fx360f`
        : null,
      seller: l.seller
        ? {
            steam_id: l.seller.steam_id ?? null,
            username: l.seller.username ?? null,
            avatar: l.seller.avatar ?? null,
            stall_url: l.seller.steam_id
              ? `https://csfloat.com/stall/${l.seller.steam_id}`
              : null,
          }
        : null,
    };
  });

  // Floor prices per wear (lowest listed)
  const floorPrice = {};
  for (const [wear, prices] of Object.entries(byWear)) {
    floorPrice[wear] = prices.length > 0 ? Math.min(...prices) : null;
  }

  // Float range across all listed items
  const floats = listings.map(l => l.float_value).filter(f => f > 0);
  const floatMin = floats.length ? Math.min(...floats) : null;
  const floatMax = floats.length ? Math.max(...floats) : null;

  return {
    count: listings.length,
    floor_prices: floorPrice,
    float_min: floatMin,
    float_max: floatMax,
    listings: listings.slice(0, 20), // return top 20 for the owners panel
    // Full list — used by the new-listings tracker. Strip before persisting
    // to listings.json so the static file doesn't balloon in size.
    all_listings: listings,
  };
}

// ── Public API ───────────────────────────────────────────────────

/** Fetch Black Pearl data for one knife type. Uses cache. */
export async function fetchBlackPearls(knifeId) {
  const cached = getCached(knifeId);
  if (cached) return cached;

  const apiKey = loadApiKey();
  if (!apiKey) throw new Error('Missing CSFLOAT_API_KEY in .env');

  const knife = KNIVES.find(k => k.id === knifeId);
  if (!knife) throw new Error(`Unknown knife id: ${knifeId}`);

  const raw = await fetchAllListings(knife.def_index, knife.paint_index, apiKey);
  const dbUrl = `https://csfloat.com/db?defIndex=${knife.def_index}&paintIndex=${knife.paint_index}`;
  const result = { knife_id: knifeId, knife_name: knife.name, csfloat_db_url: dbUrl, ...transformListings(raw) };

  setCache(knifeId, result);

  // Record price snapshot for history tracking
  try { recordSnapshot(knifeId, result); } catch (e) {
    console.error(`[History] Failed to record ${knifeId}:`, e.message);
  }

  return result;
}

/** Fetch all knife types in parallel (capped concurrency). */
export async function fetchAllBlackPearls() {
  const CONCURRENCY = 3;
  const results = [];

  for (let i = 0; i < KNIVES.length; i += CONCURRENCY) {
    const batch = KNIVES.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(k => fetchBlackPearls(k.id).catch(err => ({
        knife_id: k.id,
        knife_name: k.name,
        csfloat_db_url: `https://csfloat.com/db?defIndex=${k.def_index}&paintIndex=${k.paint_index}`,
        count: 0,
        floor_prices: {},
        float_min: null,
        float_max: null,
        listings: [],
        error: err.message,
      })))
    );
    results.push(...batchResults);
    // Brief pause between batches
    if (i + CONCURRENCY < KNIVES.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return results;
}
