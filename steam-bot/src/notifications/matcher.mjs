import db from '../data/database.mjs';
import { enqueueMessage } from '../bot/message-sender.mjs';
import { formatNewListing, formatSnipeAlert } from './formatter.mjs';
import { detectSnipe } from './snipe-detector.mjs';
import { createLogger } from '../utils/logger.mjs';

const log = createLogger('matcher');

/**
 * Process an array of new listings from the tracker.
 * Each entry has: { fp, knife_id, knife_name, listing, created_at }
 */
export function processNewListings(newListings) {
  for (const entry of newListings) {
    try {
      matchAndNotify(entry);
    } catch (err) {
      log.error('Error processing listing', { fp: entry.fp, error: err.message });
    }
  }
}

/**
 * Match a single new listing against all active subscriptions.
 */
function matchAndNotify(entry) {
  const { fp, knife_id, knife_name, listing } = entry;

  // Get all active subscriptions that could match this knife
  const subs = db.getActiveSubscriptionsForKnife(knife_id);

  if (subs.length === 0) return;

  // Check if this is a snipe
  const snipeInfo = detectSnipe(listing, knife_id);

  for (const sub of subs) {
    // Check if already sent to this user
    const userId = sub.user_id;
    if (db.wasAlreadySent(userId, fp)) continue;

    // Apply filters
    if (!matchesSubscription(listing, sub)) continue;

    // Build the message
    let message;
    let priority = 1; // normal

    if (snipeInfo.isSnipe && sub.snipe_alerts) {
      message = formatSnipeAlert(listing, knife_id, knife_name, sub.persona_name, snipeInfo.floorPrice);
      priority = 0; // highest
    } else {
      message = formatNewListing(listing, knife_id, knife_name, sub.persona_name);
    }

    // Insert notification record
    const notifId = db.insertNotification({
      user_id: userId,
      subscription_id: sub.id,
      listing_fp: fp,
      knife_id: knife_id,
      message_text: message,
      delivery_status: 'pending',
    });

    // Route based on frequency
    if (sub.frequency === 'instant') {
      enqueueMessage(sub.steam_id, message, notifId, priority);
    } else {
      // Buffer for digest
      db.insertDigestItem({
        user_id: userId,
        subscription_id: sub.id,
        listing_fp: fp,
        knife_id: knife_id,
        message_text: message,
      });
      // Mark the notification as sent (it's in the digest buffer now)
      db.updateNotificationStatus(notifId, 'buffered');
    }

    log.info('Subscription matched', {
      userId,
      steamId: sub.steam_id,
      subId: sub.id,
      knifeId: knife_id,
      frequency: sub.frequency,
      isSnipe: snipeInfo.isSnipe && sub.snipe_alerts,
    });
  }
}

/**
 * Check if a listing matches a subscription's filter criteria.
 */
function matchesSubscription(listing, sub) {
  // Float range
  if (sub.float_min !== null && listing.float_value < sub.float_min) return false;
  if (sub.float_max !== null && listing.float_value > sub.float_max) return false;

  // Price range
  if (sub.price_min !== null && listing.price < sub.price_min) return false;
  if (sub.price_max !== null && listing.price > sub.price_max) return false;

  // Paint seed (exact match)
  if (sub.paint_seed !== null && listing.paint_seed !== sub.paint_seed) return false;

  // StatTrak filter
  if (sub.stattrak_only && !listing.stattrak) return false;

  return true;
}
