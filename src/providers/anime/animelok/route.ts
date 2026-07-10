import { Elysia } from "elysia";
import { Cache } from "../../../core/cache.js";
import { Anikoto } from "../anikoto/anikoto.js";
import { proxifySource } from "../../../core/proxy.js";
import type { AnikotoPagedResult, AnikotoSearchItem } from "../anikoto/types.js";

// animelok is now a transparent ALIAS of the anikoto provider. The site the
// original animelok scraper targeted was retired and every app/user was moved
// to anikoto; but older Mugen Anime builds (and Mugen Pro before Remote Config
// applies) still default to the "animelok" provider. Serving anikoto content
// under /anime/animelok/* keeps those clients working and — crucially — makes
// the ids returned here identical to /anime/anikoto/*, so a homepage card
// loaded under "animelok" resolves correctly when the detail lookup runs under
// "anikoto" (the provider switch no longer produces "not found").
//
// Cache keys deliberately reuse the `anikoto:` namespace so both prefixes share
// one cache. The old Animelok class is left in place (unused) for easy revert.

const EMPTY_PAGE: AnikotoPagedResult<AnikotoSearchItem> = {
  currentPage: 0,
  hasNextPage: false,
  totalPages: 0,
  results: [],
};

function mapWatchType(t?: string): "softsub" | "dub" | "hardsub" | undefined {
  if (t === "dub") return "dub";
  if (t === "hardsub") return "hardsub";
  if (t === "softsub" || t === "sub") return "softsub";
  // animelok's legacy language tokens (hindi/tamil/…) have no anikoto analogue;
  // fall back to the default (softsub) rather than erroring.
  return t ? "softsub" : undefined;
}

export const animelokRoutes = new Elysia({ prefix: "/animelok" })

  // ─── Search ────────────────────────────────────────────────────────────────
  .get("/search/:query", async ({ params: { query }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:search:${query}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anikoto.search(query, page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200);
    }
    return results;
  })

  // ─── Search Suggestions ────────────────────────────────────────────────────
  .get("/suggestions/:query", async ({ params: { query } }) => {
    const key = `anikoto:suggestions:${query}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Anikoto.suggestions(query);
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200);
    }
    return { results };
  })

  // ─── Trending / Popular / Top-rated → most-viewed ────────────────────────────
  .get("/trending", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:most-viewed:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Anikoto.mostViewed(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 43200);
    return results;
  })
  .get("/popular", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:most-viewed:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Anikoto.mostViewed(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 43200);
    return results;
  })
  .get("/top-rated", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:most-viewed:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Anikoto.mostViewed(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 43200);
    return results;
  })

  // ─── Seasonal → new-releases ; Upcoming → empty (anikoto has no feed) ─────────
  .get("/seasonal", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:new-releases:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Anikoto.newReleases(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 43200);
    return results;
  })
  .get("/upcoming", () => EMPTY_PAGE)

  // ─── Spotlight ───────────────────────────────────────────────────────────────
  .get("/spotlight", async () => {
    const cachedData = await Cache.get("anikoto:spotlight");
    if (cachedData) return { results: JSON.parse(cachedData) };
    const results = await Anikoto.spotlight();
    if (results && results.length > 0) {
      Cache.set("anikoto:spotlight", JSON.stringify(results), 43200);
    }
    return { results };
  })

  // ─── Recent Episodes / Added / Completed / New Releases ───────────────────────
  .get("/recent-episodes", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:recent-episodes:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Anikoto.recentlyUpdated(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 300);
    return results;
  })
  .get("/recent-added", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:recent-added:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Anikoto.recentlyAdded(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 300);
    return results;
  })
  .get("/completed", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:completed:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Anikoto.latestCompleted(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 43200);
    return results;
  })
  .get("/new-releases", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:new-releases:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Anikoto.newReleases(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 43200);
    return results;
  })

  // ─── Type feeds ────────────────────────────────────────────────────────────
  .get("/movies", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:movies:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Anikoto.movies(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 86400 * 7);
    return results;
  })
  .get("/tv", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:tv:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Anikoto.tv(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 86400 * 7);
    return results;
  })
  .get("/ova", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:ova:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Anikoto.ova(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 86400 * 7);
    return results;
  })
  .get("/ona", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:ona:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Anikoto.ona(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 86400 * 7);
    return results;
  })
  .get("/specials", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:specials:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Anikoto.specials(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 86400 * 7);
    return results;
  })

  // ─── Schedule ────────────────────────────────────────────────────────────────
  .get("/schedule/:date", async ({ params: { date } }) => {
    const key = `anikoto:schedule:${date}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };
    const results = await Anikoto.schedule(date);
    if (results && results.length > 0) Cache.set(key, JSON.stringify(results), 3600);
    return { results };
  })

  // ─── Genres ────────────────────────────────────────────────────────────────
  .get("/genres", async () => {
    const key = `anikoto:genres`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };
    const results = await Anikoto.genres();
    if (results && results.length > 0) Cache.set(key, JSON.stringify(results), 86400 * 30);
    return { results };
  })
  .get("/genre/:genre", async ({ params: { genre }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anikoto:genre:${genre}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Anikoto.genreSearch(genre, page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 86400 * 3);
    return results;
  })

  // ─── Info ────────────────────────────────────────────────────────────────────
  .get("/info/:id?", async ({ params: { id }, set }) => {
    if (!id) {
      set.status = 400;
      return { message: "id is required" };
    }
    const key = `anikoto:v4:info:${id}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const res = await Anikoto.info(id);
    if (!res) {
      set.status = 404;
      return { message: "Anime not found" };
    }
    const ttl =
      res.episodes.length === 0 ? 300 : /airing/i.test(res.status ?? "") ? 3600 : 86400 * 3;
    Cache.set(key, JSON.stringify(res), ttl);
    return res;
  })

  // ─── Watch / Stream Sources ────────────────────────────────────────────────
  .get("/watch/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }
    return await Anikoto.streams(episodeId, mapWatchType(qs?.type as string | undefined));
  })

  // ─── Episode Servers ─────────────────────────────────────────────────────────
  .get("/servers/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }
    const type = mapWatchType(qs?.type as string | undefined) ?? "hardsub";
    return { servers: await Anikoto.fetchEpisodeServers(episodeId, type) };
  })

  // ─── Self-hosted Player (iframe target) ──────────────────────────────────────
  // anikoto streams are direct m3u8s gated by a Referer the browser can't set,
  // so play the PROXIED source (server injects the Referer) with hls.js.
  .get("/player/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }
    const type = mapWatchType(qs?.type as string | undefined);
    const res = await Anikoto.streams(episodeId, type);
    const hls = res?.results?.find(
      (r: any) => r.sources?.[0]?.type === "hls" && typeof r.sources[0].file === "string",
    );
    const headers = { "content-type": "text/html; charset=utf-8" };
    if (!hls) {
      return new Response("<h3>Source unavailable</h3>", { status: 404, headers });
    }
    const src = proxifySource(hls.sources[0].file, hls.headers ?? undefined);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<style>html,body{margin:0;height:100%;background:#000}#v{width:100%;height:100%}</style>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script></head>
<body><video id="v" controls autoplay playsinline></video>
<script>var v=document.getElementById('v'),u=${JSON.stringify(src)};
if(window.Hls&&Hls.isSupported()){var h=new Hls();h.loadSource(u);h.attachMedia(v);}
else{v.src=u;}</script></body></html>`;
    return new Response(html, { headers });
  });
