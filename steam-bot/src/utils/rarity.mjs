/**
 * Shared rarity scoring — mirrors logic on the main site.
 * Returns { score, tier, factors } for a listing.
 */

const WEAR_BASE = { FN: 55, MW: 35, FT: 15, WW: 8, BS: 5 };
const TIER_RANGES = {
  FN: [0, 0.07],
  MW: [0.07, 0.15],
  FT: [0.15, 0.38],
  WW: [0.38, 0.45],
  BS: [0.45, 1.0],
};

export function rarityScore(listing) {
  if (!listing || typeof listing.float_value !== 'number') {
    return { score: 0, tier: null, factors: [] };
  }
  const { float_value: f, wear, stattrak } = listing;
  let score = WEAR_BASE[wear] || 10;
  const factors = [];

  const range = TIER_RANGES[wear];
  if (range) {
    const pct = (f - range[0]) / (range[1] - range[0]);
    score += Math.round((1 - pct) * 30);

    if (wear === 'FN' && f < 0.01) {
      score += 15;
      factors.push('ULTRA LOW FLOAT');
    } else if (wear === 'FN' && f < 0.02) {
      score += 8;
      factors.push('LOW FLOAT');
    }
    if (wear === 'BS' && f > 0.80) {
      score += 10;
      factors.push('MAX FLOAT');
    }
  }

  if (stattrak) {
    score += 12;
    factors.push('STATTRAK');
  }

  score = Math.max(0, Math.min(100, score));
  const tier = score >= 95 ? 'GRAIL'
    : score >= 85 ? 'ELITE'
    : score >= 70 ? 'GREAT'
    : score >= 50 ? 'GOOD'
    : null;

  return { score, tier, factors };
}
