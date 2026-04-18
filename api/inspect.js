// Public inspect-link decoder endpoint.
// GET  /api/inspect?link=<url-encoded inspect link>
// POST /api/inspect   body: { link: "steam://..." }
//
// Returns JSON with decoded fields. Free, CORS-enabled, no auth. Only works
// on masked (self-encoded) inspect links — unmasked S/A/D links need Steam GC,
// which this endpoint does not provide.
import { decodeLink } from '@csfloat/cs2-inspect-serializer';
import { detectLinkFormat, normalizeDecoded } from '../inspect-utils.mjs';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  let link = null;
  if (req.method === 'GET') {
    link = req.query?.link;
  } else if (req.method === 'POST') {
    link = req.body?.link;
  } else {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!link || typeof link !== 'string') {
    res.status(400).json({ error: 'Missing link parameter' });
    return;
  }

  const format = detectLinkFormat(link);
  if (format === 'invalid') {
    res.status(400).json({ error: 'Unrecognized inspect-link format', format });
    return;
  }
  if (format === 'unmasked') {
    res.status(422).json({
      error: 'Unmasked S/A/D link cannot be decoded offline — this endpoint only handles masked (self-encoded) links',
      format,
    });
    return;
  }

  try {
    const raw = decodeLink(decodeURIComponent(link));
    const normalized = normalizeDecoded(raw);
    // Cache for 1 hour at the edge — a given link always decodes to the same thing.
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.status(200).json({ format, decoded: normalized, raw });
  } catch (err) {
    res.status(422).json({ error: `Decode failed: ${err.message}`, format });
  }
}
