import { Router } from 'express';
import crypto from 'crypto';
import { BOT_WEB_URL, STEAM_API_KEY } from '../../config.mjs';
import db from '../../data/database.mjs';
import { createLogger } from '../../utils/logger.mjs';

const router = Router();
const log = createLogger('auth');

// ── Steam OpenID 2.0 ────────────────────────────
const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const FETCH_TIMEOUT_MS = 10_000;

// Simple in-memory rate limiter for auth callback
const AUTH_ATTEMPTS = new Map();
const AUTH_MAX_ATTEMPTS = 10;
const AUTH_WINDOW_MS = 15 * 60 * 1000; // 15 min

function checkAuthRateLimit(ip) {
  const now = Date.now();
  const entry = AUTH_ATTEMPTS.get(ip) || { count: 0, resetAt: now + AUTH_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + AUTH_WINDOW_MS;
  }
  entry.count++;
  AUTH_ATTEMPTS.set(ip, entry);
  return entry.count <= AUTH_MAX_ATTEMPTS;
}

// Periodically purge old rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of AUTH_ATTEMPTS) {
    if (now > entry.resetAt) AUTH_ATTEMPTS.delete(ip);
  }
}, 60 * 60 * 1000);

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Redirect user to Steam login.
 */
router.get('/login', (req, res) => {
  const params = new URLSearchParams({
    'openid.ns':         'http://specs.openid.net/auth/2.0',
    'openid.mode':       'checkid_setup',
    'openid.return_to':  `${BOT_WEB_URL}/auth/callback`,
    'openid.realm':      BOT_WEB_URL,
    'openid.identity':   'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });

  res.redirect(`${STEAM_OPENID_URL}?${params.toString()}`);
});

/**
 * Handle Steam OpenID callback.
 */
router.get('/callback', async (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (!checkAuthRateLimit(ip)) {
    log.warn('Auth rate limit hit', { ip });
    return res.status(429).send('Too many login attempts. Please wait 15 minutes.');
  }

  try {
    const query = req.query;

    if (query['openid.mode'] !== 'id_res') {
      log.warn('OpenID mode is not id_res', { mode: query['openid.mode'] });
      return res.redirect('/?error=auth_failed');
    }

    const isValid = await verifyOpenId(query);
    if (!isValid) {
      log.warn('OpenID verification failed');
      return res.redirect('/?error=auth_failed');
    }

    // Extract Steam ID from claimed_id — must be a valid 17-digit Steam 64-bit ID
    const claimedId = String(query['openid.claimed_id'] || '');
    const match = claimedId.match(/\/id\/(\d{17})$/);
    if (!match) {
      log.error('Could not extract valid Steam ID', { claimedId });
      return res.redirect('/?error=auth_failed');
    }

    const steamId = match[1];
    if (!/^7656119\d{10}$/.test(steamId)) {
      log.error('Steam ID failed format check', { steamId });
      return res.redirect('/?error=auth_failed');
    }

    log.info('Steam login successful', { steamId });

    const profile = await fetchSteamProfile(steamId);
    const user = db.upsertUser(steamId, profile?.personaname, profile?.avatarfull);

    const token = crypto.randomUUID();
    db.createSession(token, user.id);

    res.cookie('bp_session', token, {
      httpOnly: true,
      secure: BOT_WEB_URL.startsWith('https'),
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.redirect('/');
  } catch (err) {
    log.error('Auth callback error', { error: err.message });
    res.redirect('/?error=auth_failed');
  }
});

router.get('/logout', (req, res) => {
  const token = req.cookies?.bp_session;
  if (token) {
    db.deleteSession(token);
    res.clearCookie('bp_session');
  }
  res.redirect('/');
});

async function verifyOpenId(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    params.set(key, value);
  }
  params.set('openid.mode', 'check_authentication');

  try {
    const response = await fetchWithTimeout(STEAM_OPENID_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const text = await response.text();
    return text.includes('is_valid:true');
  } catch (err) {
    log.error('OpenID verification request failed', { error: err.message });
    return false;
  }
}

async function fetchSteamProfile(steamId) {
  try {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;
    const data = await response.json();
    return data?.response?.players?.[0] || null;
  } catch (err) {
    log.error('Failed to fetch Steam profile', { steamId, error: err.message });
    return null;
  }
}

export default router;
