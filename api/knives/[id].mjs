import { fetchBlackPearls } from '../_lib/csfloat.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { id } = req.query;
  try {
    const data = await fetchBlackPearls(id);
    res.status(200).json(data);
  } catch (err) {
    const status = err.message.includes('Unknown knife') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
}
