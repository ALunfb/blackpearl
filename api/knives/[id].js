// Serves a single knife from the cached listings.json. No CSFloat calls.
// See api/knives/index.js for the rationale.
import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');

  const { id } = req.query;
  try {
    const filePath = path.join(process.cwd(), 'data', 'listings.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const knife = (data.knives || []).find(k => k.knife_id === id);
    if (!knife) {
      res.status(404).json({ error: `Unknown knife id: ${id}` });
      return;
    }
    res.status(200).json(knife);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
