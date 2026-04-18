// Serves the cached listings.json written by the Droplet cron.
// Previously called CSFloat's API directly from Vercel edge, which produced
// IP diversity across hundreds of edge locations and was the primary cause
// of the CSFloat API-key flag. This version never calls CSFloat.
import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // The Droplet updates listings.json every ~30 minutes and the commit
  // triggers a Vercel redeploy, so the bundled file is always recent.
  // Cache at the edge for 5 minutes to protect against cold-start thrashing.
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');

  try {
    const filePath = path.join(process.cwd(), 'data', 'listings.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.status(200).json(data.knives || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
