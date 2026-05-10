import { Elysia } from "elysia";
import { Cache } from "../../../core/cache.js";
import { Anivid } from "./anivid.js";

export const anividRoutes = new Elysia({ prefix: "/anivid" })

  // ─── Search ────────────────────────────────────────────────────────────────
  .get("/search/:query", async ({ params: { query }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anivid:v1:search:${query}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anivid.search(query, page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200);
    }
    return results;
  })

  // ─── Search Suggestions ────────────────────────────────────────────────────
  .get("/suggestions/:query", async ({ params: { query } }) => {
    const key = `anivid:v1:suggestions:${query}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Anivid.suggestions(query);
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 1800);
    }
    return { results };
  })

  // ─── Trending ──────────────────────────────────────────────────────────────
  .get("/trending", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anivid:v1:trending:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anivid.trending(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 3600);
    }
    return results;
  })

  // ─── Popular ───────────────────────────────────────────────────────────────
  .get("/popular", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anivid:v1:popular:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anivid.popular(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400);
    }
    return results;
  })

  // ─── Top Rated ─────────────────────────────────────────────────────────────
  .get("/top-rated", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anivid:v1:top-rated:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anivid.topRated(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400);
    }
    return results;
  })

  // ─── Seasonal (current season) ─────────────────────────────────────────────
  .get("/seasonal", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anivid:v1:seasonal:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anivid.seasonal(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 21600);
    }
    return results;
  })

  // ─── Upcoming ──────────────────────────────────────────────────────────────
  .get("/upcoming", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anivid:v1:upcoming:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anivid.upcoming(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200);
    }
    return results;
  })

  // ─── Schedule ──────────────────────────────────────────────────────────────
  .get("/schedule/:date", async ({ params: { date } }) => {
    const key = `anivid:v1:schedule:${date}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Anivid.schedule(date);
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 3600);
    }
    return { results };
  })

  // ─── Genres ────────────────────────────────────────────────────────────────
  .get("/genres", async () => {
    const key = `anivid:v1:genres`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Anivid.genres();
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 30);
    }
    return { results };
  })

  // ─── By Genre ──────────────────────────────────────────────────────────────
  .get("/genre/:genre", async ({ params: { genre }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anivid:v1:genre:${genre}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anivid.genreSearch(genre, page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 3);
    }
    return results;
  })

  // ─── Anime Info ────────────────────────────────────────────────────────────
  .get("/info/:id?", async ({ params: { id }, set }) => {
    if (!id) {
      set.status = 400;
      return { message: "id is required" };
    }

    const key = `anivid:v1:info:${id}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const res = await Anivid.info(id);
    if (!res) {
      set.status = 404;
      return { message: "Anime not found" };
    }

    // Currently airing → short TTL so episode count stays fresh.
    const ttl = res.status === "RELEASING" ? 1800 : 86400 * 3;
    Cache.set(key, JSON.stringify(res), ttl);
    return res;
  })

  // ─── Watch / Stream Sources ────────────────────────────────────────────────
  .get("/watch/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }

    const type = qs?.type as "softsub" | "dub" | "hardsub" | undefined;
    return await Anivid.streams(episodeId, type);
  })

  // ─── Episode Servers ───────────────────────────────────────────────────────
  .get("/servers/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }

    const type = qs?.type as "softsub" | "dub" | "hardsub" | undefined;
    return {
      servers: await Anivid.fetchEpisodeServers(episodeId, type ?? "hardsub"),
    };
  });
