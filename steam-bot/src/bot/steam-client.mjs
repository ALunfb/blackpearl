import SteamUser from 'steam-user';
import SteamTotp from 'steam-totp';
import { EventEmitter } from 'events';
import {
  STEAM_USERNAME, STEAM_PASSWORD, STEAM_SHARED_SECRET,
  RECONNECT_BASE_MS, RECONNECT_MAX_MS,
} from '../config.mjs';
import { createLogger } from '../utils/logger.mjs';
import { sleep } from '../utils/delay.mjs';

const log = createLogger('steam-client');

class SteamClient extends EventEmitter {
  constructor() {
    super();
    this.client = new SteamUser();
    this.isReady = false;
    this._reconnectAttempts = 0;
    this._shuttingDown = false;

    this._setupEventHandlers();
  }

  _setupEventHandlers() {
    this.client.on('loggedOn', () => {
      log.info('Logged into Steam successfully');
      this._reconnectAttempts = 0;
      this.isReady = true;

      // Set online and visible
      this.client.setPersona(SteamUser.EPersonaState.Online);
      this.emit('ready');
    });

    this.client.on('error', (err) => {
      log.error('Steam client error', { message: err.message, eresult: err.eresult });
      this.isReady = false;

      // Don't reconnect on fatal auth errors
      if (err.eresult === SteamUser.EResult.InvalidPassword ||
          err.eresult === SteamUser.EResult.AccountDisabled ||
          err.eresult === SteamUser.EResult.AccountNotFound) {
        log.error('Fatal auth error — not reconnecting');
        this.emit('fatal', err);
        return;
      }

      this._scheduleReconnect();
    });

    this.client.on('disconnected', (eresult, msg) => {
      log.warn('Disconnected from Steam', { eresult, msg });
      this.isReady = false;
      if (!this._shuttingDown) {
        this._scheduleReconnect();
      }
    });

    this.client.on('steamGuard', (domain, callback) => {
      // Generate TOTP code automatically
      const code = SteamTotp.generateAuthCode(STEAM_SHARED_SECRET);
      log.info('Steam Guard code requested, providing TOTP');
      callback(code);
    });

    // Forward friend-related events for the friend manager
    this.client.on('friendRelationship', (steamId, relationship) => {
      this.emit('friendRelationship', steamId, relationship);
    });

    this.client.on('friendMessage', (steamId, message) => {
      this.emit('friendMessage', steamId, message);
    });

    this.client.on('friendsList', () => {
      this.emit('friendsList');
    });
  }

  async login() {
    log.info('Logging into Steam...', { username: STEAM_USERNAME });

    const twoFactorCode = SteamTotp.generateAuthCode(STEAM_SHARED_SECRET);

    this.client.logOn({
      accountName: STEAM_USERNAME,
      password: STEAM_PASSWORD,
      twoFactorCode,
      rememberPassword: true,
      machineName: 'BlackPearl-Bot',
    });
  }

  async _scheduleReconnect() {
    if (this._shuttingDown) return;

    this._reconnectAttempts++;
    // Exponential backoff with jitter
    const base = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempts - 1),
      RECONNECT_MAX_MS
    );
    const jitter = Math.random() * base * 0.3;
    const delay = Math.floor(base + jitter);

    log.info(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this._reconnectAttempts})`);
    await sleep(delay);

    if (!this._shuttingDown) {
      try {
        await this.login();
      } catch (err) {
        log.error('Login attempt threw', { error: err.message });
        // schedule another retry
        this._scheduleReconnect();
      }
    }
  }

  /**
   * Send a chat message to a Steam user.
   * Returns true on success, false on failure.
   */
  sendMessage(steamId, message) {
    if (!this.isReady) {
      log.warn('Cannot send message — not connected');
      return false;
    }
    try {
      this.client.chat.sendFriendMessage(steamId, message);
      return true;
    } catch (err) {
      log.error('Failed to send message', { steamId: steamId.toString(), error: err.message });
      return false;
    }
  }

  /**
   * Accept a pending friend request.
   */
  addFriend(steamId) {
    if (!this.isReady) return false;
    try {
      this.client.addFriend(steamId);
      return true;
    } catch (err) {
      log.error('Failed to accept friend request', { steamId: steamId.toString(), error: err.message });
      return false;
    }
  }

  /**
   * Remove a friend.
   */
  removeFriend(steamId) {
    if (!this.isReady) return false;
    try {
      this.client.removeFriend(steamId);
      return true;
    } catch (err) {
      log.error('Failed to remove friend', { steamId: steamId.toString(), error: err.message });
      return false;
    }
  }

  /**
   * Get current friends list as an object { steamId: relationship }.
   */
  getFriends() {
    return this.client.myFriends || {};
  }

  /**
   * Graceful shutdown.
   */
  shutdown() {
    this._shuttingDown = true;
    this.isReady = false;
    log.info('Shutting down Steam client');
    this.client.logOff();
  }
}

// Singleton
const steamClient = new SteamClient();
export default steamClient;
