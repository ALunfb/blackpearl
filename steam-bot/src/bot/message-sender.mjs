import steamClient from './steam-client.mjs';
import db from '../data/database.mjs';
import { RateLimiter } from '../utils/rate-limiter.mjs';
import { randomDelay, sleep } from '../utils/delay.mjs';
import { createLogger } from '../utils/logger.mjs';
import {
  MAX_MESSAGES_PER_HOUR, MAX_MESSAGES_PER_DAY,
  PER_USER_COOLDOWN_MS, MESSAGE_GAP_DELAY,
  QUIET_HOUR_START, QUIET_HOUR_END, ERROR_PAUSE_MS,
} from '../config.mjs';

const log = createLogger('msg-sender');

// Rate limiters
const hourlyLimiter = new RateLimiter(60 * 60 * 1000, MAX_MESSAGES_PER_HOUR);
const dailyLimiter  = new RateLimiter(24 * 60 * 60 * 1000, MAX_MESSAGES_PER_DAY);
const perUserLimiter = new RateLimiter(PER_USER_COOLDOWN_MS, 1);

/**
 * Message queue with priority support.
 * Priority: 0 = highest (snipe), 1 = normal (instant), 2 = low (digest)
 * @type {{ steamId: string, message: string, notifId: number, priority: number }[]}
 */
const queue = [];

let processing = false;
let paused = false;
let pauseUntil = 0;

/**
 * Enqueue a message to be sent.
 */
export function enqueueMessage(steamId, message, notifId, priority = 1) {
  queue.push({ steamId, message, notifId, priority });
  // Sort by priority (lower = higher priority)
  queue.sort((a, b) => a.priority - b.priority);

  log.info('Message enqueued', { steamId, notifId, priority, queueSize: queue.length });

  if (!processing) {
    processQueue();
  }
}

/**
 * Check if we're in quiet hours (UTC).
 */
function isQuietHours() {
  if (QUIET_HOUR_START === QUIET_HOUR_END) return false; // disabled
  const hour = new Date().getUTCHours();
  if (QUIET_HOUR_START < QUIET_HOUR_END) {
    return hour >= QUIET_HOUR_START && hour < QUIET_HOUR_END;
  }
  // Wraps midnight (e.g., 22-6)
  return hour >= QUIET_HOUR_START || hour < QUIET_HOUR_END;
}

/**
 * Main queue processing loop.
 */
async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    // Check pause (from error backoff)
    if (paused && Date.now() < pauseUntil) {
      const waitMs = pauseUntil - Date.now();
      log.info(`Paused, waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      paused = false;
    }

    // Check quiet hours
    if (isQuietHours()) {
      log.info('Quiet hours — pausing queue processing');
      // Sleep until quiet hours end
      const now = new Date();
      const endHour = QUIET_HOUR_END;
      const target = new Date(now);
      target.setUTCHours(endHour, 0, 0, 0);
      if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
      await sleep(target - now);
      continue;
    }

    // Check if bot is connected
    if (!steamClient.isReady) {
      log.warn('Steam client not ready, waiting 30s');
      await sleep(30_000);
      continue;
    }

    const item = queue[0];

    // Check rate limits
    if (!hourlyLimiter.canProceed()) {
      const waitMs = hourlyLimiter.msUntilReady();
      log.info(`Hourly rate limit hit, waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs + 1000);
      continue;
    }

    if (!dailyLimiter.canProceed()) {
      const waitMs = dailyLimiter.msUntilReady();
      log.info(`Daily rate limit hit, waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs + 1000);
      continue;
    }

    if (!perUserLimiter.canProceed(item.steamId)) {
      const waitMs = perUserLimiter.msUntilReady(item.steamId);
      log.info(`Per-user cooldown for ${item.steamId}, waiting ${Math.round(waitMs / 1000)}s`);
      // Move this item to the back and try the next one
      queue.shift();
      queue.push(item);
      queue.sort((a, b) => a.priority - b.priority);
      await sleep(1000); // brief pause to prevent tight loop
      continue;
    }

    // Send the message — retry once on transient failure if Steam is still ready
    queue.shift();

    let success = steamClient.sendMessage(item.steamId, item.message);
    if (!success && steamClient.isReady) {
      await sleep(2000);
      success = steamClient.sendMessage(item.steamId, item.message);
    }

    if (success) {
      // Record in rate limiters
      hourlyLimiter.record();
      dailyLimiter.record();
      perUserLimiter.record(item.steamId);

      // Update notification status
      db.updateNotificationStatus(item.notifId, 'sent');
      log.info('Message sent', { steamId: item.steamId, notifId: item.notifId });
    } else {
      // Failed to send — could be Steam error
      db.updateNotificationStatus(item.notifId, 'failed');
      log.error('Message send failed', { steamId: item.steamId, notifId: item.notifId });

      // Pause on error (anti-ban)
      paused = true;
      pauseUntil = Date.now() + ERROR_PAUSE_MS;
      log.warn(`Pausing message sender for ${ERROR_PAUSE_MS / 1000}s due to error`);
    }

    // Random gap between messages (anti-ban)
    if (queue.length > 0) {
      await randomDelay(MESSAGE_GAP_DELAY);
    }
  }

  processing = false;
}

/**
 * Get the current queue size.
 */
export function getQueueSize() {
  return queue.length;
}

export default { enqueueMessage, getQueueSize };
