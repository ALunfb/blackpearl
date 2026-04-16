import fs from 'fs';
import { TRACKER_FILE_PATH, LISTINGS_FILE_PATH, TRACKER_POLL_INTERVAL } from '../config.mjs';
import { createLogger } from '../utils/logger.mjs';
import { processNewListings } from './matcher.mjs';
import { checkPriceDrops } from './price-drop.mjs';

const log = createLogger('watcher');

let lastUpdatedAt = null;
let pollTimer = null;

/**
 * Read and parse a JSON file safely.
 */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    log.error(`Failed to read ${filePath}`, { error: err.message });
    return null;
  }
}

/**
 * Poll the tracker file for changes.
 */
function poll() {
  const tracker = readJson(TRACKER_FILE_PATH);
  if (!tracker) return;

  const updatedAt = tracker.updated_at;

  // Skip if we've already processed this update
  if (updatedAt === lastUpdatedAt) return;

  // On first run, just set the timestamp (don't process historical data)
  if (lastUpdatedAt === null) {
    lastUpdatedAt = updatedAt;
    log.info('Initial tracker state loaded', { updatedAt, newListings: tracker.new_listings?.length || 0 });
    return;
  }

  lastUpdatedAt = updatedAt;
  log.info('Tracker updated', { updatedAt });

  // Process new listings
  const newListings = tracker.new_listings || [];
  if (newListings.length > 0) {
    log.info(`Processing ${newListings.length} listings from tracker`);
    processNewListings(newListings);
  }

  // Check for price drops using the full listings data
  const listings = readJson(LISTINGS_FILE_PATH);
  if (listings) {
    checkPriceDrops(listings);
  }
}

/**
 * Start the polling loop.
 */
function start() {
  log.info('Starting listing watcher', { interval: `${TRACKER_POLL_INTERVAL / 1000}s`, path: TRACKER_FILE_PATH });

  // Verify the file exists
  if (!fs.existsSync(TRACKER_FILE_PATH)) {
    log.error('Tracker file not found! Watcher will retry on each poll.', { path: TRACKER_FILE_PATH });
  }

  // Initial poll
  poll();

  // Set up the interval
  pollTimer = setInterval(poll, TRACKER_POLL_INTERVAL);
}

/**
 * Stop the polling loop.
 */
function stop() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  log.info('Listing watcher stopped');
}

export default { start, stop };
