import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const filePath = path.join(process.cwd(), 'data', 'price-history.json');
    const history = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const knife = req.query.knife || null;
    const days = parseInt(req.query.days || '0', 10) || null;
    const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;

    if (knife) {
      const entries = (history[knife] || []).filter(e => e.ts >= cutoff);
      return res.status(200).json({ [knife]: entries });
    }

    const result = {};
    for (const [id, entries] of Object.entries(history)) {
      result[id] = entries.filter(e => e.ts >= cutoff);
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
