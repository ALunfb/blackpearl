#!/usr/bin/env node
/**
 * Reads data/listings.json, decodes every masked inspect link, and writes:
 *   - data/enriched-listings.json — listings with a `decoded` field where possible
 *   - data/stattrak-hall-of-fame.json — StatTrak kill leaderboards per knife + all-time
 *   - data/named-black-pearls.json — listings with custom names
 *   - data/item-passport.json — per-itemid seen history (appended each run)
 *
 * Safe to run repeatedly. Does NOT hit any remote API — pure client-side decode.
 * Meant to run AFTER fetch-data.mjs, but can also run independently against the
 * existing data/listings.json while the main fetcher is paused.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decodeLink } from '@csfloat/cs2-inspect-serializer';
import { detectLinkFormat, normalizeDecoded, originLabel } from './inspect-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');

const IN_FILE = path.join(DATA, 'listings.json');
const OUT_ENRICHED = path.join(DATA, 'enriched-listings.json');
const OUT_STATTRAK = path.join(DATA, 'stattrak-hall-of-fame.json');
const OUT_NAMED = path.join(DATA, 'named-black-pearls.json');
const OUT_PASSPORT = path.join(DATA, 'item-passport.json');

const TOP_N_STATTRAK = 10;
const PASSPORT_MAX_ENTRIES_PER_ITEM = 100;

// ── Decode pass ────────────────────────────────────────────────
function tryDecode(link) {
  if (!link) return null;
  const format = detectLinkFormat(link);
  if (format !== 'masked') return { format };
  try {
    const raw = decodeLink(decodeURIComponent(link));
    const norm = normalizeDecoded(raw);
    return { format, raw, norm };
  } catch (err) {
    return { format, error: err.message };
  }
}

// ── Main ───────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(IN_FILE)) {
    console.error(`Missing ${IN_FILE} — run fetch-data.mjs first`);
    process.exit(1);
  }

  const input = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));
  const fetchedAt = input.fetched_at || new Date().toISOString();

  let stats = { total: 0, masked: 0, unmasked: 0, decoded: 0, errored: 0, stattrak: 0, named: 0 };

  // Collect cross-cutting datasets while we iterate.
  const stattrakByKnife = {};          // knife_id → [{kills, ...}]
  const stattrakAllTime = [];          // top-N overall
  const named = [];                    // items with customname
  const passportSnapshot = {};         // itemid → { lastSeenAt, lastPrice, lastFloat, lastSeed, lastKills, lastName }

  const enrichedKnives = input.knives.map(knife => {
    const enrichedListings = (knife.listings || []).map(l => {
      stats.total++;
      const result = tryDecode(l.inspect_link);

      const decoded_meta = {
        decoded: false,
        format: result?.format || 'invalid',
      };

      if (!result) return { ...l, decoded_meta };

      if (result.format === 'masked') {
        stats.masked++;
        if (result.norm) {
          stats.decoded++;
          const n = result.norm;
          decoded_meta.decoded = true;
          decoded_meta.stattrak_kills = n.stattrak_kills;
          decoded_meta.custom_name = n.custom_name;
          decoded_meta.origin = n.origin;
          decoded_meta.origin_label = n.origin_label;
          decoded_meta.itemid = n.itemid;
          decoded_meta.rarity = n.rarity;
          decoded_meta.quality = n.quality;
          decoded_meta.sticker_count = n.stickers.length;
          decoded_meta.keychain_count = n.keychains.length;

          // StatTrak tracking
          if (n.is_stattrak && typeof n.stattrak_kills === 'number') {
            stats.stattrak++;
            const entry = {
              knife_id: knife.knife_id,
              knife_name: knife.knife_name,
              listing_id: l.id,
              csfloat_url: l.csfloat_url,
              price: l.price,
              float: l.float_value,
              seed: l.paint_seed,
              wear: l.wear,
              kills: n.stattrak_kills,
              image_url: l.image_url,
              custom_name: n.custom_name,
              itemid: n.itemid,
              seller: l.seller || null,
              observed_at: fetchedAt,
            };
            (stattrakByKnife[knife.knife_id] ??= []).push(entry);
            stattrakAllTime.push(entry);
          }

          // Named tracking
          if (n.custom_name) {
            stats.named++;
            named.push({
              knife_id: knife.knife_id,
              knife_name: knife.knife_name,
              listing_id: l.id,
              csfloat_url: l.csfloat_url,
              price: l.price,
              float: l.float_value,
              seed: l.paint_seed,
              wear: l.wear,
              stattrak: l.stattrak,
              stattrak_kills: n.stattrak_kills,
              custom_name: n.custom_name,
              image_url: l.image_url,
              itemid: n.itemid,
              seller: l.seller || null,
              observed_at: fetchedAt,
            });
          }

          // Passport snapshot — keyed by a fingerprint (knife + seed + exact
          // float + stattrak). Masked links don't encode itemid, so we fall
          // back to the same fingerprint approach listings-tracker.mjs uses.
          if (typeof l.float_value === 'number' && l.paint_seed != null) {
            const fingerprint = `${knife.knife_id}_${l.paint_seed}_${l.float_value.toFixed(10)}_${l.stattrak ? 'st' : 'nt'}`;
            passportSnapshot[fingerprint] = {
              fingerprint,
              knife_id: knife.knife_id,
              knife_name: knife.knife_name,
              listing_id: l.id,
              csfloat_url: l.csfloat_url,
              price: l.price,
              float: l.float_value,
              seed: l.paint_seed,
              wear: l.wear,
              stattrak: l.stattrak,
              stattrak_kills: n.stattrak_kills,
              custom_name: n.custom_name,
              image_url: l.image_url,
              origin: n.origin,
              origin_label: n.origin_label,
              observed_at: fetchedAt,
            };
          }
        } else if (result.error) {
          stats.errored++;
          decoded_meta.error = result.error;
        }
      } else if (result.format === 'unmasked') {
        stats.unmasked++;
      }

      return { ...l, decoded_meta };
    });

    return { ...knife, listings: enrichedListings };
  });

  // ── StatTrak Hall of Fame ─────────────────────────────────────
  // Per-knife top N and all-time top N by kill count.
  const stattrakOutput = {
    updated_at: fetchedAt,
    per_knife: {},
    all_time_top: stattrakAllTime
      .sort((a, b) => b.kills - a.kills)
      .slice(0, TOP_N_STATTRAK * 3),
    fresh_stattrak: stattrakAllTime
      .filter(e => e.kills < 100)
      .sort((a, b) => a.kills - b.kills)
      .slice(0, TOP_N_STATTRAK * 3),
  };
  for (const [knifeId, entries] of Object.entries(stattrakByKnife)) {
    stattrakOutput.per_knife[knifeId] = {
      total: entries.length,
      highest_kills: entries.slice().sort((a, b) => b.kills - a.kills).slice(0, TOP_N_STATTRAK),
      lowest_kills: entries.slice().sort((a, b) => a.kills - b.kills).slice(0, TOP_N_STATTRAK),
    };
  }

  // ── Passport persistence ───────────────────────────────────────
  // Load existing passport, append new observations (dedup identical snapshots).
  let passport = {};
  if (fs.existsSync(OUT_PASSPORT)) {
    try { passport = JSON.parse(fs.readFileSync(OUT_PASSPORT, 'utf8')); } catch { passport = {}; }
  }
  passport.items ??= {};
  passport.updated_at = fetchedAt;

  for (const [fp, snap] of Object.entries(passportSnapshot)) {
    const record = passport.items[fp] ??= {
      fingerprint: fp,
      knife_id: snap.knife_id,
      knife_name: snap.knife_name,
      float: snap.float,
      seed: snap.seed,
      stattrak: snap.stattrak,
      observations: [],
    };
    // Only append when price, kills, custom_name, or owner changed (or first time).
    const last = record.observations[record.observations.length - 1];
    const changed = !last ||
      last.price !== snap.price ||
      last.stattrak_kills !== snap.stattrak_kills ||
      last.custom_name !== snap.custom_name ||
      last.listing_id !== snap.listing_id;
    if (changed) {
      record.observations.push({
        observed_at: snap.observed_at,
        listing_id: snap.listing_id,
        csfloat_url: snap.csfloat_url,
        price: snap.price,
        stattrak_kills: snap.stattrak_kills,
        custom_name: snap.custom_name,
      });
      // Cap history length per item.
      if (record.observations.length > PASSPORT_MAX_ENTRIES_PER_ITEM) {
        record.observations = record.observations.slice(-PASSPORT_MAX_ENTRIES_PER_ITEM);
      }
    }
    // Keep current display fields fresh.
    record.last_seen = snap;
  }

  // ── Named Black Pearl registry ────────────────────────────────
  const namedOutput = {
    updated_at: fetchedAt,
    count: named.length,
    items: named.sort((a, b) => (b.price ?? 0) - (a.price ?? 0)),
  };

  // ── Enriched listings ─────────────────────────────────────────
  const enrichedOutput = {
    fetched_at: fetchedAt,
    enriched_at: new Date().toISOString(),
    stats,
    knives: enrichedKnives,
  };

  // Write all outputs.
  fs.writeFileSync(OUT_ENRICHED, JSON.stringify(enrichedOutput, null, 2));
  fs.writeFileSync(OUT_STATTRAK, JSON.stringify(stattrakOutput, null, 2));
  fs.writeFileSync(OUT_NAMED, JSON.stringify(namedOutput, null, 2));
  fs.writeFileSync(OUT_PASSPORT, JSON.stringify(passport, null, 2));

  console.log(`Enriched ${stats.total} listings:`);
  console.log(`  Masked (decodable): ${stats.masked} (${stats.decoded} decoded, ${stats.errored} errored)`);
  console.log(`  Unmasked (S/A/D):   ${stats.unmasked}`);
  console.log(`  StatTrak items:     ${stats.stattrak}`);
  console.log(`  Named items:        ${stats.named}`);
  console.log(`  Passport items:     ${Object.keys(passport.items).length}`);
  console.log(`\nWrote:`);
  for (const f of [OUT_ENRICHED, OUT_STATTRAK, OUT_NAMED, OUT_PASSPORT]) {
    console.log(`  ${path.relative(__dirname, f)}`);
  }
}

main();
