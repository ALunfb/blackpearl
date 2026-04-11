import { fetchBlackPearls } from '../_lib/csfloat.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Cache for 15 minutes on Vercel CDN, serve stale up to 1 hour while revalidating
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
  const { id } = req.query;
  try {
    const data = await fetchBlackPearls(id);
    res.status(200).json(data);
  } catch (err) {
    const status = err.message.includes('Unknown knife') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
}
