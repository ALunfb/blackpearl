import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACKER_FILE = path.join(__dirname, 'data', 'listings-tracker.json');

const MAX_NEW = 100;
const MAX_SOLD = 100;
const MAX_SEEN_EVER = 5000;

/**
 * Build a fingerprint that survives unlist/relist cycles.
 * paint_seed + float_value + stattrak uniquely identify a Steam item instance,
 * and the knife type pins it to the right def_index. The CSFloat listing `id`
 * changes every time a seller delists and relists, so we can't use that.
 */
function fingerprint(knifeId, listing) {
  return [
    knifeId,
    listing.paint_seed ?? 'x',
    listing.float_value ?? 'x',
    listing.stattrak ? 'st' : 'n',
  ].join('|');
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(TRACKER_FILE, 'utf8'));
    return {
      active: raw.active || {},
      new_listings: raw.new_listings || [],
      sold: raw.sold || [],
      seen_ever: raw.seen_ever || {},
    };
  } catch {
    return { active: {}, new_listings: [], sold: [], seen_ever: {} };
  }
}

function saveState(state) {
  const out = {
    updated_at: new Date().toISOString(),
    new_listings: state.new_listings,
    sold: state.sold,
    active: state.active,
    seen_ever: state.seen_ever,
  };
  fs.writeFileSync(TRACKER_FILE, JSON.stringify(out, null, 2));
}

/**
 * Reconcile current listings against tracker state.
 *
 * `allKnivesData` is the array of per-knife results, each containing the
 * full listings array (not just the top-20 we save to listings.json).
 *
 *  - Items not previously seen → push onto the new_listings feed (capped at 20)
 *  - Items that vanished from the active set → moved to sold list
 *  - Items that reappear after being marked sold → removed from sold (it was
 *    just an unlist/relist, not a real sale)
 */
export function recordTrackerUpdate(allKnivesData) {
  const state = loadState();
  const now = new Date().toISOString();

  // Bootstrap detection: if we have never seen any fingerprint before, this is
  // the first run. Seed seen_ever/active with everything that's currently
  // listed but do NOT push any of it to new_listings — those items are not
  // actually new, they're just the baseline. Only subsequent runs should emit
  // newly-appeared listings into the feed.
  const isBootstrap = Object.keys(state.seen_ever).length === 0;

  // Build map of currently visible items across all knives
  const currentlyListed = new Map(); // fp -> { knife_id, knife_name, listing }
  for (const knife of allKnivesData) {
    const list = knife.all_listings || knife.listings || [];
    for (const l of list) {
      const fp = fingerprint(knife.knife_id, l);
      // If a fingerprint somehow appears twice in one fetch, keep the first
      if (!currentlyListed.has(fp)) {
        currentlyListed.set(fp, {
          knife_id: knife.knife_id,
          knife_name: knife.knife_name,
          listing: l,
        });
      }
    }
  }

  // ── 1. Detect SOLD: anything in active that's no longer listed ──
  for (const [fp, entry] of Object.entries(state.active)) {
    if (!currentlyListed.has(fp)) {
      // Remove from active
      delete state.active[fp];
      // Add to sold (most recent first)
      state.sold.unshift({
        fp,
        knife_id: entry.knife_id,
        knife_name: entry.knife_name,
        listing: entry.listing,
        first_seen: entry.first_seen,
        sold_at: now,
      });
    }
  }
  // Cap sold list
  if (state.sold.length > MAX_SOLD) state.sold = state.sold.slice(0, MAX_SOLD);

  // ── 2. Process current listings ──
  const newlyAdded = [];
  for (const [fp, entry] of currentlyListed) {
    // If this item is in the sold list, it's an unlist→relist; remove from sold
    const soldIdx = state.sold.findIndex(s => s.fp === fp);
    if (soldIdx !== -1) {
      state.sold.splice(soldIdx, 1);
    }

    if (state.active[fp]) {
      // Already tracked — just refresh listing snapshot + last_seen
      state.active[fp].last_seen = now;
      state.active[fp].listing = entry.listing;
    } else {
      // First time entering active set
      const firstSeen = state.seen_ever[fp] || now;
      state.active[fp] = {
        knife_id: entry.knife_id,
        knife_name: entry.knife_name,
        listing: entry.listing,
        first_seen: firstSeen,
        last_seen: now,
      };

      // Only push to "new listings" feed if this is the first time we've EVER
      // seen this fingerprint. Relisted items are not "new". On a bootstrap
      // run we seed seen_ever silently so these baseline items never get
      // mistaken for fresh listings.
      if (!state.seen_ever[fp]) {
        state.seen_ever[fp] = now;
        if (!isBootstrap) {
          newlyAdded.push({
            fp,
            knife_id: entry.knife_id,
            knife_name: entry.knife_name,
            listing: entry.listing,
            created_at: now,
          });
        }
      }
    }
  }

  // ── 3. Merge newly added into the feed (most recent first), cap at 20 ──
  if (newlyAdded.length > 0) {
    // Newest within this batch first (preserve order they came from API,
    // which is sorted by lowest_price — that's not chronological, but it's
    // the only ordering we have, so just prepend in iteration order).
    state.new_listings = [...newlyAdded, ...state.new_listings].slice(0, MAX_NEW);
  }

  // ── 4. Trim seen_ever if it grows too large (keep most recent) ──
  const seenEntries = Object.entries(state.seen_ever);
  if (seenEntries.length > MAX_SEEN_EVER) {
    seenEntries.sort((a, b) => (b[1] > a[1] ? 1 : -1));
    state.seen_ever = Object.fromEntries(seenEntries.slice(0, MAX_SEEN_EVER));
  }

  saveState(state);
  console.log(
    `[Tracker] ${isBootstrap ? 'BOOTSTRAP ' : ''}+${newlyAdded.length} new, ` +
    `${Object.keys(state.active).length} active, ` +
    `${state.sold.length} sold tracked`
  );
}
