import { Anivid } from "../src/providers/anime/anivid/anivid.js";
import { decryptCipherResponse } from "../src/providers/anime/anivid/scraper/decrypt.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BASE = "https://new.vidnest.fun";

function banner(s: string) {
  console.log("\n" + "═".repeat(72));
  console.log(s);
  console.log("═".repeat(72));
}
function step(n: number, s: string) {
  console.log(`\n[Step ${n}] ${s}`);
  console.log("─".repeat(72));
}

const QUERY = "jujutsu kaisen";
const EP = 1;
const TYPE: "sub" | "dub" = "sub";

banner(`FULL FLOW: anime="${QUERY}", episode=${EP}, type=${TYPE}`);

// ─── Step 1: Search ────────────────────────────────────────────────────────
step(1, `Anivid.search("${QUERY}") → Jikan v4 → AniList idMal_in enrichment`);
const search = await Anivid.search(QUERY, 1);
console.log(`  totalPages=${search.totalPages} hasNextPage=${search.hasNextPage} count=${search.results.length}`);
console.log(`  top 3:`);
search.results.slice(0, 3).forEach((r, i) =>
  console.log(`    ${i + 1}. id=${r.id.padEnd(8)} ${r.type?.padEnd(5)} ${r.title} (eps=${r.episodes})`),
);

const pick = search.results[0]!;
console.log(`\n  → picked: ${pick.title} (AniList id=${pick.id})`);

// ─── Step 2: Info ──────────────────────────────────────────────────────────
step(2, `Anivid.info("${pick.id}") → AniList GraphQL Media query`);
const info = await Anivid.info(pick.id);
if (!info) {
  console.error("FAIL: info returned null");
  process.exit(1);
}
console.log(`  title=${info.title}`);
console.log(`  malId=${info.malId} anilistId=${info.anilistId}`);
console.log(`  type=${info.type} status=${info.status} season=${info.season}`);
console.log(`  genres=${(info.genres ?? []).join(", ")}`);
console.log(`  totalEpisodes=${info.totalEpisodes} (built ${info.episodes.length} stubs)`);
console.log(`  first ep: ${JSON.stringify(info.episodes[0])}`);

const targetEp = info.episodes.find((e) => e.number === EP) ?? info.episodes[0];
if (!targetEp) {
  console.error("FAIL: no episode to stream");
  process.exit(1);
}
console.log(`\n  → picked episodeId="${targetEp.id}"`);

// ─── Step 3: Call vidnest backend (anitaku first; fall back to aniwave) ────
step(3, `Direct call to new.vidnest.fun (matches SPA's fetch path)`);

const anilistId = info.anilistId!;
const tries: Array<{ name: string; url: string; referer: string }> = [
  {
    name: "anitaku",
    url: `${BASE}/anitaku/${anilistId}/${EP}/${TYPE}/hd-2`,
    referer: "https://anitaku.to",
  },
  {
    name: "aniwave_hls",
    url: `${BASE}/aniwave_hls/${anilistId}/${EP}/${TYPE}`,
    referer: "https://aniwaves.ru/",
  },
];

let decoded: any = null;
let chosen: { name: string; referer: string } | null = null;
let envelopePeek: any = null;

for (const t of tries) {
  console.log(`\n  try ${t.name}:`);
  console.log(`    GET ${t.url}`);
  console.log(`    Referer: ${t.referer}`);
  const res = await fetch(t.url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      Referer: t.referer,
      Origin: t.referer.replace(/\/$/, ""),
    },
  });
  console.log(`    HTTP ${res.status} ${res.statusText}`);
  const clone = res.clone();
  const raw = await clone.text();
  let envelopeMeta: any = "(non-JSON)";
  try {
    const j = JSON.parse(raw);
    envelopeMeta = {
      encrypted: j?.encrypted,
      dataLen: typeof j?.data === "string" ? j.data.length : null,
      keys: Object.keys(j).slice(0, 8),
    };
  } catch {
    /* keep "(non-JSON)" */
  }
  console.log(`    raw envelope: ${JSON.stringify(envelopeMeta)}`);

  if (!res.ok) {
    console.log(`    ✗ skipping (non-2xx)`);
    continue;
  }

  // ─── Step 4 (per attempt): Decrypt ───────────────────────────────────────
  console.log(`    → decryptCipherResponse(res)`);
  try {
    const payload = await decryptCipherResponse(res);
    const sources = payload?.sources ?? payload?.multiSrc ?? [];
    console.log(`    decoded sources_count=${Array.isArray(sources) ? sources.length : "?"}`);
    if (Array.isArray(sources) && sources.length > 0) {
      decoded = payload;
      chosen = { name: t.name, referer: t.referer };
      envelopePeek = envelopeMeta;
      break;
    }
    console.log(`    ✗ empty sources, falling through`);
  } catch (err) {
    console.log(`    ✗ decrypt error: ${(err as Error).message}`);
  }
}

if (!decoded || !chosen) {
  console.error("\nFAIL: no server returned a usable payload right now.");
  console.error("(vidnest's backend has been intermittent on aniwave; anitaku may also rate-limit.)");
  process.exit(1);
}

// ─── Step 4: Inspect decoded payload ───────────────────────────────────────
step(4, `Inspect decoded payload from server="${chosen.name}"`);
const sources: any[] = decoded.sources ?? decoded.multiSrc ?? [];
console.log(`  top-level keys: ${Object.keys(decoded).join(", ")}`);
console.log(`  sources:`);
sources.forEach((s, i) => {
  console.log(
    `    [${i}] server=${s?.server ?? "-"} quality=${s?.quality ?? "-"} subs=${Array.isArray(s?.subtitles) ? s.subtitles.length : 0}`,
  );
  console.log(`        url=${typeof s?.url === "string" ? s.url : JSON.stringify(s?.url)}`);
});

// ─── Step 5: Pick the best source ──────────────────────────────────────────
step(5, `Source selection (matches SPA's preference order)`);
const picked =
  sources.find((s) => s?.server === "HD-2" && s?.url) ||
  sources.find((s) => s?.quality === "HD" && s?.url) ||
  sources.find((s) => s?.url);

if (!picked?.url) {
  console.error("FAIL: no source had a url");
  process.exit(1);
}
console.log(`  → picked: server=${picked.server ?? "-"} quality=${picked.quality ?? "-"}`);
console.log(`  m3u8 url: ${picked.url}`);
console.log(`  required playback headers:`);
console.log(`    Referer: ${chosen.referer}`);
console.log(`    User-Agent: <browser-UA>`);
const subs: any[] = Array.isArray(picked.subtitles) ? picked.subtitles : [];
console.log(`  subtitles (${subs.length}):`);
subs.slice(0, 6).forEach((u, i) => console.log(`    [${i}] ${u}`));

// ─── Step 6: Probe the m3u8 to confirm it's reachable ──────────────────────
step(6, `HEAD/GET the m3u8 to confirm playback URL works`);
const m3u8Res = await fetch(picked.url, {
  method: "GET",
  headers: {
    "User-Agent": UA,
    Accept: "*/*",
    Referer: chosen.referer,
    Origin: chosen.referer.replace(/\/$/, ""),
  },
});
console.log(`  HTTP ${m3u8Res.status} ${m3u8Res.statusText}`);
console.log(`  Content-Type: ${m3u8Res.headers.get("content-type")}`);
console.log(`  Content-Length: ${m3u8Res.headers.get("content-length") ?? "(chunked)"}`);
const body = await m3u8Res.text();
console.log(`  body length: ${body.length} chars`);
console.log(`  first 12 lines:`);
body
  .split(/\r?\n/)
  .slice(0, 12)
  .forEach((l, i) => console.log(`    ${String(i + 1).padStart(2)}| ${l}`));

const isPlaylist = body.startsWith("#EXTM3U");
console.log(`\n  → is valid m3u8 playlist? ${isPlaylist ? "YES ✓" : "NO ✗"}`);

// ─── Summary ───────────────────────────────────────────────────────────────
banner("SUMMARY");
console.log(`anime:        ${info.title}`);
console.log(`anilist id:   ${info.anilistId}`);
console.log(`episode:      ${EP} (id="${targetEp.id}")`);
console.log(`server used:  ${chosen.name}`);
console.log(`envelope:     ${JSON.stringify(envelopePeek)}`);
console.log(`final m3u8:   ${picked.url}`);
console.log(`m3u8 status:  HTTP ${m3u8Res.status}, playlist=${isPlaylist}`);
console.log(`subtitles:    ${subs.length}`);
console.log(`headers req:  Referer=${chosen.referer}`);
