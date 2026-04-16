import { Router } from 'express';
import crypto from 'crypto';
import { BOT_WEB_URL, STEAM_API_KEY, SESSION_SECRET } from '../../config.mjs';
import db from '../../data/database.mjs';
import { createLogger } from '../../utils/logger.mjs';

const router = Router();
const log = createLogger('auth');

// ── Steam OpenID 2.0 ────────────────────────────
// Steam uses OpenID 2.0. We implement it directly instead of using passport
// to keep dependencies minimal.

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';

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
  try {
    const query = req.query;

    // Verify the response is valid
    if (query['openid.mode'] !== 'id_res') {
      log.warn('OpenID mode is not id_res', { mode: query['openid.mode'] });
      return res.redirect('/?error=auth_failed');
    }

    // Verify with Steam
    const isValid = await verifyOpenId(query);
    if (!isValid) {
      log.warn('OpenID verification failed');
      return res.redirect('/?error=auth_failed');
    }

    // Extract Steam ID from claimed_id
    // Format: https://steamcommunity.com/openid/id/76561198012345678
    const claimedId = query['openid.claimed_id'];
    const match = claimedId.match(/\/id\/(\d+)$/);
    if (!match) {
      log.error('Could not extract Steam ID from claimed_id', { claimedId });
      return res.redirect('/?error=auth_failed');
    }

    const steamId = match[1];
    log.info('Steam login successful', { steamId });

    // Fetch Steam profile info
    const profile = await fetchSteamProfile(steamId);

    // Upsert user
    const user = db.upsertUser(steamId, profile?.personaname, profile?.avatarfull);

    // Create session
    const token = crypto.randomUUID();
    db.createSession(token, user.id);

    // Set cookie (7 days, httpOnly, secure in production)
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

/**
 * Logout — clear session.
 */
router.get('/logout', (req, res) => {
  const token = req.cookies?.bp_session;
  if (token) {
    db.deleteSession(token);
    res.clearCookie('bp_session');
  }
  res.redirect('/');
});

/**
 * Verify the OpenID response with Steam's server.
 */
async function verifyOpenId(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    params.set(key, value);
  }
  params.set('openid.mode', 'check_authentication');

  try {
    const response = await fetch(STEAM_OPENID_URL, {
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

/**
 * Fetch a Steam user's profile from the Web API.
 */
async function fetchSteamProfile(steamId) {
  try {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId}`;
    const response = await fetch(url);
    const data = await response.json();
    return data?.response?.players?.[0] || null;
  } catch (err) {
    log.error('Failed to fetch Steam profile', { steamId, error: err.message });
    return null;
  }
}

export default router;
