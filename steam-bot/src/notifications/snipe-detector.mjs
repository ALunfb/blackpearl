import fs from 'fs';
import { LISTINGS_FILE_PATH, SNIPE_THRESHOLD_PCT } from '../config.mjs';
import { createLogger } from '../utils/logger.mjs';

const log = createLogger('snipe');

/**
 * Cache of floor prices per knife+wear.
 * Structure: { 'karambit:FN': 8500, ... }
 */
let floorPriceCache = {};
let cacheUpdatedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function wearFromFloat(f) {
  if (f <= 0.07) return 'FN';
  if (f <= 0.15) return 'MW';
  if (f <= 0.38) return 'FT';
  if (f <= 0.45) return 'WW';
  return 'BS';
}

/**
 * Refresh the floor price cache from listings.json.
 */
function refreshFloorPrices() {
  const now = Date.now();
  if (now - cacheUpdatedAt < CACHE_TTL) return;

  try {
    const raw = JSON.parse(fs.readFileSync(LISTINGS_FILE_PATH, 'utf8'));
    const data = Array.isArray(raw) ? raw : raw.knives;
    if (!data) { log.warn('No knives array in listings data'); return; }
    const newCache = {};

    for (const knife of data) {
      const knifeId = knife.knife_id;
      // Use the floor_prices from the data if available
      if (knife.floor_prices) {
        for (const [wear, price] of Object.entries(knife.floor_prices)) {
          if (price !== null) {
            newCache[`${knifeId}:${wear}`] = price;
          }
        }
      }
      // Also compute from listings as a fallback
      if (knife.listings) {
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
    cacheUpdatedAt = now;
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
      knifeId,
      wear,
      listingPrice: listing.price,
      floorPrice,
      pctBelow: pctBelow.toFixed(1),
    });
    return { isSnipe: true, floorPrice, pctBelow };
  }

  return { isSnipe: false, floorPrice, pctBelow };
}
