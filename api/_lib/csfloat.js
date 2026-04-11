const API_BASE = 'https://csfloat.com/api/v1';

export const KNIVES = [
  { id: 'karambit',   name: 'Karambit',        def_index: 507, paint_index: 417 },
  { id: 'butterfly',  name: 'Butterfly Knife',  def_index: 515, paint_index: 617 },
  { id: 'm9',         name: 'M9 Bayonet',       def_index: 508, paint_index: 417 },
  { id: 'bayonet',    name: 'Bayonet',          def_index: 500, paint_index: 417 },
  { id: 'flip',       name: 'Flip Knife',       def_index: 505, paint_index: 417 },
  { id: 'gut',        name: 'Gut Knife',        def_index: 506, paint_index: 417 },
  { id: 'huntsman',   name: 'Huntsman Knife',   def_index: 509, paint_index: 417 },
  { id: 'bowie',      name: 'Bowie Knife',      def_index: 514, paint_index: 417 },
  { id: 'falchion',   name: 'Falchion Knife',   def_index: 512, paint_index: 417 },
  { id: 'stiletto',   name: 'Stiletto Knife',   def_index: 522, paint_index: 417 },
  { id: 'talon',      name: 'Talon Knife',      def_index: 523, paint_index: 417 },
  { id: 'skeleton',   name: 'Skeleton Knife',   def_index: 525, paint_index: 417 },
  { id: 'navaja',     name: 'Navaja Knife',     def_index: 520, paint_index: 417 },
  { id: 'ursus',      name: 'Ursus Knife',      def_index: 519, paint_index: 417 },
  { id: 'shadow',     name: 'Shadow Daggers',   def_index: 516, paint_index: 617 },
  { id: 'paracord',   name: 'Paracord Knife',   def_index: 517, paint_index: 417 },
  { id: 'survival',   name: 'Survival Knife',   def_index: 518, paint_index: 417 },
  { id: 'nomad',      name: 'Nomad Knife',      def_index: 521, paint_index: 417 },
];

function wearFromFloat(f) {
  if (f <= 0.07) return 'FN';
  if (f <= 0.15) return 'MW';
  if (f <= 0.38) return 'FT';
  if (f <= 0.45) return 'WW';
  return 'BS';
}

async function apiFetch(url, apiKey, retries = 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': apiKey },
      signal: controller.signal,
    });

    if (res.status === 429) {
      if (retries > 0) {
        clearTimeout(timeout);
        await new Promise(r => setTimeout(r, 3000));
        return apiFetch(url, apiKey, retries - 1);
      }
      throw new Error('CSFloat rate limited (429)');
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`CSFloat API ${res.status}: ${text}`);
    }

    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAllListings(defIndex, paintIndex, apiKey) {
  // Only fetch first page on Vercel to stay within timeout
  const url = `${API_BASE}/listings?def_index=${defIndex}&paint_index=${paintIndex}&limit=50&page=0&sort_by=lowest_price`;
  const data = await apiFetch(url, apiKey);
  return data?.data ?? [];
}

function transformListings(rawListings) {
  const byWear = { FN: [], MW: [], FT: [], WW: [], BS: [] };

  const listings = rawListings.map(l => {
    const item = l.item ?? {};
    const float = item.float_value ?? 0;
    const wear = wearFromFloat(float);
    const priceUSD = (l.price ?? 0) / 100;

    byWear[wear].push(priceUSD);

    return {
      id: l.id,
      price: priceUSD,
      wear,
      float_value: float,
      paint_seed: item.paint_seed ?? null,
      stattrak: item.is_stattrak ?? false,
      csfloat_url: `https://csfloat.com/item/${l.id}`,
      inspect_link: item.inspect_link || item.serialized_inspect || null,
      image_url: item.icon_url
        ? `https://community.akamai.steamstatic.com/economy/image/${item.icon_url}/360fx360f`
        : null,
      seller: l.seller
        ? {
            steam_id: l.seller.steam_id ?? null,
            username: l.seller.username ?? null,
            avatar: l.seller.avatar ?? null,
            stall_url: l.seller.steam_id
              ? `https://csfloat.com/stall/${l.seller.steam_id}`
              : null,
          }
        : null,
    };
  });

  const floorPrice = {};
  for (const [wear, prices] of Object.entries(byWear)) {
    floorPrice[wear] = prices.length > 0 ? Math.min(...prices) : null;
  }

  const floats = listings.map(l => l.float_value).filter(f => f > 0);
  const floatMin = floats.length ? Math.min(...floats) : null;
  const floatMax = floats.length ? Math.max(...floats) : null;

  return {
    count: listings.length,
    floor_prices: floorPrice,
    float_min: floatMin,
    float_max: floatMax,
    listings: listings.slice(0, 20),
  };
}

export async function fetchBlackPearls(knifeId) {
  const apiKey = process.env.CSFLOAT_API_KEY;
  if (!apiKey) throw new Error('Missing CSFLOAT_API_KEY environment variable');

  const knife = KNIVES.find(k => k.id === knifeId);
  if (!knife) throw new Error(`Unknown knife id: ${knifeId}`);

  const raw = await fetchAllListings(knife.def_index, knife.paint_index, apiKey);
  const dbUrl = `https://csfloat.com/db?defIndex=${knife.def_index}&paintIndex=${knife.paint_index}`;
  return { knife_id: knifeId, knife_name: knife.name, csfloat_db_url: dbUrl, ...transformListings(raw) };
}
