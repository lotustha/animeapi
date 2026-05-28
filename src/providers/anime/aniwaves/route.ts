import { Elysia } from "elysia";
import { Cache } from "../../../core/cache.js";
import { Aniwaves } from "./aniwaves.js";

export const aniwavesRoutes = new Elysia({ prefix: "/aniwaves" })

  // ─── Search ────────────────────────────────────────────────────────────────
  .get("/search/:query", async ({ params: { query }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:search:${query}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Aniwaves.search(query, page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 21600);
    }
    return results;
  })

  // ─── Suggestions ─────────────────────────────────────────────────────────────
  .get("/suggestions/:query", async ({ params: { query } }) => {
    const key = `aniwaves:v1:suggestions:${query}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Aniwaves.suggestions(query);
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 1800);
    }
    return { results };
  })

  // ─── Spotlight ─────────────────────────────────────────────────────────────
  .get("/spotlight", async () => {
    const key = `aniwaves:v1:spotlight`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Aniwaves.spotlight();
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 3600);
    }
    return { results };
  })

  // ─── Browse ──────────────────────────────────────────────────────────────────
  .get("/recent-episodes", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:recent-episodes:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Aniwaves.recentEpisodes(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 600);
    return results;
  })
  .get("/recent-added", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:recent-added:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Aniwaves.recentlyAdded(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 3600);
    return results;
  })
  .get("/newest", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:newest:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Aniwaves.newest(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 3600);
    return results;
  })
  .get("/ongoing", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:ongoing:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Aniwaves.ongoing(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 3600);
    return results;
  })
  .get("/most-popular", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:most-popular:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Aniwaves.mostPopular(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 86400);
    return results;
  })
  .get("/top-airing", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:top-airing:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Aniwaves.topAiring(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 21600);
    return results;
  })
  .get("/completed", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:completed:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Aniwaves.latestCompleted(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 21600);
    return results;
  })
  .get("/movies", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:movies:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Aniwaves.movies(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 86400);
    return results;
  })
  .get("/tv", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:tv:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Aniwaves.tv(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 86400);
    return results;
  })
  .get("/ova", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:ova:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Aniwaves.ova(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 86400);
    return results;
  })
  .get("/ona", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:ona:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Aniwaves.ona(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 86400);
    return results;
  })
  .get("/specials", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:specials:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Aniwaves.specials(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 86400);
    return results;
  })
  .get("/music", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:music:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Aniwaves.music(page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 86400);
    return results;
  })

  // ─── By Genre ──────────────────────────────────────────────────────────────
  .get("/genre/:genre", async ({ params: { genre }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `aniwaves:v1:genre:${genre}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);
    const results = await Aniwaves.genreSearch(genre, page);
    if (results?.results?.length) Cache.set(key, JSON.stringify(results), 86400 * 3);
    return results;
  })

  // ─── Anime Info ────────────────────────────────────────────────────────────
  .get("/info/:id?", async ({ params: { id }, set }) => {
    if (!id) {
      set.status = 400;
      return { message: "id is required" };
    }
    const key = `aniwaves:v1:info:${id}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const res = await Aniwaves.info(id);
    if (!res) {
      set.status = 404;
      return { message: "Anime not found" };
    }
    Cache.set(key, JSON.stringify(res), 86400);
    return res;
  })

  // ─── Watch / Stream Sources ────────────────────────────────────────────────
  // `type` selects the variant: sub (hardsub) | softsub | dub. Returns the
  // framable embed URL as `iframe` per server + intro/outro skip data.
  .get("/watch/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }
    const type = (qs?.type as string) || "sub";
    const key = `aniwaves:v1:watch:${episodeId}:${type}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const res = await Aniwaves.streams(episodeId, type);
    if (res?.results?.length) Cache.set(key, JSON.stringify(res), 3600);
    return res;
  })

  // ─── Episode Servers ─────────────────────────────────────────────────────────
  .get("/servers/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }
    const type = (qs?.type as string) || "sub";
    const key = `aniwaves:v1:servers:${episodeId}:${type}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { servers: JSON.parse(cachedData) };

    const servers = await Aniwaves.fetchEpisodeServers(episodeId, type);
    if (servers?.length) Cache.set(key, JSON.stringify(servers), 3600);
    return { servers };
  });
