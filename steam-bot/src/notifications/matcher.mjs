import db from '../data/database.mjs';
import { enqueueMessage } from '../bot/message-sender.mjs';
import { formatNewListing, formatSnipeAlert, formatBatch } from './formatter.mjs';
import { detectSnipe } from './snipe-detector.mjs';
import { rarityScore } from '../utils/rarity.mjs';
import { createLogger } from '../utils/logger.mjs';

const log = createLogger('matcher');

/**
 * Process an array of new listings from the tracker.
 * Each entry has: { fp, knife_id, knife_name, listing, created_at }
 *
 * Matches are grouped per user. Each user gets ONE message containing all
 * their matches from this update batch, instead of one message per listing.
 * Snipes are sent as separate priority messages since they need urgent attention.
 */
export function processNewListings(newListings) {
  // userId → { steamId, personaName, normalMatches: [], snipeMatches: [] }
  const userBatches = new Map();

  for (const entry of newListings) {
    try {
      collectMatches(entry, userBatches);
    } catch (err) {
      log.error('Error processing listing', { fp: entry.fp, error: err.message });
    }
  }

  // Now flush each user's batch
  for (const [userId, batch] of userBatches) {
    flushUserBatch(userId, batch);
  }
}

/**
 * Collect subscription matches for a single listing into per-user batches.
 */
function collectMatches(entry, userBatches) {
  const { fp, knife_id, knife_name, listing } = entry;

  const subs = db.getActiveSubscriptionsForKnife(knife_id);
  if (subs.length === 0) return;

  const snipeInfo = detectSnipe(listing, knife_id);

  for (const sub of subs) {
    const userId = sub.user_id;
    if (db.wasAlreadySent(userId, fp)) continue;
    if (!matchesSubscription(listing, sub)) continue;

    // Ensure batch exists
    if (!userBatches.has(userId)) {
      userBatches.set(userId, {
        steamId: sub.steam_id,
        personaName: sub.persona_name,
        frequency: sub.frequency,
        normalMatches: [],
        snipeMatches: [],
      });
    }
    const batch = userBatches.get(userId);

    const matchItem = { entry, sub, snipeInfo };
    if (snipeInfo.isSnipe && sub.snipe_alerts) {
      batch.snipeMatches.push(matchItem);
    } else {
      batch.normalMatches.push(matchItem);
    }
  }
}

/**
 * Send each user's matches.
 * - Snipes go out as individual priority messages (urgent)
 * - Normal matches get batched into a single message (or single if just one)
 */
function flushUserBatch(userId, batch) {
  const { steamId, personaName, frequency, normalMatches, snipeMatches } = batch;

  // Snipes: one message per snipe (priority)
  for (const { entry, sub, snipeInfo } of snipeMatches) {
    const message = formatSnipeAlert(entry.listing, entry.knife_id, entry.knife_name, personaName, snipeInfo.floorPrice);
    const notifId = db.insertNotification({
      user_id: userId,
      subscription_id: sub.id,
      listing_fp: entry.fp,
      knife_id: entry.knife_id,
      message_text: message,
      delivery_status: 'pending',
    });
    if (frequency === 'instant') {
      enqueueMessage(steamId, message, notifId, 0); // priority 0 = snipe
    } else {
      db.insertDigestItem({
        user_id: userId,
        subscription_id: sub.id,
        listing_fp: entry.fp,
        knife_id: entry.knife_id,
        message_text: message,
      });
      db.updateNotificationStatus(notifId, 'buffered');
    }
  }

  // Normal matches: batch into one message
  if (normalMatches.length === 0) return;

  if (normalMatches.length === 1) {
    // Single match — send as normal
    const { entry, sub } = normalMatches[0];
    const message = formatNewListing(entry.listing, entry.knife_id, entry.knife_name, personaName);
    const notifId = db.insertNotification({
      user_id: userId,
      subscription_id: sub.id,
      listing_fp: entry.fp,
      knife_id: entry.knife_id,
      message_text: message,
      delivery_status: 'pending',
    });
    if (frequency === 'instant') {
      enqueueMessage(steamId, message, notifId, 1);
    } else {
      db.insertDigestItem({
        user_id: userId,
        subscription_id: sub.id,
        listing_fp: entry.fp,
        knife_id: entry.knife_id,
        message_text: message,
      });
      db.updateNotificationStatus(notifId, 'buffered');
    }
    log.info('Single match sent', { userId, knifeId: entry.knife_id });
    return;
  }

  // Multiple matches — batch them
  const message = formatBatch(normalMatches.map(m => m.entry), personaName);
  const combinedFp = 'batch:' + normalMatches.map(m => m.entry.fp).join(',').slice(0, 200);

  const notifId = db.insertNotification({
    user_id: userId,
    subscription_id: null,
    listing_fp: combinedFp,
    knife_id: 'batch',
    message_text: message,
    delivery_status: 'pending',
  });

  // Record each individual fp as sent so they don't get sent again
  for (const { entry, sub } of normalMatches) {
    db.insertNotification({
      user_id: userId,
      subscription_id: sub.id,
      listing_fp: entry.fp,
      knife_id: entry.knife_id,
      message_text: '(part of batch)',
      delivery_status: 'sent',
    });
  }

  if (frequency === 'instant') {
    enqueueMessage(steamId, message, notifId, 1);
  } else {
    db.insertDigestItem({
      user_id: userId,
      subscription_id: null,
      listing_fp: combinedFp,
      knife_id: 'batch',
      message_text: message,
    });
    db.updateNotificationStatus(notifId, 'buffered');
  }

  log.info('Batch sent', { userId, count: normalMatches.length, knives: [...new Set(normalMatches.map(m => m.entry.knife_id))] });
}

/**
 * Check if a listing matches a subscription's filter criteria.
 */
function matchesSubscription(listing, sub) {
  if (sub.float_min !== null && listing.float_value < sub.float_min) return false;
  if (sub.float_max !== null && listing.float_value > sub.float_max) return false;
  if (sub.price_min !== null && listing.price < sub.price_min) return false;
  if (sub.price_max !== null && listing.price > sub.price_max) return false;
  if (sub.paint_seed !== null && listing.paint_seed !== sub.paint_seed) return false;
  if (sub.stattrak_only && !listing.stattrak) return false;
  if (sub.min_rarity_score != null) {
    const { score } = rarityScore(listing);
    if (score < sub.min_rarity_score) return false;
  }
  return true;
}
