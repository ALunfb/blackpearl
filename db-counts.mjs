import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COUNTS_FILE = path.join(__dirname, 'data', 'db-counts.json');

let _cached = null;

function load() {
  try {
    return JSON.parse(fs.readFileSync(COUNTS_FILE, 'utf8'));
  } catch {
    return { updated_at: null, counts: {}, previous: {} };
  }
}

function save(data) {
  fs.writeFileSync(COUNTS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Get the current counts, previous counts, deltas, and update date.
 * On first call each server start, checks if counts changed since last run
 * and rotates current→previous if they did.
 */
export function getDbCounts() {
  if (_cached) return _cached;

  const data = load();
  const counts = data.counts || {};
  const previous = data.previous || {};

  // Check if counts changed from previous (user updated the file)
  const changed = Object.keys(counts).some(k => counts[k] !== previous[k]);

  // If this is a fresh file with no previous, or counts match previous, just serve as-is
  const deltas = {};
  for (const [id, count] of Object.entries(counts)) {
    const prev = previous[id] ?? 0;
    deltas[id] = count - prev;
  }

  const total = Object.values(counts).reduce((s, c) => s + c, 0);
  const totalPrev = Object.values(previous).reduce((s, c) => s + c, 0);

  _cached = {
    updated_at: data.updated_at,
    counts,
    previous,
    deltas,
    total,
    total_delta: total - totalPrev,
  };

  return _cached;
}

/**
 * Update counts with new values. Shifts current→previous automatically.
 * Call this when you want to programmatically update (or use the JSON file directly).
 */
export function updateDbCounts(newCounts) {
  const data = load();
  data.previous = { ...data.counts };
  data.counts = newCounts;
  data.updated_at = new Date().toISOString().split('T')[0];
  save(data);
  _cached = null; // bust cache
  return getDbCounts();
}
