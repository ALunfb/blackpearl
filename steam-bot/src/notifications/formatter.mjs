import { KNIFE_MAP } from '../config.mjs';

/**
 * Build a varied notification message for a listing match.
 * Uses template rotation + random elements to avoid identical messages.
 */

const GREETINGS = ['Hey', 'Heads up', 'Alert', 'Yo', 'FYI'];
const BP_NAMES = ['Black Pearl', 'BP', 'Black Pearl Doppler', 'BP Doppler'];
const SUFFIXES = ['', ' Check it out!', ' Act fast!', ' Good luck!', ''];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatPrice(price) {
  if (typeof price === 'number') {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${price}`;
}

function formatFloat(f) {
  return f.toFixed(10).replace(/0+$/, '').replace(/\.$/, '.0');
}

// Rarity score — matches the logic used on the main site
function computeRarity(listing) {
  if (!listing || typeof listing.float_value !== 'number') return { score: 0, tier: null };
  const { float_value: f, wear, stattrak } = listing;
  let score = 0;
  const wearBase = { FN: 55, MW: 35, FT: 15, WW: 8, BS: 5 };
  score += wearBase[wear] || 10;
  const tierRanges = {
    FN: [0, 0.07], MW: [0.07, 0.15], FT: [0.15, 0.38],
    WW: [0.38, 0.45], BS: [0.45, 1.0],
  };
  const range = tierRanges[wear];
  if (range) {
    const pct = (f - range[0]) / (range[1] - range[0]);
    score += Math.round((1 - pct) * 30);
    if (wear === 'FN' && f < 0.01) score += 15;
    else if (wear === 'FN' && f < 0.02) score += 8;
    if (wear === 'BS' && f > 0.80) score += 10;
  }
  if (stattrak) score += 12;
  score = Math.max(0, Math.min(100, score));
  const tier = score >= 95 ? 'GRAIL' : score >= 85 ? 'ELITE'
    : score >= 70 ? 'GREAT' : score >= 50 ? 'GOOD' : null;
  return { score, tier };
}

/**
 * Build a notification message for a new listing.
 * @param {object} listing - The listing data from the tracker
 * @param {string} knifeId - e.g. 'karambit'
 * @param {string} knifeName - e.g. 'Karambit'
 * @param {string|null} userName - The recipient's persona name (for personalization)
 * @returns {string}
 */
export function formatNewListing(listing, knifeId, knifeName, userName) {
  const bp = pick(BP_NAMES);
  const greeting = pick(GREETINGS);
  const suffix = pick(SUFFIXES);
  const showSeed = Math.random() > 0.4;
  const showPersonal = userName && Math.random() > 0.5;

  const name = showPersonal ? `${greeting} ${userName}` : greeting;
  const price = formatPrice(listing.price);
  const float = formatFloat(listing.float_value);
  const wear = listing.wear;
  const st = listing.stattrak ? 'StatTrak\u2122 ' : '';
  const seed = showSeed ? ` | Pattern: ${listing.paint_seed}` : '';
  const rarity = computeRarity(listing);
  const rarityLine = rarity.tier ? `\n[${rarity.tier}] Rarity score: ${rarity.score}/100` : '';

  const templates = [
    `${name} \u2014 new ${st}${knifeName} ${bp} listed!\n${wear} | ${price} | Float: ${float}${seed}${rarityLine}\n${listing.csfloat_url}${suffix}`,
    `${name}! A ${st}${knifeName} ${bp} just appeared on CSFloat.\n${price} \u00b7 ${wear} \u00b7 ${float} float${seed}${rarityLine}\n\n${listing.csfloat_url}${suffix}`,
    `${name}, there's a new ${st}${knifeName} ${bp}.\nPrice: ${price} | Condition: ${wear} | Float: ${float}${seed}${rarityLine}\nLink: ${listing.csfloat_url}${suffix}`,
    `New listing: ${st}${knifeName} ${bp} (${wear})\n${price} \u2022 Float ${float}${seed}${rarityLine}\n${listing.csfloat_url}`,
    `${name} \u2014 ${st}${knifeName} ${bp} (${wear}) for ${price}\nFloat: ${float}${seed}${rarityLine}\n${listing.csfloat_url}${suffix}`,
  ];

  return pick(templates);
}

/**
 * Build a snipe alert message (more urgent tone).
 */
export function formatSnipeAlert(listing, knifeId, knifeName, userName, floorPrice) {
  const price = formatPrice(listing.price);
  const floor = formatPrice(floorPrice);
  const float = formatFloat(listing.float_value);
  const wear = listing.wear;
  const st = listing.stattrak ? 'StatTrak\u2122 ' : '';
  const pctBelow = ((1 - listing.price / floorPrice) * 100).toFixed(0);

  const name = userName || 'Hey';

  const templates = [
    `\ud83d\udea8 SNIPE ALERT \u2014 ${st}${knifeName} Black Pearl (${wear})\n${price} \u2014 that's ${pctBelow}% below the floor price of ${floor}!\nFloat: ${float} | Pattern: ${listing.paint_seed}\n${listing.csfloat_url}`,
    `${name}, potential snipe! ${st}${knifeName} BP listed at ${price} (floor is ${floor}, ${pctBelow}% below)\n${wear} \u00b7 ${float} float\n${listing.csfloat_url}`,
    `\ud83d\udea8 ${st}${knifeName} Black Pearl \u2014 ${price} (${pctBelow}% under floor!)\n${wear} | Float: ${float} | Seed: ${listing.paint_seed}\n${listing.csfloat_url}`,
  ];

  return pick(templates);
}

/**
 * Build a price drop alert message.
 */
export function formatPriceDrop(listing, knifeId, knifeName, userName, oldPrice, newPrice) {
  const old = formatPrice(oldPrice);
  const current = formatPrice(newPrice);
  const float = formatFloat(listing.float_value);
  const wear = listing.wear;
  const st = listing.stattrak ? 'StatTrak\u2122 ' : '';
  const pctDrop = ((1 - newPrice / oldPrice) * 100).toFixed(1);

  const name = userName || 'Hey';

  const templates = [
    `Price drop! ${st}${knifeName} Black Pearl (${wear}) went from ${old} \u2192 ${current} (\u2193${pctDrop}%)\nFloat: ${float}\n${listing.csfloat_url}`,
    `${name} \u2014 a ${st}${knifeName} BP you're watching dropped to ${current} (was ${old}, \u2193${pctDrop}%)\n${wear} \u00b7 ${float} float\n${listing.csfloat_url}`,
    `\ud83d\udcc9 ${st}${knifeName} BP price drop: ${old} \u2192 ${current} (${pctDrop}% off)\nCondition: ${wear} | Float: ${float}\n${listing.csfloat_url}`,
  ];

  return pick(templates);
}

/**
 * Build a batch message for multiple new listings matched in the same update.
 * One message covers all matches — reduces spam when many listings appear at once.
 */
export function formatBatch(entries, userName) {
  const name = userName ? `Hey ${userName}` : 'Hey';
  const count = entries.length;

  const greetings = [
    `${name} \u2014 ${count} new Black Pearl listings match your alerts:`,
    `${name}, ${count} new BPs just dropped matching your subscriptions:`,
    `${name}! ${count} new Black Pearl Dopplers on CSFloat:`,
    `${count} new Black Pearl matches for you, ${name.replace('Hey ', '').replace('Hey', 'there')}:`,
  ];

  let msg = pick(greetings) + '\n\n';

  for (const entry of entries.slice(0, 15)) {
    const l = entry.listing;
    const st = l.stattrak ? 'ST ' : '';
    const price = formatPrice(l.price);
    const float = formatFloat(l.float_value);
    msg += `\u2022 ${st}${entry.knife_name} (${l.wear}) \u2014 ${price} \u00b7 ${float} float\n  ${l.csfloat_url}\n`;
  }

  if (entries.length > 15) {
    msg += `\n...and ${entries.length - 15} more. Visit your dashboard for full list.`;
  }

  return msg.trim();
}

/**
 * Build a digest summary message.
 */
export function formatDigest(items, userName) {
  const name = userName ? `Hey ${userName}` : 'Hey';
  const count = items.length;

  let msg = `${name}, here's your Black Pearl listing digest \u2014 ${count} new match${count === 1 ? '' : 'es'}:\n\n`;

  for (const item of items.slice(0, 10)) {
    msg += `\u2022 ${item.message_text.split('\n')[0]}\n  ${item.message_text.split('\n').pop()}\n\n`;
  }

  if (items.length > 10) {
    msg += `...and ${items.length - 10} more. Visit ${KNIFE_MAP[items[0]?.knife_id]?.name || 'the site'} for full details.`;
  }

  return msg.trim();
}
