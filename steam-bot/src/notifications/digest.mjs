import db from '../data/database.mjs';
import { enqueueMessage } from '../bot/message-sender.mjs';
import { formatDigest } from './formatter.mjs';
import { createLogger } from '../utils/logger.mjs';

const log = createLogger('digest');

let hourlyTimer = null;
let dailyTimer = null;

/**
 * Start the digest timers.
 */
function start() {
  // Run hourly digest at the top of each hour
  scheduleHourly();
  // Run daily digest at 18:00 UTC (reasonable time for most regions)
  scheduleDaily();
  log.info('Digest system started');
}

function stop() {
  if (hourlyTimer) { clearTimeout(hourlyTimer); hourlyTimer = null; }
  if (dailyTimer) { clearTimeout(dailyTimer); dailyTimer = null; }
  log.info('Digest system stopped');
}

/**
 * Schedule the next hourly digest run.
 */
function scheduleHourly() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  const delay = next - now;

  hourlyTimer = setTimeout(() => {
    processDigest('hourly');
    scheduleHourly(); // reschedule
  }, delay);

  log.debug(`Next hourly digest in ${Math.round(delay / 1000)}s`);
}

/**
 * Schedule the next daily digest run (18:00 UTC).
 */
function scheduleDaily() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(18, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next - now;

  dailyTimer = setTimeout(() => {
    processDigest('daily');
    scheduleDaily(); // reschedule
  }, delay);

  log.debug(`Next daily digest in ${Math.round(delay / 60000)}min`);
}

/**
 * Process digest items for all users with the given frequency.
 */
function processDigest(frequency) {
  log.info(`Processing ${frequency} digest`);

  // Get all users who have subscriptions with this frequency
  const rows = db.raw.prepare(`
    SELECT DISTINCT u.id as user_id, u.steam_id, u.persona_name, u.is_friend
    FROM users u
    JOIN subscriptions s ON s.user_id = u.id
    WHERE s.frequency = ? AND s.is_active = 1 AND u.is_friend = 1
  `).all(frequency);

  let sent = 0;

  for (const user of rows) {
    const items = db.getDigestItems(user.user_id);
    if (items.length === 0) continue;

    const message = formatDigest(items, user.persona_name);

    const notifId = db.insertNotification({
      user_id: user.user_id,
      subscription_id: null,
      listing_fp: `digest:${frequency}:${Date.now()}`,
      knife_id: 'digest',
      message_text: message,
      delivery_status: 'pending',
    });

    enqueueMessage(user.steam_id, message, notifId, 2); // priority 2 = low (digest)
    db.clearDigestItems(user.user_id);
    sent++;
  }

  if (sent > 0) {
    log.info(`${frequency} digest sent to ${sent} users`);
  }
}

export default { start, stop };
