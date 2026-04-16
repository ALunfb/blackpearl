import { Router } from 'express';
import { requireAuth } from '../server.mjs';
import db from '../../data/database.mjs';
import { KNIVES } from '../../config.mjs';
import { createLogger } from '../../utils/logger.mjs';
import { enqueueMessage } from '../../bot/message-sender.mjs';
import { formatNewListing } from '../../notifications/formatter.mjs';

const router = Router();
const log = createLogger('api');

const VALID_KNIFE_IDS = new Set([...KNIVES.map(k => k.id), '*']);
const VALID_FREQUENCIES = new Set(['instant', 'hourly', 'daily']);
const MAX_SUBSCRIPTIONS_PER_USER = 20;

// ── User info ────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  res.json({
    steam_id: req.user.steam_id,
    persona_name: req.user.persona_name,
    avatar_url: req.user.avatar_url,
    is_friend: !!req.user.is_friend,
  });
});

router.delete('/me', requireAuth, (req, res) => {
  db.deleteUser(req.user.id);
  res.clearCookie('bp_session');
  log.info('User deleted all data', { steamId: req.user.steam_id });
  res.json({ success: true });
});

// ── Subscriptions ────────────────────────────────

router.get('/subscriptions', requireAuth, (req, res) => {
  const subs = db.getUserSubscriptions(req.user.id);
  res.json(subs);
});

router.post('/subscriptions', requireAuth, (req, res) => {
  // Check subscription limit
  const existing = db.getUserSubscriptions(req.user.id);
  if (existing.length >= MAX_SUBSCRIPTIONS_PER_USER) {
    return res.status(400).json({ error: `Maximum ${MAX_SUBSCRIPTIONS_PER_USER} subscriptions allowed` });
  }

  const data = validateSubscription(req.body);
  if (data.error) {
    return res.status(400).json({ error: data.error });
  }

  data.user_id = req.user.id;
  const sub = db.createSubscription(data);
  log.info('Subscription created', { userId: req.user.id, subId: sub.id, knifeId: data.knife_id });
  res.status(201).json(sub);
});

router.put('/subscriptions/:id', requireAuth, (req, res) => {
  const subId = parseInt(req.params.id, 10);
  const existing = db.getSubscription(subId, req.user.id);
  if (!existing) {
    return res.status(404).json({ error: 'Subscription not found' });
  }

  const data = validateSubscription(req.body);
  if (data.error) {
    return res.status(400).json({ error: data.error });
  }

  data.id = subId;
  data.user_id = req.user.id;
  data.is_active = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;
  db.updateSubscription(data);
  log.info('Subscription updated', { userId: req.user.id, subId });
  res.json({ success: true });
});

router.delete('/subscriptions/:id', requireAuth, (req, res) => {
  const subId = parseInt(req.params.id, 10);
  const result = db.deleteSubscription(subId, req.user.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Subscription not found' });
  }
  log.info('Subscription deleted', { userId: req.user.id, subId });
  res.json({ success: true });
});

// ── Test ─────────────────────────────────────────

router.post('/test-notification', requireAuth, (req, res) => {
  if (!req.user.is_friend) {
    return res.status(400).json({ error: 'Bot is not on your friends list' });
  }

  const fakeListing = {
    id: 'test-' + Date.now(),
    price: 8500,
    wear: 'FN',
    float_value: 0.0069,
    paint_seed: 661,
    stattrak: false,
    csfloat_url: 'https://csfloat.com/item/test',
  };

  const message = formatNewListing(fakeListing, 'karambit', 'Karambit', req.user.persona_name);

  const notifId = db.insertNotification({
    user_id: req.user.id,
    subscription_id: null,
    listing_fp: 'test:' + Date.now(),
    knife_id: 'karambit',
    message_text: message,
    delivery_status: 'pending',
  });

  enqueueMessage(req.user.steam_id, message, notifId, 1);
  log.info('Test notification queued', { userId: req.user.id });
  res.json({ success: true, message: 'Test notification queued — check Steam in a few seconds.' });
});

// ── Notifications ────────────────────────────────

router.get('/notifications', requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  const notifs = db.getUserNotifications(req.user.id, limit);
  res.json(notifs);
});

// ── Knives list (public) ─────────────────────────

router.get('/knives', (req, res) => {
  res.json(KNIVES.map(k => ({ id: k.id, name: k.name })));
});

// ── Validation ───────────────────────────────────

function validateSubscription(body) {
  const {
    knife_id, float_min, float_max, price_min, price_max,
    paint_seed, stattrak_only, snipe_alerts, price_drop_pct, frequency,
  } = body;

  if (!knife_id || !VALID_KNIFE_IDS.has(knife_id)) {
    return { error: 'Invalid knife_id' };
  }

  if (frequency && !VALID_FREQUENCIES.has(frequency)) {
    return { error: 'Invalid frequency. Must be: instant, hourly, or daily' };
  }

  // Validate numeric ranges
  const fMin = parseNullableFloat(float_min);
  const fMax = parseNullableFloat(float_max);
  const pMin = parseNullableFloat(price_min);
  const pMax = parseNullableFloat(price_max);
  const seed = parseNullableInt(paint_seed);
  const dropPct = parseNullableFloat(price_drop_pct);

  if (fMin !== null && (fMin < 0 || fMin > 1)) return { error: 'float_min must be 0-1' };
  if (fMax !== null && (fMax < 0 || fMax > 1)) return { error: 'float_max must be 0-1' };
  if (fMin !== null && fMax !== null && fMin > fMax) return { error: 'float_min must be <= float_max' };
  if (pMin !== null && pMin < 0) return { error: 'price_min must be >= 0' };
  if (pMax !== null && pMax < 0) return { error: 'price_max must be >= 0' };
  if (pMin !== null && pMax !== null && pMin > pMax) return { error: 'price_min must be <= price_max' };
  if (seed !== null && seed < 0) return { error: 'paint_seed must be >= 0' };
  if (dropPct !== null && (dropPct < 1 || dropPct > 99)) return { error: 'price_drop_pct must be 1-99' };

  return {
    knife_id,
    float_min: fMin,
    float_max: fMax,
    price_min: pMin,
    price_max: pMax,
    paint_seed: seed,
    stattrak_only: stattrak_only ? 1 : 0,
    snipe_alerts: snipe_alerts ? 1 : 0,
    price_drop_pct: dropPct,
    frequency: frequency || 'instant',
  };
}

function parseNullableFloat(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseNullableInt(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

export default router;
