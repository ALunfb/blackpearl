export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    hasApiKey: !!process.env.CSFLOAT_API_KEY,
    keyPrefix: process.env.CSFLOAT_API_KEY ? process.env.CSFLOAT_API_KEY.substring(0, 4) + '...' : 'MISSING',
  });
}
