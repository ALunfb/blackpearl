import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

function env(key, fallback) {
  const v = process.env[key];
  if (v === undefined && fallback === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v ?? fallback;
}

// ── Steam credentials ────────────────────────────
export const STEAM_USERNAME       = env('STEAM_USERNAME');
export const STEAM_PASSWORD       = env('STEAM_PASSWORD');
export const STEAM_SHARED_SECRET  = env('STEAM_SHARED_SECRET');
export const STEAM_IDENTITY_SECRET = env('STEAM_IDENTITY_SECRET');
export const STEAM_API_KEY        = env('STEAM_API_KEY');

// ── Web server ───────────────────────────────────
export const BOT_WEB_PORT    = parseInt(env('BOT_WEB_PORT', '3001'), 10);
export const BOT_WEB_URL     = env('BOT_WEB_URL', 'http://localhost:3001');
export const SESSION_SECRET  = env('SESSION_SECRET');

// ── Data paths ───────────────────────────────────
export const TRACKER_FILE_PATH = resolve(__dirname, '..', env('TRACKER_FILE_PATH', '../data/listings-tracker.json'));
export const LISTINGS_FILE_PATH = resolve(__dirname, '..', env('LISTINGS_FILE_PATH', '../data/listings.json'));
export const DB_PATH           = resolve(__dirname, '..', env('DB_PATH', './data/bot.sqlite'));

// ── Bot behavior ─────────────────────────────────
export const MAX_FRIENDS             = parseInt(env('MAX_FRIENDS', '250'), 10);
export const QUIET_HOUR_START        = parseInt(env('QUIET_HOUR_START', '2'), 10);
export const QUIET_HOUR_END          = parseInt(env('QUIET_HOUR_END', '6'), 10);
export const MAX_MESSAGES_PER_HOUR   = parseInt(env('MAX_MESSAGES_PER_HOUR', '60'), 10);
export const MAX_MESSAGES_PER_DAY    = parseInt(env('MAX_MESSAGES_PER_DAY', '300'), 10);
export const PER_USER_COOLDOWN_MS    = parseInt(env('PER_USER_COOLDOWN_MINUTES', '1'), 10) * 60 * 1000;
export const SNIPE_THRESHOLD_PCT     = parseFloat(env('SNIPE_THRESHOLD_PCT', '15'));

// ── Timing (anti-ban) ────────────────────────────
export const FRIEND_ACCEPT_DELAY     = { min: 30_000, max: 120_000 };
export const WELCOME_MSG_DELAY       = { min: 60_000, max: 180_000 };
export const MESSAGE_GAP_DELAY       = { min: 8_000,  max: 30_000 };
export const ERROR_PAUSE_MS          = 30 * 60 * 1000;   // 30 min
export const RECONNECT_BASE_MS       = 30_000;
export const RECONNECT_MAX_MS        = 10 * 60 * 1000;   // 10 min

// ── Polling ──────────────────────────────────────
export const TRACKER_POLL_INTERVAL   = 60_000;  // 60s

// ── Knife definitions (mirrors csfloat.mjs) ──────
export const KNIVES = [
  { id: 'karambit',   name: 'Karambit',        defIndex: 507, paintIndex: 417 },
  { id: 'butterfly',  name: 'Butterfly Knife',  defIndex: 515, paintIndex: 617 },
  { id: 'm9',         name: 'M9 Bayonet',       defIndex: 508, paintIndex: 417 },
  { id: 'bayonet',    name: 'Bayonet',          defIndex: 500, paintIndex: 417 },
  { id: 'flip',       name: 'Flip Knife',       defIndex: 505, paintIndex: 417 },
  { id: 'gut',        name: 'Gut Knife',        defIndex: 506, paintIndex: 417 },
  { id: 'huntsman',   name: 'Huntsman Knife',   defIndex: 509, paintIndex: 417 },
  { id: 'bowie',      name: 'Bowie Knife',      defIndex: 514, paintIndex: 417 },
  { id: 'falchion',   name: 'Falchion Knife',   defIndex: 512, paintIndex: 417 },
  { id: 'stiletto',   name: 'Stiletto Knife',   defIndex: 522, paintIndex: 417 },
  { id: 'talon',      name: 'Talon Knife',      defIndex: 523, paintIndex: 417 },
  { id: 'skeleton',   name: 'Skeleton Knife',   defIndex: 525, paintIndex: 417 },
  { id: 'navaja',     name: 'Navaja Knife',     defIndex: 520, paintIndex: 417 },
  { id: 'ursus',      name: 'Ursus Knife',      defIndex: 519, paintIndex: 417 },
  { id: 'shadow',     name: 'Shadow Daggers',   defIndex: 516, paintIndex: 617 },
  { id: 'paracord',   name: 'Paracord Knife',   defIndex: 517, paintIndex: 417 },
  { id: 'survival',   name: 'Survival Knife',   defIndex: 518, paintIndex: 417 },
  { id: 'nomad',      name: 'Nomad Knife',      defIndex: 521, paintIndex: 417 },
];

export const KNIFE_MAP = Object.fromEntries(KNIVES.map(k => [k.id, k]));
