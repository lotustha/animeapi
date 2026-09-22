import { fetchWatchPage, resolveSource, readScriptString } from "../src/providers/movie-tv/nartodrama/scraper/refresh-source.js";
import { NartoDrama } from "../src/providers/movie-tv/nartodrama/nartodrama.js";

const probe = async (url: string) => {
  try {
    const r = await fetch(url);
    return `${r.status} ${r.headers.get("content-type")?.slice(0, 40)}`;
  } catch (e: any) {
    return "ERR " + e.message;
  }
};

// ── A. 1-flash-sale ep30 returned a 410 (Gone) source ───────────────────────
console.log("=== A. melolo expiring-URL case: 1-flash-sale ep30 ===");
const ctxA = await fetchWatchPage("1-flash-sale", 30);
console.log("provider app:", readScriptString(ctxA!.html, "movieSourceAppName"));

const cheap = await (async () => {
  const r = await resolveSource(ctxA!, "1-flash-sale", 30);
  return r;
})();
const cheapUrl = cheap?.play_url || cheap?.direct_play_url || "";
console.log("resolved url:", cheapUrl.slice(0, 95));
console.log("cheap source status:", await probe(cheapUrl));

// Force a fresh page + forced refresh to see if it repairs.
const ctxA2 = await fetchWatchPage("1-flash-sale", 30);
const forcedRes = await fetch(
  (() => {
    const u = new URL(ctxA2!.refreshBase);
    u.pathname = u.pathname.replace(/\/+$/, "") + "/30/refresh-source";
    if (ctxA2!.contextToken) u.searchParams.set("rs_ctx", ctxA2!.contextToken);
    u.searchParams.set("force", "1");
    u.searchParams.set("no_cache", "1");
    return ctxA2!.edgeBase.replace(/\/+$/, "") + "/e/rs" + u.pathname + u.search;
  })(),
  { headers: { "User-Agent": "Mozilla/5.0 Chrome/120.0", Accept: "application/json" } },
);
const forced: any = await forcedRes.json().catch(() => null);
const forcedUrl = forced?.play_url || forced?.direct_play_url || "";
console.log("forced url:  ", forcedUrl.slice(0, 95));
console.log("forced status:", forcedUrl ? await probe(forcedUrl) : "none");
console.log("urls differ:", forcedUrl !== cheapUrl);

// ── B. 'love' ep1 — 3 sources, first one 502 ────────────────────────────────
console.log("\n=== B. multi-source title: love ep1 ===");
const s = await NartoDrama.watch("love", 1);
console.log("source count:", s?.sources.length);
for (const [i, src] of (s?.sources ?? []).entries()) {
  const raw = decodeURIComponent(new URL(src.url).searchParams.get("url") || "");
  console.log(` [${i}] q=${src.quality} m3u8=${src.isM3U8} -> ${await probe(raw)}  ${raw.slice(0, 70)}`);
}
