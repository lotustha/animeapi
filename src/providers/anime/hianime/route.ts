import { Elysia } from "elysia";
import { Cache } from "../../../core/cache.js";
import { HiAnime } from "./hianime.js";

const intParam = (v: unknown, fallback = 1): number => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const hianimeRoutes = new Elysia({ prefix: "/hianime" })

  // ─── Home (spotlight + sections) ─────────────────────────────────────────────
  .get("/home", async () => {
    const cached = await Cache.get("hianime:home");
    if (cached) return JSON.parse(cached);
    const data = await HiAnime.home();
    if (data.spotlight.length || data.latestUpdates.length) {
      Cache.set("hianime:home", JSON.stringify(data), 600); // 10 min
    }
    return data;
  })

  // ─── Spotlight ───────────────────────────────────────────────────────────────
  .get("/spotlight", async () => {
    const cached = await Cache.get("hianime:spotlight");
    if (cached) return { results: JSON.parse(cached) };
    const results = await HiAnime.spotlight();
    if (results.length) Cache.set("hianime:spotlight", JSON.stringify(results), 43200);
    return { results };
  })

  // ─── Search ──────────────────────────────────────────────────────────────────
  .get("/search/:query", async ({ params: { query }, query: qs }) => {
    const page = intParam(qs?.page);
    const key = `hianime:search:${query}:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);
    const results = await HiAnime.search(query, page);
    if (results.results.length) Cache.set(key, JSON.stringify(results), 43200);
    return results;
  })

  .get("/suggestions/:query", async ({ params: { query } }) => {
    const key = `hianime:suggestions:${query}`;
    const cached = await Cache.get(key);
    if (cached) return { results: JSON.parse(cached) };
    const results = await HiAnime.suggestions(query);
    if (results.length) Cache.set(key, JSON.stringify(results), 1800);
    return { results };
  })

  // ─── Browsing categories ─────────────────────────────────────────────────────
  .get("/recent-episodes", async ({ query: qs }) => {
    const page = intParam(qs?.page);
    const key = `hianime:recent-episodes:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);
    const results = await HiAnime.recentlyUpdated(page);
    if (results.results.length) Cache.set(key, JSON.stringify(results), 60);
    return results;
  })

  .get("/recent-added", async ({ query: qs }) => {
    const page = intParam(qs?.page);
    const key = `hianime:recent-added:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);
    const results = await HiAnime.recentlyAdded(page);
    if (results.results.length) Cache.set(key, JSON.stringify(results), 60);
    return results;
  })

  .get("/completed", async ({ query: qs }) => {
    const page = intParam(qs?.page);
    const key = `hianime:completed:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);
    const results = await HiAnime.completed(page);
    if (results.results.length) Cache.set(key, JSON.stringify(results), 43200);
    return results;
  })

  .get("/new-releases", async ({ query: qs }) => {
    const page = intParam(qs?.page);
    const key = `hianime:new-releases:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);
    const results = await HiAnime.newReleases(page);
    if (results.results.length) Cache.set(key, JSON.stringify(results), 43200);
    return results;
  })

  .get("/movies", async ({ query: qs }) => {
    const page = intParam(qs?.page);
    const key = `hianime:movies:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);
    const results = await HiAnime.movies(page);
    if (results.results.length) Cache.set(key, JSON.stringify(results), 86400 * 7);
    return results;
  })

  .get("/tv", async ({ query: qs }) => {
    const page = intParam(qs?.page);
    const key = `hianime:tv:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);
    const results = await HiAnime.tv(page);
    if (results.results.length) Cache.set(key, JSON.stringify(results), 86400 * 7);
    return results;
  })

  .get("/ova", async ({ query: qs }) => {
    const page = intParam(qs?.page);
    const key = `hianime:ova:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);
    const results = await HiAnime.ova(page);
    if (results.results.length) Cache.set(key, JSON.stringify(results), 86400 * 7);
    return results;
  })

  .get("/ona", async ({ query: qs }) => {
    const page = intParam(qs?.page);
    const key = `hianime:ona:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);
    const results = await HiAnime.ona(page);
    if (results.results.length) Cache.set(key, JSON.stringify(results), 86400 * 7);
    return results;
  })

  .get("/specials", async ({ query: qs }) => {
    const page = intParam(qs?.page);
    const key = `hianime:specials:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);
    const results = await HiAnime.specials(page);
    if (results.results.length) Cache.set(key, JSON.stringify(results), 86400 * 7);
    return results;
  })

  // ─── Genres ──────────────────────────────────────────────────────────────────
  .get("/genres", async () => {
    const cached = await Cache.get("hianime:genres");
    if (cached) return { results: JSON.parse(cached) };
    const results = await HiAnime.genres();
    if (results.length) Cache.set("hianime:genres", JSON.stringify(results), 86400 * 30);
    return { results };
  })

  .get("/genre/:genre", async ({ params: { genre }, query: qs }) => {
    const page = intParam(qs?.page);
    const key = `hianime:genre:${genre}:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);
    const results = await HiAnime.genreSearch(genre, page);
    if (results.results.length) Cache.set(key, JSON.stringify(results), 86400 * 3);
    return results;
  })

  // ─── Info ────────────────────────────────────────────────────────────────────
  .get("/info/:id?", async ({ params: { id }, set }) => {
    if (!id) {
      set.status = 400;
      return { message: "id is required" };
    }
    const key = `hianime:info:${id}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);
    const res = await HiAnime.info(id);
    if (!res) {
      set.status = 404;
      return { message: "Anime not found" };
    }
    Cache.set(key, JSON.stringify(res), 86400 * 3);
    return res;
  })

  // ─── Watch (decrypted sources) ───────────────────────────────────────────────
  .get("/watch/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }
    const type = qs?.type as "softsub" | "dub" | "hardsub" | undefined;
    const animeSlug = episodeId.split("$")[0] ?? episodeId;
    return await HiAnime.streams(animeSlug, episodeId, type);
  })

  // ─── Episode servers (just the iframe URLs, no source extraction) ────────────
  .get("/servers/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }
    const type = qs?.type as "softsub" | "dub" | "hardsub" | undefined;
    return { servers: await HiAnime.fetchEpisodeServers(episodeId, type ?? "hardsub") };
  });
