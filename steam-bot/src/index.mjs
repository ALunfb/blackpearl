import { createLogger } from './utils/logger.mjs';
import steamClient from './bot/steam-client.mjs';
import friendManager from './bot/friend-manager.mjs';
import chatCommands from './bot/chat-commands.mjs';
import listingWatcher from './notifications/listing-watcher.mjs';
import digest from './notifications/digest.mjs';
import webServer from './web/server.mjs';

const log = createLogger('main');

log.info('====================================');
log.info('Black Pearl Steam Bot starting...');
log.info('====================================');

// ── Graceful shutdown ────────────────────────────
function shutdown(signal) {
  log.info(`Received ${signal}, shutting down gracefully...`);
  listingWatcher.stop();
  digest.stop();
  steamClient.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', { message: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', { reason: String(reason) });
});

// ── Boot sequence ────────────────────────────────

// 1. Start the web server (available immediately for health checks)
webServer.start();

// 2. Initialize Steam bot modules
friendManager.init();
chatCommands.init();

// 3. When Steam is ready, start the notification pipeline
steamClient.on('ready', () => {
  log.info('Steam client ready — starting notification pipeline');
  listingWatcher.start();
  digest.start();
});

steamClient.on('fatal', (err) => {
  log.error('Fatal Steam error — bot cannot operate', { message: err.message });
  log.error('Fix the credentials and restart the bot.');
});

// 4. Log in to Steam
steamClient.login();

log.info('Boot sequence initiated. Waiting for Steam login...');
