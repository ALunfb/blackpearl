import fs from 'fs';
import { LISTINGS_FILE_PATH, SNIPE_THRESHOLD_PCT } from '../config.mjs';
import { createLogger } from '../utils/logger.mjs';

const log = createLogger('snipe');

/**
 * Cache of floor prices per knife+wear.
 * Structure: { 'karambit:FN': 8500, ... }
 */
let floorPriceCache = {};
let cacheMtimeMs = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let lastCacheCheck = 0;

function wearFromFloat(f) {
  if (f <= 0.07) return 'FN';
  if (f <= 0.15) return 'MW';
  if (f <= 0.38) return 'FT';
  if (f <= 0.45) return 'WW';
  return 'BS';
}

/**
 * Refresh the floor price cache from listings.json.
 * Only re-parses if the file has been modified since the last load.
 */
function refreshFloorPrices() {
  const now = Date.now();
  // Don't even stat the file more than once per TTL window
  if (now - lastCacheCheck < CACHE_TTL) return;
  lastCacheCheck = now;

  let stat;
  try {
    stat = fs.statSync(LISTINGS_FILE_PATH);
  } catch (err) {
    log.error('Listings file not accessible', { error: err.message });
    return;
  }

  // No change since last load
  if (stat.mtimeMs === cacheMtimeMs) return;

  try {
    const raw = JSON.parse(fs.readFileSync(LISTINGS_FILE_PATH, 'utf8'));
    const data = Array.isArray(raw) ? raw : raw.knives;
    if (!Array.isArray(data)) {
      log.warn('Listings data has no knives array');
      return;
    }

    const newCache = {};
    for (const knife of data) {
      const knifeId = knife.knife_id;
      if (knife.floor_prices) {
        for (const [wear, price] of Object.entries(knife.floor_prices)) {
          if (price !== null && price !== undefined) {
            newCache[`${knifeId}:${wear}`] = price;
          }
        }
      }
      if (Array.isArray(knife.listings)) {
        for (const listing of knife.listings) {
          const wear = listing.wear || wearFromFloat(listing.float_value);
          const key = `${knifeId}:${wear}`;
          if (!(key in newCache) || listing.price < newCache[key]) {
            newCache[key] = listing.price;
          }
        }
      }
    }

    floorPriceCache = newCache;
    cacheMtimeMs = stat.mtimeMs;
    log.debug('Floor prices refreshed', { entries: Object.keys(newCache).length });
  } catch (err) {
    log.error('Failed to refresh floor prices', { error: err.message });
  }
}

/**
 * Check if a listing qualifies as a snipe opportunity.
 * @param {object} listing - The listing object
 * @param {string} knifeId - e.g. 'karambit'
 * @returns {{ isSnipe: boolean, floorPrice: number|null, pctBelow: number|null }}
 */
export function detectSnipe(listing, knifeId) {
  refreshFloorPrices();

  const wear = listing.wear || wearFromFloat(listing.float_value);
  const key = `${knifeId}:${wear}`;
  const floorPrice = floorPriceCache[key];

  if (!floorPrice || floorPrice <= 0) {
    return { isSnipe: false, floorPrice: null, pctBelow: null };
  }

  const pctBelow = ((floorPrice - listing.price) / floorPrice) * 100;

  if (pctBelow >= SNIPE_THRESHOLD_PCT) {
    log.info('Snipe detected!', {
      knifeId, wear, listingPrice: listing.price, floorPrice,
      pctBelow: pctBelow.toFixed(1),
    });
    return { isSnipe: true, floorPrice, pctBelow };
  }

  return { isSnipe: false, floorPrice, pctBelow };
}
