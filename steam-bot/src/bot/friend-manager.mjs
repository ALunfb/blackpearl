import SteamUser from 'steam-user';
import steamClient from './steam-client.mjs';
import db from '../data/database.mjs';
import {
  FRIEND_ACCEPT_DELAY, WELCOME_MSG_DELAY,
  MAX_FRIENDS, BOT_WEB_URL,
} from '../config.mjs';
import { randomDelay } from '../utils/delay.mjs';
import { createLogger } from '../utils/logger.mjs';

const log = createLogger('friend-mgr');

// Relationship enum from steam-user
const EFriendRelationship = SteamUser.EFriendRelationship;

function init() {
  steamClient.on('friendRelationship', handleRelationshipChange);
  steamClient.on('ready', syncFriendsList);
  log.info('Friend manager initialized');
}

/**
 * On bot startup, sync the friends list with the database.
 */
function syncFriendsList() {
  const friends = steamClient.getFriends();
  let synced = 0;

  for (const [steamId, relationship] of Object.entries(friends)) {
    if (relationship === EFriendRelationship.Friend) {
      const user = db.getUserBySteamId(steamId);
      if (!user) {
        db.upsertUser(steamId);
        db.setFriendStatus(steamId, true);
      } else if (!user.is_friend) {
        db.setFriendStatus(steamId, true);
      }
      synced++;
    }
  }

  log.info(`Friends list synced`, { count: synced });
}

async function handleRelationshipChange(steamId, relationship) {
  const sid = steamId.toString();

  if (relationship === EFriendRelationship.RequestRecipient) {
    // Incoming friend request
    await handleFriendRequest(sid);
  } else if (relationship === EFriendRelationship.None) {
    // User unfriended or was removed
    handleUnfriend(sid);
  }
}

async function handleFriendRequest(steamId) {
  log.info('Incoming friend request', { steamId });

  // Check friend cap
  const friendCount = db.getFriendCount();
  if (friendCount >= MAX_FRIENDS) {
    log.warn('Friend cap reached, ignoring request', { steamId, cap: MAX_FRIENDS });
    return;
  }

  // Random delay before accepting (anti-ban)
  log.info('Delaying friend accept...', { steamId });
  await randomDelay(FRIEND_ACCEPT_DELAY);

  // Accept the request
  const success = steamClient.addFriend(steamId);
  if (!success) {
    log.error('Failed to accept friend request', { steamId });
    return;
  }

  log.info('Friend request accepted', { steamId });

  // Ensure user exists in DB
  const user = db.upsertUser(steamId);
  db.setFriendStatus(steamId, true);

  // Send welcome message after another delay
  await randomDelay(WELCOME_MSG_DELAY);

  const hasSubscriptions = db.getUserSubscriptions(user.id).length > 0;

  let welcomeMsg;
  if (hasSubscriptions) {
    welcomeMsg = `Hey! Thanks for adding me. You already have notification alerts set up. I'll message you when matching Black Pearl listings appear on CSFloat.\n\nManage your alerts anytime: ${BOT_WEB_URL}`;
  } else {
    welcomeMsg = `Hey! I'm the Black Pearl notification bot. I'll send you messages when new Black Pearl Doppler knives are listed on CSFloat that match your criteria.\n\nSet up your alerts here: ${BOT_WEB_URL}\n\nYou can choose which knives, float ranges, prices, and patterns to watch for.`;
  }

  steamClient.sendMessage(steamId, welcomeMsg);
  log.info('Welcome message sent', { steamId });
}

function handleUnfriend(steamId) {
  log.info('User unfriended or removed', { steamId });
  db.setFriendStatus(steamId, false);
  db.deactivateUserSubs(steamId);
}

export default { init };
