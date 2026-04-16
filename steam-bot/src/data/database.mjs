import Database from 'better-sqlite3';
import fs from 'fs';
import { dirname } from 'path';
import { DB_PATH } from '../config.mjs';
import { createLogger } from '../utils/logger.mjs';

const log = createLogger('database');

// Ensure the directory exists
fs.mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for concurrent read/write safety
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema migration ─────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    steam_id      TEXT    UNIQUE NOT NULL,
    persona_name  TEXT,
    avatar_url    TEXT,
    is_friend     INTEGER DEFAULT 0,
    friend_since  TEXT,
    created_at    TEXT    DEFAULT (datetime('now')),
    last_seen_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    knife_id        TEXT    NOT NULL,
    float_min       REAL,
    float_max       REAL,
    price_min       REAL,
    price_max       REAL,
    paint_seed      INTEGER,
    stattrak_only   INTEGER DEFAULT 0,
    snipe_alerts    INTEGER DEFAULT 0,
    price_drop_pct  REAL,
    frequency       TEXT    DEFAULT 'instant',
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT    DEFAULT (datetime('now')),
    updated_at      TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
    listing_fp      TEXT    NOT NULL,
    knife_id        TEXT    NOT NULL,
    message_text    TEXT,
    sent_at         TEXT    DEFAULT (datetime('now')),
    delivery_status TEXT    DEFAULT 'pending'
  );

  CREATE TABLE IF NOT EXISTS price_cache (
    listing_fp    TEXT PRIMARY KEY,
    knife_id      TEXT NOT NULL,
    last_price    REAL,
    current_price REAL,
    updated_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS digest_buffer (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE CASCADE,
    listing_fp      TEXT NOT NULL,
    knife_id        TEXT NOT NULL,
    message_text    TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_subscriptions_user   ON subscriptions(user_id);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_knife  ON subscriptions(knife_id);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions(is_active);
  CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_sent   ON notifications(sent_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_fp     ON notifications(listing_fp);
  CREATE INDEX IF NOT EXISTS idx_digest_buffer_user   ON digest_buffer(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires     ON sessions(expires_at);
`);

log.info('Database initialized', { path: DB_PATH });

// ── Prepared statements ──────────────────────────

// Users
const _upsertUser = db.prepare(`
  INSERT INTO users (steam_id, persona_name, avatar_url)
  VALUES (@steam_id, @persona_name, @avatar_url)
  ON CONFLICT(steam_id) DO UPDATE SET
    persona_name = COALESCE(@persona_name, persona_name),
    avatar_url   = COALESCE(@avatar_url, avatar_url),
    last_seen_at = datetime('now')
`);

const _getUserBySteamId = db.prepare(
  `SELECT * FROM users WHERE steam_id = ?`
);

const _setFriendStatus = db.prepare(`
  UPDATE users SET is_friend = @is_friend, friend_since = @friend_since
  WHERE steam_id = @steam_id
`);

const _deactivateUserSubs = db.prepare(`
  UPDATE subscriptions SET is_active = 0
  WHERE user_id = (SELECT id FROM users WHERE steam_id = ?)
`);

const _deleteUserData = db.prepare(`DELETE FROM users WHERE id = ?`);

const _getFriendCount = db.prepare(
  `SELECT COUNT(*) as count FROM users WHERE is_friend = 1`
);

// Subscriptions
const _getUserSubs = db.prepare(
  `SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC`
);

const _getSubById = db.prepare(
  `SELECT * FROM subscriptions WHERE id = ? AND user_id = ?`
);

const _createSub = db.prepare(`
  INSERT INTO subscriptions (user_id, knife_id, float_min, float_max, price_min, price_max, paint_seed, stattrak_only, snipe_alerts, price_drop_pct, frequency)
  VALUES (@user_id, @knife_id, @float_min, @float_max, @price_min, @price_max, @paint_seed, @stattrak_only, @snipe_alerts, @price_drop_pct, @frequency)
`);

const _updateSub = db.prepare(`
  UPDATE subscriptions SET
    knife_id = @knife_id, float_min = @float_min, float_max = @float_max,
    price_min = @price_min, price_max = @price_max, paint_seed = @paint_seed,
    stattrak_only = @stattrak_only, snipe_alerts = @snipe_alerts,
    price_drop_pct = @price_drop_pct, frequency = @frequency,
    is_active = @is_active, updated_at = datetime('now')
  WHERE id = @id AND user_id = @user_id
`);

const _deleteSub = db.prepare(
  `DELETE FROM subscriptions WHERE id = ? AND user_id = ?`
);

const _getActiveSubsForKnife = db.prepare(`
  SELECT s.*, u.steam_id, u.persona_name, u.is_friend
  FROM subscriptions s
  JOIN users u ON s.user_id = u.id
  WHERE s.is_active = 1
    AND u.is_friend = 1
    AND (s.knife_id = ? OR s.knife_id = '*')
`);

// Notifications
const _wasAlreadySent = db.prepare(
  `SELECT 1 FROM notifications WHERE user_id = ? AND listing_fp = ? AND delivery_status = 'sent' LIMIT 1`
);

const _insertNotification = db.prepare(`
  INSERT INTO notifications (user_id, subscription_id, listing_fp, knife_id, message_text, delivery_status)
  VALUES (@user_id, @subscription_id, @listing_fp, @knife_id, @message_text, @delivery_status)
`);

const _updateNotificationStatus = db.prepare(
  `UPDATE notifications SET delivery_status = ?, sent_at = datetime('now') WHERE id = ?`
);

const _getUserNotifications = db.prepare(
  `SELECT * FROM notifications WHERE user_id = ? ORDER BY sent_at DESC LIMIT ?`
);

const _getMessageCountSince = db.prepare(`
  SELECT COUNT(*) as count FROM notifications
  WHERE delivery_status = 'sent' AND sent_at >= datetime('now', ?)
`);

const _getUserMessageCountSince = db.prepare(`
  SELECT COUNT(*) as count FROM notifications
  WHERE user_id = ? AND delivery_status = 'sent' AND sent_at >= datetime('now', ?)
`);

// Price cache
const _upsertPriceCache = db.prepare(`
  INSERT INTO price_cache (listing_fp, knife_id, last_price, current_price, updated_at)
  VALUES (@listing_fp, @knife_id, @last_price, @current_price, datetime('now'))
  ON CONFLICT(listing_fp) DO UPDATE SET
    last_price = price_cache.current_price,
    current_price = @current_price,
    updated_at = datetime('now')
`);

const _getPriceCacheEntry = db.prepare(
  `SELECT * FROM price_cache WHERE listing_fp = ?`
);

// Digest buffer
const _insertDigestItem = db.prepare(`
  INSERT INTO digest_buffer (user_id, subscription_id, listing_fp, knife_id, message_text)
  VALUES (@user_id, @subscription_id, @listing_fp, @knife_id, @message_text)
`);

const _getDigestItems = db.prepare(
  `SELECT * FROM digest_buffer WHERE user_id = ? ORDER BY created_at ASC`
);

const _clearDigestItems = db.prepare(
  `DELETE FROM digest_buffer WHERE user_id = ?`
);

// Sessions
const _createSession = db.prepare(`
  INSERT INTO sessions (token, user_id, expires_at)
  VALUES (?, ?, datetime('now', '+7 days'))
`);

const _getSession = db.prepare(`
  SELECT s.*, u.steam_id, u.persona_name, u.avatar_url, u.is_friend
  FROM sessions s
  JOIN users u ON s.user_id = u.id
  WHERE s.token = ? AND s.expires_at > datetime('now')
`);

const _deleteSession = db.prepare(`DELETE FROM sessions WHERE token = ?`);

const _cleanExpiredSessions = db.prepare(
  `DELETE FROM sessions WHERE expires_at <= datetime('now')`
);

// ── Public API ───────────────────────────────────
export default {
  raw: db,

  // Users
  upsertUser(steamId, personaName = null, avatarUrl = null) {
    _upsertUser.run({ steam_id: steamId, persona_name: personaName, avatar_url: avatarUrl });
    return _getUserBySteamId.get(steamId);
  },

  getUserBySteamId(steamId) {
    return _getUserBySteamId.get(steamId);
  },

  setFriendStatus(steamId, isFriend) {
    _setFriendStatus.run({
      steam_id: steamId,
      is_friend: isFriend ? 1 : 0,
      friend_since: isFriend ? new Date().toISOString() : null,
    });
  },

  deactivateUserSubs(steamId) {
    _deactivateUserSubs.run(steamId);
  },

  deleteUser(userId) {
    _deleteUserData.run(userId);
  },

  getFriendCount() {
    return _getFriendCount.get().count;
  },

  // Subscriptions
  getUserSubscriptions(userId) {
    return _getUserSubs.all(userId);
  },

  getSubscription(subId, userId) {
    return _getSubById.get(subId, userId);
  },

  createSubscription(data) {
    const result = _createSub.run(data);
    return { id: result.lastInsertRowid, ...data };
  },

  updateSubscription(data) {
    _updateSub.run(data);
  },

  deleteSubscription(subId, userId) {
    return _deleteSub.run(subId, userId);
  },

  getActiveSubscriptionsForKnife(knifeId) {
    return _getActiveSubsForKnife.all(knifeId);
  },

  // Notifications
  wasAlreadySent(userId, listingFp) {
    return !!_wasAlreadySent.get(userId, listingFp);
  },

  insertNotification(data) {
    const result = _insertNotification.run(data);
    return result.lastInsertRowid;
  },

  updateNotificationStatus(notifId, status) {
    _updateNotificationStatus.run(status, notifId);
  },

  getUserNotifications(userId, limit = 20) {
    return _getUserNotifications.all(userId, limit);
  },

  getGlobalMessageCount(windowMinutes) {
    return _getMessageCountSince.get(`-${windowMinutes} minutes`).count;
  },

  getUserMessageCount(userId, windowMinutes) {
    return _getUserMessageCountSince.get(userId, `-${windowMinutes} minutes`).count;
  },

  // Price cache
  upsertPriceCache(listingFp, knifeId, currentPrice) {
    _upsertPriceCache.run({
      listing_fp: listingFp,
      knife_id: knifeId,
      last_price: currentPrice, // on first insert, last = current
      current_price: currentPrice,
    });
  },

  getPriceCacheEntry(listingFp) {
    return _getPriceCacheEntry.get(listingFp);
  },

  // Digest buffer
  insertDigestItem(data) {
    _insertDigestItem.run(data);
  },

  getDigestItems(userId) {
    return _getDigestItems.all(userId);
  },

  clearDigestItems(userId) {
    _clearDigestItems.run(userId);
  },

  // Sessions
  createSession(token, userId) {
    _createSession.run(token, userId);
  },

  getSession(token) {
    return _getSession.get(token);
  },

  deleteSession(token) {
    _deleteSession.run(token);
  },

  cleanExpiredSessions() {
    _cleanExpiredSessions.run();
  },
};
