import express from 'express';
import cookieParser from 'cookie-parser';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BOT_WEB_PORT, BOT_WEB_URL } from '../config.mjs';
import { createLogger } from '../utils/logger.mjs';
import db from '../data/database.mjs';
import authRoutes from './routes/auth.mjs';
import subscriptionRoutes from './routes/subscriptions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = createLogger('web');

const app = express();

app.use(express.json());
app.use(cookieParser());

// CORS for local dev
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/**
 * Auth middleware — checks session cookie.
 */
export function requireAuth(req, res, next) {
  const token = req.cookies?.bp_session;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const session = db.getSession(token);
  if (!session) {
    res.clearCookie('bp_session');
    return res.status(401).json({ error: 'Session expired' });
  }

  req.user = {
    id: session.user_id,
    steam_id: session.steam_id,
    persona_name: session.persona_name,
    avatar_url: session.avatar_url,
    is_friend: session.is_friend,
  };
  next();
}

// Routes
app.use('/auth', authRoutes);
app.use('/api', subscriptionRoutes);

// Serve the dashboard page
app.get('/', (req, res) => {
  res.sendFile(resolve(__dirname, 'pages', 'dashboard.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Start the web server.
 */
function start() {
  // Clean expired sessions on startup
  db.cleanExpiredSessions();

  // Clean expired sessions every hour
  setInterval(() => db.cleanExpiredSessions(), 60 * 60 * 1000);

  app.listen(BOT_WEB_PORT, () => {
    log.info(`Web server listening on port ${BOT_WEB_PORT}`);
    log.info(`Dashboard: ${BOT_WEB_URL}`);
  });
}

export default { start, app };
