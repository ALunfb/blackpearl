import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.join(__dirname, 'data', 'price-history.json');

// Minimum interval between snapshots for the same knife (1 hour)
const MIN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Load the full history from disk.
 * Shape: { [knifeId]: [ { ts, count, floor_fn, floor_mw, floor_ft, avg, median, low, high } ] }
 */
export function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

/**
 * Record a price snapshot for one knife.
 * Called after each successful API fetch.
 */
export function recordSnapshot(knifeId, data) {
  const history = loadHistory();
  if (!history[knifeId]) history[knifeId] = [];

  const entries = history[knifeId];

  // Throttle: skip if last snapshot was less than MIN_INTERVAL ago
  if (entries.length > 0) {
    const lastTs = entries[entries.length - 1].ts;
    if (Date.now() - lastTs < MIN_INTERVAL_MS) return;
  }

  // Gather all prices from listings
  const prices = (data.listings || []).map(l => l.price).filter(p => p != null && p > 0);
  prices.sort((a, b) => a - b);

  const snapshot = {
    ts: Date.now(),
    count: data.count || 0,
    floor_fn: data.floor_prices?.FN ?? null,
    floor_mw: data.floor_prices?.MW ?? null,
    floor_ft: data.floor_prices?.FT ?? null,
    low: prices.length > 0 ? prices[0] : null,
    high: prices.length > 0 ? prices[prices.length - 1] : null,
    median: prices.length > 0 ? prices[Math.floor(prices.length / 2)] : null,
    avg: prices.length > 0 ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : null,
  };

  entries.push(snapshot);

  // Keep max 1 year of hourly data (~8760 entries)
  if (entries.length > 8760) {
    history[knifeId] = entries.slice(-8760);
  }

  saveHistory(history);
  console.log(`[History] Recorded snapshot for ${knifeId}: ${snapshot.count} listings, median $${snapshot.median}`);
}

/**
 * Record a market cap snapshot from all knife data.
 * Called after fetchAllBlackPearls completes.
 * dbCounts: { knifeId: totalInDatabase }
 */
export function recordMarketCap(allData, dbCounts) {
  const history = loadHistory();
  const key = '_market_cap';
  if (!history[key]) history[key] = [];

  const entries = history[key];
  if (entries.length > 0) {
    const lastTs = entries[entries.length - 1].ts;
    if (Date.now() - lastTs < MIN_INTERVAL_MS) return;
  }

  let totalListed = 0;
  let listedValue = 0;
  let marketCap = 0;

  for (const d of allData) {
    totalListed += d.count || 0;
    const dbCount = dbCounts[d.knife_id] || 0;

    // Listed value: floor price * listed count
    const floors = Object.values(d.floor_prices || {}).filter(p => p != null);
    if (floors.length > 0) {
      listedValue += Math.min(...floors) * (d.count || 0);
    }

    // Market cap: 25th percentile price * db count
    const prices = (d.listings || []).map(l => l.price).filter(p => p != null && p > 0);
    if (prices.length > 0) {
      prices.sort((a, b) => a - b);
      const idx = Math.floor(prices.length * 0.25);
      marketCap += prices[idx] * dbCount;
    } else if (floors.length > 0) {
      marketCap += Math.min(...floors) * dbCount;
    }
  }

  entries.push({
    ts: Date.now(),
    listed: totalListed,
    listed_value: Math.round(listedValue),
    market_cap: Math.round(marketCap),
  });

  if (entries.length > 8760) {
    history[key] = entries.slice(-8760);
  }

  saveHistory(history);
  console.log(`[History] Market cap: $${Math.round(marketCap).toLocaleString()} | Listed value: $${Math.round(listedValue).toLocaleString()}`);
}

/**
 * Get history for one knife or all knives.
 * Optionally filter by time range (days).
 */
export function getHistory(knifeId, days) {
  const history = loadHistory();
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;

  if (knifeId) {
    const entries = (history[knifeId] || []).filter(e => e.ts >= cutoff);
    return { [knifeId]: entries };
  }

  // All knives
  const result = {};
  for (const [id, entries] of Object.entries(history)) {
    result[id] = entries.filter(e => e.ts >= cutoff);
  }
  return result;
}
