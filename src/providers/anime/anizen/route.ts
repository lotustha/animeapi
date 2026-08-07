import { Elysia } from "elysia";
import { Cache } from "../../../core/cache.js";
import { Anizen } from "./anizen.js";
import type { AnizenTypeParam } from "./types.js";

export const anizenRoutes = new Elysia({ prefix: "/anizen" })

  // ─── Search ────────────────────────────────────────────────────────────────
  .get("/search/:query", async ({ params: { query }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anizen:v3:search:${query}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anizen.search(query, page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200);
    }
    return results;
  })

  // ─── Spotlight ─────────────────────────────────────────────────────────────
  .get("/spotlight", async () => {
    // Short TTL: spotlight sub/dub counts move daily as new episodes air.
    const cachedData = await Cache.get("anizen:v4:spotlight");
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Anizen.spotlight();
    if (results && results.length > 0) {
      Cache.set("anizen:v4:spotlight", JSON.stringify(results), 3600);
    }
    return { results };
  })

  // ─── Schedule ──────────────────────────────────────────────────────────────
  .get("/schedule/:date", async ({ params: { date } }) => {
    const key = `anizen:v3:schedule:${date}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Anizen.schedule(date);
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200);
    }
    return { results };
  })

  // ─── Search Suggestions ────────────────────────────────────────────────────
  .get("/suggestions/:query", async ({ params: { query } }) => {
    const key = `anizen:v3:suggestions:${query}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Anizen.suggestions(query);
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 1800);
    }
    return { results };
  })

  // ─── Recent Episodes (recently updated) ────────────────────────────────────
  .get("/recent-episodes", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anizen:v3:recent-episodes:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anizen.recentlyUpdated(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 60);
    }
    return results;
  })

  // ─── Recently Added ────────────────────────────────────────────────────────
  .get("/recent-added", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anizen:v3:recent-added:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anizen.recentlyAdded(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 60);
    }
    return results;
  })

  // ─── Latest Completed ──────────────────────────────────────────────────────
  .get("/completed", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anizen:v3:completed:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anizen.latestCompleted(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200);
    }
    return results;
  })

  // ─── New Releases ──────────────────────────────────────────────────────────
  .get("/new-releases", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anizen:v3:new-releases:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anizen.newReleases(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200);
    }
    return results;
  })

  // ─── Movies ────────────────────────────────────────────────────────────────
  .get("/movies", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anizen:v3:movies:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anizen.movies(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7);
    }
    return results;
  })

  // ─── TV ────────────────────────────────────────────────────────────────────
  .get("/tv", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anizen:v3:tv:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anizen.tv(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7);
    }
    return results;
  })

  // ─── OVA ───────────────────────────────────────────────────────────────────
  .get("/ova", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anizen:v3:ova:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anizen.ova(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7);
    }
    return results;
  })

  // ─── ONA ───────────────────────────────────────────────────────────────────
  .get("/ona", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anizen:v3:ona:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anizen.ona(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7);
    }
    return results;
  })

  // ─── Specials ──────────────────────────────────────────────────────────────
  .get("/specials", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anizen:v3:specials:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anizen.specials(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7);
    }
    return results;
  })

  // ─── Genre List ────────────────────────────────────────────────────────────
  .get("/genres", async () => {
    const key = `anizen:v3:genres`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Anizen.genres();
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 30);
    }
    return { results };
  })

  // ─── By Genre ──────────────────────────────────────────────────────────────
  .get("/genre/:genre", async ({ params: { genre }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anizen:v3:genre:${genre}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anizen.genreSearch(genre, page);
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

    const key = `anizen:v4:info:${id}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const res = await Anizen.info(id);
    if (!res) {
      set.status = 404;
      return { message: "Anime not found" };
    }

    // A 3-day TTL poisons new/airing shows: an entry cached before an episode
    // is indexed keeps saying "no episodes" for days. Cache empty episode
    // lists briefly and airing shows hourly; only finished shows get 3 days.
    const ttl =
      res.episodes.length === 0
        ? 300
        : /currently airing/i.test(res.status ?? "")
          ? 3600
          : 86400 * 3;
    Cache.set(key, JSON.stringify(res), ttl);
    return res;
  })

  // ─── Watch / Stream Sources ────────────────────────────────────────────────
  .get("/watch/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }

    // type: sub|softsub (default), dub, hindi, hsub, hardsub (legacy alias of sub)
    const type = qs?.type as AnizenTypeParam | undefined;
    return await Anizen.streams(episodeId, type);
  })

  // ─── Episode Servers ───────────────────────────────────────────────────────
  .get("/servers/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }

    const type = qs?.type as AnizenTypeParam | undefined;
    return {
      servers: await Anizen.fetchEpisodeServers(episodeId, type ?? "hardsub"),
    };
  });
