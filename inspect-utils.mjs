// Pure helpers for working with decoded CS2 inspect-link data.
// No dependencies — consumers import @csfloat/cs2-inspect-serializer themselves
// (via esm.sh in the browser, via node_modules on the server).

// Knife defindex → human name. Extended beyond the BP set so the decoder tool
// can handle any CS2 knife pasted into it.
export const KNIVES_BY_DEFINDEX = {
  500: 'Bayonet',
  503: 'Classic Knife',
  505: 'Flip Knife',
  506: 'Gut Knife',
  507: 'Karambit',
  508: 'M9 Bayonet',
  509: 'Huntsman Knife',
  512: 'Falchion Knife',
  514: 'Bowie Knife',
  515: 'Butterfly Knife',
  516: 'Shadow Daggers',
  517: 'Paracord Knife',
  518: 'Survival Knife',
  519: 'Ursus Knife',
  520: 'Navaja Knife',
  521: 'Nomad Knife',
  522: 'Stiletto Knife',
  523: 'Talon Knife',
  525: 'Skeleton Knife',
  526: 'Kukri Knife',
};

// Paint indices that matter for the Doppler line. Others fall through to
// "Paint N" — upstream can extend this when needed.
export const PAINT_NAMES = {
  415: 'Doppler',
  416: 'Doppler',
  417: 'Gamma Doppler',
  418: 'Marble Fade',
  419: 'Tiger Tooth',
  420: 'Damascus Steel',
  421: 'Rust Coat',
  422: 'Ultraviolet',
  617: 'Gamma Doppler',
  619: 'Lore',
  620: 'Black Laminate',
  568: 'Doppler',
  569: 'Doppler',
};

const FORMAT_RE = {
  // Masked: `...+csgo_econ_action_preview ` followed by a hex payload. The
  // separator is either a literal space or a %20. Payload is hex digits.
  masked: /\+csgo_econ_action_preview(?:%20| )([0-9A-Fa-f]+)\s*$/,
  // Unmasked S/A/D: references an item in a user's inventory. Needs Steam GC.
  unmasked: /\+csgo_econ_action_preview(?:%20| )S\d+A\d+D\d+\s*$/,
};

/** Detect link format. Returns 'masked' | 'unmasked' | 'invalid'. */
export function detectLinkFormat(link) {
  if (typeof link !== 'string') return 'invalid';
  const trimmed = link.trim();
  if (FORMAT_RE.unmasked.test(trimmed)) return 'unmasked';
  if (FORMAT_RE.masked.test(trimmed)) return 'masked';
  return 'invalid';
}

/** Standard CS2 wear buckets from a float value. */
export function wearBucket(float) {
  if (typeof float !== 'number' || !isFinite(float)) return null;
  if (float < 0.07) return 'FN';
  if (float < 0.15) return 'MW';
  if (float < 0.38) return 'FT';
  if (float < 0.45) return 'WW';
  return 'BS';
}

export const WEAR_LABELS = {
  FN: 'Factory New',
  MW: 'Minimal Wear',
  FT: 'Field-Tested',
  WW: 'Well-Worn',
  BS: 'Battle-Scarred',
};

// Origin values per Steam econ protobuf. Not exhaustive — most knives in
// circulation come from case drops / trade-ups / marketplace.
const ORIGIN_LABELS = {
  0: 'Invalid',
  1: 'Drop',
  2: 'Achievement',
  3: 'Purchased',
  4: 'Traded',
  5: 'Crafted',
  6: 'Store Promo',
  7: 'Gifted',
  8: 'Support Granted',
  9: 'Found in Crate',
  10: 'Earned',
  11: 'Third-Party Promo',
  12: 'Wrapped Gift',
  13: 'Halloween Drop',
  14: 'Steam Purchase',
  15: 'Foreign Item',
  16: 'CD Key',
  17: 'Collection Reward',
  18: 'Preview Item',
  19: 'Steam Workshop Contribution',
  20: 'Periodic Score Reward',
  21: 'Recycling',
  22: 'Tournament Drop',
  23: 'Stock Item',
  24: 'Quest Reward',
  25: 'Level Up Reward',
};

export function originLabel(n) {
  return ORIGIN_LABELS[n] ?? (n == null ? null : `Origin ${n}`);
}

/** Normalize a decoded InspectProps blob into a display-friendly shape. */
export function normalizeDecoded(decoded) {
  if (!decoded || typeof decoded !== 'object') return null;

  const float = decoded.paintwear ?? null;
  const wear = float != null ? wearBucket(float) : null;
  const knifeName = KNIVES_BY_DEFINDEX[decoded.defindex] ?? null;
  const paintName = PAINT_NAMES[decoded.paintindex] ?? null;

  // StatTrak items have killeaterscoretype defined (0 for kills). A decoded
  // non-StatTrak knife won't have killeatervalue present at all.
  const isStatTrak = decoded.killeaterscoretype != null;
  const stKills = isStatTrak ? (decoded.killeatervalue ?? 0) : null;

  return {
    defindex: decoded.defindex ?? null,
    paintindex: decoded.paintindex ?? null,
    paintseed: decoded.paintseed ?? null,
    paintwear: float,
    wear,
    wear_label: wear ? WEAR_LABELS[wear] : null,
    knife_name: knifeName,
    paint_name: paintName,
    is_knife: knifeName != null,
    is_stattrak: isStatTrak,
    stattrak_kills: stKills,
    custom_name: decoded.customname ?? null,
    origin: decoded.origin ?? null,
    origin_label: originLabel(decoded.origin),
    rarity: decoded.rarity ?? null,
    quality: decoded.quality ?? null,
    stickers: Array.isArray(decoded.stickers) ? decoded.stickers : [],
    keychains: Array.isArray(decoded.keychains) ? decoded.keychains : [],
    itemid: decoded.itemid != null ? String(decoded.itemid) : null,
  };
}

/** Try to extract the hex payload from a masked link (useful for sharing). */
export function extractMaskedHex(link) {
  const m = FORMAT_RE.masked.exec((link || '').trim());
  return m ? m[1].toUpperCase() : null;
}
