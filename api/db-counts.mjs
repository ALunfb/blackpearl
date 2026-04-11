import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const filePath = path.join(process.cwd(), 'data', 'db-counts.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const counts = data.counts || {};
    const previous = data.previous || {};
    const deltas = {};
    for (const [id, count] of Object.entries(counts)) {
      deltas[id] = count - (previous[id] ?? 0);
    }
    const total = Object.values(counts).reduce((s, c) => s + c, 0);
    const totalPrev = Object.values(previous).reduce((s, c) => s + c, 0);

    res.status(200).json({
      updated_at: data.updated_at,
      counts,
      previous,
      deltas,
      total,
      total_delta: total - totalPrev,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
