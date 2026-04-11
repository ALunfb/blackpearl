import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchBlackPearls, fetchAllBlackPearls, KNIVES } from './csfloat.mjs';
import { getHistory, recordMarketCap } from './price-history.mjs';
import { getDbCounts } from './db-counts.mjs';

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

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  // ── API Routes ───────────────────────────────────────────────
  if (urlPath === '/api/knives') {
    try {
      const data = await fetchAllBlackPearls();
      // Record market cap snapshot using DB counts from file
      try { recordMarketCap(data, getDbCounts().counts); } catch (e) {
        console.error('[History] Market cap record failed:', e.message);
      }
      return json(res, data);
    } catch (err) {
      console.error('[/api/knives]', err.message);
      return jsonError(res, err.message);
    }
  }

  // /api/db-counts — database totals with deltas
  if (urlPath === '/api/db-counts') {
    return json(res, getDbCounts());
  }

  // /api/history — price history (optional ?knife=karambit&days=30)
  if (urlPath === '/api/history') {
    const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const knifeId = params.get('knife') || null;
    const days = parseInt(params.get('days') || '0', 10) || null;
    return json(res, getHistory(knifeId, days));
  }

  // /api/knives/list — quick metadata (no CSFloat calls, instant)
  if (urlPath === '/api/knives/list') {
    return json(res, KNIVES.map(k => ({ id: k.id, name: k.name })));
  }

  // /api/knives/:id — single knife
  const knifeMatch = urlPath.match(/^\/api\/knives\/([a-z0-9_]+)$/);
  if (knifeMatch) {
    const knifeId = knifeMatch[1];
    try {
      const data = await fetchBlackPearls(knifeId);
      return json(res, data);
    } catch (err) {
      const status = err.message.includes('Unknown knife') ? 404 : 500;
      console.error(`[/api/knives/${knifeId}]`, err.message);
      return jsonError(res, err.message, status);
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
