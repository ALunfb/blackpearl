import steamClient from './steam-client.mjs';
import db from '../data/database.mjs';
import { BOT_WEB_URL, KNIVES } from '../config.mjs';
import { createLogger } from '../utils/logger.mjs';

const log = createLogger('chat-cmd');

/**
 * Handle incoming chat messages from friends.
 * Provides basic info/help commands. Subscription management is done via the web dashboard.
 */
function init() {
  steamClient.on('friendMessage', (steamId, message) => {
    handleMessage(steamId.toString(), message);
  });
  log.info('Chat command handler initialized');
}

function handleMessage(steamId, message) {
  const msg = message.trim().toLowerCase();
  log.info('Incoming message', { steamId, message: msg.slice(0, 100) });

  if (msg === '!help' || msg === 'help' || msg === 'hi' || msg === 'hello') {
    sendHelp(steamId);
  } else if (msg === '!status') {
    sendStatus(steamId);
  } else if (msg === '!list') {
    sendSubscriptionList(steamId);
  } else if (msg === '!knives') {
    sendKnifeList(steamId);
  } else {
    // Friendly fallback
    steamClient.sendMessage(steamId,
      `I'm a notification bot — I don't chat, but I do send alerts!\n\nType !help to see what I can do, or manage your alerts at:\n${BOT_WEB_URL}`
    );
  }
}

function sendHelp(steamId) {
  steamClient.sendMessage(steamId, [
    `Black Pearl Alert Bot — Commands:`,
    ``,
    `!help — Show this message`,
    `!status — Check your subscription status`,
    `!list — View your active subscriptions`,
    `!knives — List all tracked knife types`,
    ``,
    `To create, edit, or delete subscriptions, visit:`,
    BOT_WEB_URL,
  ].join('\n'));
}

function sendStatus(steamId) {
  const user = db.getUserBySteamId(steamId);
  if (!user) {
    steamClient.sendMessage(steamId, `You're on my friends list but haven't set up an account yet.\n\nVisit ${BOT_WEB_URL} to sign in with Steam and create your first alert.`);
    return;
  }

  const subs = db.getUserSubscriptions(user.id);
  const active = subs.filter(s => s.is_active).length;
  const paused = subs.length - active;

  steamClient.sendMessage(steamId,
    `Status for ${user.persona_name || 'you'}:\n` +
    `Active alerts: ${active}\n` +
    `Paused alerts: ${paused}\n` +
    `Friend status: Connected\n\n` +
    `Manage alerts: ${BOT_WEB_URL}`
  );
}

function sendSubscriptionList(steamId) {
  const user = db.getUserBySteamId(steamId);
  if (!user) {
    steamClient.sendMessage(steamId, `No account found. Visit ${BOT_WEB_URL} to get started.`);
    return;
  }

  const subs = db.getUserSubscriptions(user.id);
  if (subs.length === 0) {
    steamClient.sendMessage(steamId, `You have no subscriptions yet.\n\nCreate one at: ${BOT_WEB_URL}`);
    return;
  }

  let msg = `Your subscriptions (${subs.length}):\n\n`;
  for (const sub of subs) {
    const knife = sub.knife_id === '*' ? 'All Knives' : (KNIVES.find(k => k.id === sub.knife_id)?.name || sub.knife_id);
    const status = sub.is_active ? 'ACTIVE' : 'PAUSED';
    const filters = [];
    if (sub.float_min !== null || sub.float_max !== null) filters.push(`Float: ${sub.float_min ?? 0}-${sub.float_max ?? 1}`);
    if (sub.price_min !== null || sub.price_max !== null) filters.push(`$${sub.price_min ?? 0}-$${sub.price_max ?? '∞'}`);
    if (sub.paint_seed !== null) filters.push(`Seed: ${sub.paint_seed}`);
    msg += `#${sub.id} ${knife} [${status}] ${sub.frequency}\n`;
    if (filters.length) msg += `   ${filters.join(' | ')}\n`;
  }
  msg += `\nEdit at: ${BOT_WEB_URL}`;

  steamClient.sendMessage(steamId, msg);
}

function sendKnifeList(steamId) {
  const lines = KNIVES.map(k => `• ${k.name}`);
  steamClient.sendMessage(steamId, `Tracked Black Pearl knives (${KNIVES.length}):\n\n${lines.join('\n')}`);
}

export default { init };
