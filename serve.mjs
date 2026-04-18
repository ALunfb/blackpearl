import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getHistory } from './price-history.mjs';
import { getDbCounts } from './db-counts.mjs';

// NOTE: We intentionally do NOT import from csfloat.mjs here. The local dev
// server must not make live CSFloat calls — every dev-machine request is a
// new IP hitting the same API key, and that's the exact pattern CSFloat flags.
// All /api/knives/* endpoints read the cached data/listings.json that the
// Droplet cron maintains.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function jsonError(res, message, status = 500) {
  json(res, { error: message }, status);
}

const LISTINGS_FILE = path.join(__dirname, 'data', 'listings.json');

function readListings() {
  return JSON.parse(fs.readFileSync(LISTINGS_FILE, 'utf8'));
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  // ── API Routes — all read from cached data/listings.json ────
  // None of these make live CSFloat calls. See the header note on why.
  if (urlPath === '/api/knives') {
    try {
      const data = readListings();
      return json(res, data.knives || []);
    } catch (err) {
      console.error('[/api/knives]', err.message);
      return jsonError(res, err.message);
    }
  }

  if (urlPath === '/api/db-counts') {
    return json(res, getDbCounts());
  }

  if (urlPath === '/api/history') {
    const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const knifeId = params.get('knife') || null;
    const days = parseInt(params.get('days') || '0', 10) || null;
    return json(res, getHistory(knifeId, days));
  }

  if (urlPath === '/api/knives/list') {
    try {
      const data = readListings();
      return json(res, (data.knives || []).map(k => ({ id: k.knife_id, name: k.knife_name })));
    } catch (err) {
      return jsonError(res, err.message);
    }
  }

  const knifeMatch = urlPath.match(/^\/api\/knives\/([a-z0-9_]+)$/);
  if (knifeMatch) {
    const knifeId = knifeMatch[1];
    try {
      const data = readListings();
      const knife = (data.knives || []).find(k => k.knife_id === knifeId);
      if (!knife) return jsonError(res, `Unknown knife id: ${knifeId}`, 404);
      return json(res, knife);
    } catch (err) {
      console.error(`[/api/knives/${knifeId}]`, err.message);
      return jsonError(res, err.message);
    }
  }

  // ── Static File Serving ──────────────────────────────────────
  let staticPath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(__dirname, staticPath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + staticPath);
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`API:    http://localhost:${PORT}/api/knives`);
});
