import db from '../data/database.mjs';
import { enqueueMessage } from '../bot/message-sender.mjs';
import { formatPriceDrop } from './formatter.mjs';
import { createLogger } from '../utils/logger.mjs';

const log = createLogger('price-drop');

/**
 * Check for price drops across all listings.
 * Called when new listings data is loaded.
 * @param {Array} allKnives - The full listings.json data (array of knife objects)
 */
export function checkPriceDrops(allKnives) {
  let dropsFound = 0;

  for (const knife of allKnives) {
    const knifeId = knife.knife_id;
    const knifeName = knife.knife_name;

    if (!knife.listings) continue;

    for (const listing of knife.listings) {
      const fp = buildFp(knifeId, listing);

      // Check cached price
      const cached = db.getPriceCacheEntry(fp);

      if (cached) {
        const oldPrice = cached.current_price;
        const newPrice = listing.price;

        // Update the cache with the new price
        db.upsertPriceCache(fp, knifeId, newPrice);

        // Skip if price didn't drop
        if (newPrice >= oldPrice) continue;

        const dropPct = ((oldPrice - newPrice) / oldPrice) * 100;

        // Find subscriptions that want price drop alerts for this knife
        const subs = db.getActiveSubscriptionsForKnife(knifeId);
        for (const sub of subs) {
          if (!sub.price_drop_pct) continue;
          if (dropPct < sub.price_drop_pct) continue;
          if (!sub.is_friend) continue;

          // Check filters match
          if (!matchesFilters(listing, sub)) continue;

          // Check if already notified about this specific price drop
          const dropFp = `${fp}:drop:${oldPrice}:${newPrice}`;
          if (db.wasAlreadySent(sub.user_id, dropFp)) continue;

          const message = formatPriceDrop(listing, knifeId, knifeName, sub.persona_name, oldPrice, newPrice);

          const notifId = db.insertNotification({
            user_id: sub.user_id,
            subscription_id: sub.id,
            listing_fp: dropFp,
            knife_id: knifeId,
            message_text: message,
            delivery_status: 'pending',
          });

          enqueueMessage(sub.steam_id, message, notifId, 1);
          dropsFound++;

          log.info('Price drop notification queued', {
            knifeId,
            fp,
            oldPrice,
            newPrice,
            dropPct: dropPct.toFixed(1),
            userId: sub.user_id,
          });
        }
      } else {
        // First time seeing this listing — just cache it
        db.upsertPriceCache(fp, knifeId, listing.price);
      }
    }
  }

  if (dropsFound > 0) {
    log.info(`Price drop check complete`, { dropsFound });
  }
}

/**
 * Build a fingerprint matching the main site's tracker format.
 */
function buildFp(knifeId, listing) {
  return [
    knifeId,
    listing.paint_seed ?? 'x',
    listing.float_value ?? 'x',
    listing.stattrak ? 'st' : 'n',
  ].join('|');
}

/**
 * Check if a listing matches a subscription's basic filters.
 */
function matchesFilters(listing, sub) {
  if (sub.float_min !== null && listing.float_value < sub.float_min) return false;
  if (sub.float_max !== null && listing.float_value > sub.float_max) return false;
  if (sub.price_min !== null && listing.price < sub.price_min) return false;
  if (sub.price_max !== null && listing.price > sub.price_max) return false;
  if (sub.paint_seed !== null && listing.paint_seed !== sub.paint_seed) return false;
  if (sub.stattrak_only && !listing.stattrak) return false;
  return true;
}
