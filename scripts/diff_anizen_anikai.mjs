// Exhaustively compares /anime/anizen/* vs /anime/animekai/* for shape parity.
// Prints per-endpoint diffs of (a) top-level keys and (b) sample item keys
// (and inner keys for nested arrays like episodes / recommendations / relations).

const BASE = "http://localhost:3000";

const PAIRS = [
  { name: "spotlight", path: "/spotlight" },
  { name: "schedule", path: "/schedule/2026-05-09" },
  { name: "suggestions", path: "/suggestions/naruto" },
  { name: "search", path: "/search/naruto" },
  { name: "recent-episodes", path: "/recent-episodes" },
  { name: "recent-added", path: "/recent-added" },
  { name: "completed", path: "/completed" },
  { name: "new-releases", path: "/new-releases" },
  { name: "movies", path: "/movies" },
  { name: "tv", path: "/tv" },
  { name: "ova", path: "/ova" },
  { name: "ona", path: "/ona" },
  { name: "specials", path: "/specials" },
  { name: "genres", path: "/genres" },
  { name: "genre/action", path: "/genre/action" },
];

// /info needs slugs that exist on each provider — handled separately.
const INFO = {
  anikai: "/info/one-piece-dk6r",
  anizen: "/info/one-piece-odmau",
};

const keysOf = (v) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).sort() : null;

const diffSets = (a, b) => {
  const A = new Set(a || []),
    B = new Set(b || []);
  return {
    onlyInAnikai: [...A].filter((k) => !B.has(k)),
    onlyInAnizen: [...B].filter((k) => !A.has(k)),
    common: [...A].filter((k) => B.has(k)),
  };
};

const fmt = (label, d) =>
  `  ${label}: anikai-only=[${d.onlyInAnikai.join(",")}]  anizen-only=[${d.onlyInAnizen.join(",")}]  common=${d.common.length}`;

const sample = (j) =>
  Array.isArray(j) ? j[0] : j?.results?.[0] || j?.data?.[0] || null;

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function compare(name, path) {
  let ak, az;
  try {
    [ak, az] = await Promise.all([
      fetchJson(BASE + "/anime/animekai" + path),
      fetchJson(BASE + "/anime/anizen" + path),
    ]);
  } catch (e) {
    console.log(`=== ${name} === FETCH ERROR: ${e.message}`);
    return;
  }
  const topDiff = diffSets(keysOf(ak), keysOf(az));
  const akS = sample(ak),
    azS = sample(az);
  const itemDiff = diffSets(keysOf(akS), keysOf(azS));
  const status =
    topDiff.onlyInAnikai.length + topDiff.onlyInAnizen.length + itemDiff.onlyInAnikai.length + itemDiff.onlyInAnizen.length === 0
      ? "✓ MATCH"
      : "✗ DIFF";
  console.log(`=== ${name} === ${status}`);
  console.log(fmt("top  ", topDiff));
  console.log(fmt("item ", itemDiff));
  // sample-item types
  if (akS && azS) {
    const both = itemDiff.common;
    const typeMismatch = both.filter((k) => typeof akS[k] !== typeof azS[k]);
    if (typeMismatch.length)
      console.log(
        `  type-mismatch: ${typeMismatch
          .map((k) => `${k}(ak=${typeof akS[k]} az=${typeof azS[k]})`)
          .join(", ")}`,
      );
  }
}

async function compareInfo() {
  let ak, az;
  try {
    [ak, az] = await Promise.all([
      fetchJson(BASE + "/anime/animekai" + INFO.anikai),
      fetchJson(BASE + "/anime/anizen" + INFO.anizen),
    ]);
  } catch (e) {
    console.log(`=== info === FETCH ERROR: ${e.message}`);
    return;
  }
  const topDiff = diffSets(keysOf(ak), keysOf(az));
  console.log(`=== info ===`);
  console.log(fmt("top  ", topDiff));
  for (const subkey of ["episodes", "recommendations", "relations"]) {
    const a = ak?.[subkey]?.[0];
    const z = az?.[subkey]?.[0];
    if (!a && !z) continue;
    const d = diffSets(keysOf(a), keysOf(z));
    console.log(fmt(`${subkey}[0]`, d));
  }
}

async function compareWatchAndServers() {
  // Get an episode id from each provider's info, then exercise watch/servers
  for (const provider of ["animekai", "anizen"]) {
    const slug = provider === "animekai" ? INFO.anikai.replace("/info/", "") : INFO.anizen.replace("/info/", "");
    try {
      const info = await fetchJson(`${BASE}/anime/${provider}/info/${slug}`);
      const epid = info?.episodes?.[0]?.id;
      if (!epid) {
        console.log(`=== ${provider} watch/servers === SKIP (no episode id)`);
        continue;
      }
      const enc = encodeURIComponent(epid);
      const [w, s] = await Promise.all([
        fetchJson(`${BASE}/anime/${provider}/watch/${enc}`),
        fetchJson(`${BASE}/anime/${provider}/servers/${enc}`),
      ]);
      console.log(`=== ${provider} watch ===`);
      console.log(`  top keys: ${keysOf(w)?.join(",")}`);
      console.log(`  results[0] keys: ${keysOf(w?.results?.[0])?.join(",") || "(none)"}`);
      console.log(`=== ${provider} servers ===`);
      console.log(`  top keys: ${keysOf(s)?.join(",")}`);
      console.log(`  servers[0] keys: ${keysOf(s?.servers?.[0])?.join(",") || "(none)"}`);
    } catch (e) {
      console.log(`=== ${provider} watch/servers === ERROR: ${e.message}`);
    }
  }
}

(async () => {
  for (const p of PAIRS) await compare(p.name, p.path);
  await compareInfo();
  await compareWatchAndServers();
})();
