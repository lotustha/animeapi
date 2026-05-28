import { Elysia } from "elysia";
import { Cache } from "../../../core/cache.js";
import { Animelok } from "./animelok.js";

export const animelokRoutes = new Elysia({ prefix: "/animelok" })

  // ─── Search ────────────────────────────────────────────────────────────────
  .get("/search/:query", async ({ params: { query }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:search:${query}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.search(query, page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200);
    }
    return results;
  })

  // ─── Search Suggestions ────────────────────────────────────────────────────
  .get("/suggestions/:query", async ({ params: { query } }) => {
    const key = `animelok:v1:suggestions:${query}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Animelok.suggestions(query);
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 1800);
    }
    return { results };
  })

  // ─── Trending ──────────────────────────────────────────────────────────────
  .get("/trending", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:trending:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.trending(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 3600);
    }
    return results;
  })

  // ─── Popular ───────────────────────────────────────────────────────────────
  .get("/popular", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:popular:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.popular(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400);
    }
    return results;
  })

  // ─── Top Rated ─────────────────────────────────────────────────────────────
  .get("/top-rated", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:top-rated:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.topRated(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400);
    }
    return results;
  })

  // ─── Seasonal (current season) ─────────────────────────────────────────────
  .get("/seasonal", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:seasonal:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.seasonal(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 21600);
    }
    return results;
  })

  // ─── Upcoming ──────────────────────────────────────────────────────────────
  .get("/upcoming", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:upcoming:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.upcoming(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200);
    }
    return results;
  })

  // ─── Spotlight ─────────────────────────────────────────────────────────────
  .get("/spotlight", async () => {
    const key = `animelok:v1:spotlight`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Animelok.spotlight();
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 3600);
    }
    return { results };
  })

  // ─── Recent Episodes (recently aired) ───────────────────────────────────────
  .get("/recent-episodes", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:recent-episodes:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.recentEpisodes(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 600);
    }
    return results;
  })

  // ─── Recently Added ──────────────────────────────────────────────────────────
  .get("/recent-added", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:recent-added:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.recentlyAdded(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 3600);
    }
    return results;
  })

  // ─── Latest Completed ──────────────────────────────────────────────────────
  .get("/completed", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:completed:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.latestCompleted(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 21600);
    }
    return results;
  })

  // ─── New Releases ──────────────────────────────────────────────────────────
  .get("/new-releases", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:new-releases:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.newReleases(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 21600);
    }
    return results;
  })

  // ─── Movies ────────────────────────────────────────────────────────────────
  .get("/movies", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:movies:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.movies(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400);
    }
    return results;
  })

  // ─── TV ────────────────────────────────────────────────────────────────────
  .get("/tv", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:tv:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.tv(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400);
    }
    return results;
  })

  // ─── OVA ───────────────────────────────────────────────────────────────────
  .get("/ova", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:ova:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.ova(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400);
    }
    return results;
  })

  // ─── ONA ───────────────────────────────────────────────────────────────────
  .get("/ona", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:ona:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.ona(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400);
    }
    return results;
  })

  // ─── Specials ──────────────────────────────────────────────────────────────
  .get("/specials", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:specials:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.specials(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400);
    }
    return results;
  })

  // ─── Schedule ──────────────────────────────────────────────────────────────
  .get("/schedule/:date", async ({ params: { date } }) => {
    const key = `animelok:v1:schedule:${date}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Animelok.schedule(date);
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 3600);
    }
    return { results };
  })

  // ─── Genres ────────────────────────────────────────────────────────────────
  .get("/genres", async () => {
    const key = `animelok:v1:genres`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Animelok.genres();
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 30);
    }
    return { results };
  })

  // ─── By Genre ──────────────────────────────────────────────────────────────
  .get("/genre/:genre", async ({ params: { genre }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animelok:v1:genre:${genre}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Animelok.genreSearch(genre, page);
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

    const key = `animelok:v1:info:${id}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const res = await Animelok.info(id);
    if (!res) {
      set.status = 404;
      return { message: "Anime not found" };
    }

    const ttl = res.status === "RELEASING" ? 1800 : 86400 * 3;
    Cache.set(key, JSON.stringify(res), ttl);
    return res;
  })

  // ─── Watch / Stream Sources ────────────────────────────────────────────────
  // No `type` → every audio language in one response (each result tagged with
  // `lang`). Pass `type` to filter: sub|dub (= japanese|english), or
  // hindi|tamil|telugu|malayalam.
  .get("/watch/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }

    const type = qs?.type as string | undefined;
    const key = `animelok:v1:watch:${episodeId}:${type ?? "all"}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const res = await Animelok.streams(episodeId, type);
    if (res && res.results && res.results.length > 0) {
      Cache.set(key, JSON.stringify(res), 7200);
    }
    return res;
  })

  // ─── Episode Servers (all audio languages) ───────────────────────────────────
  .get("/servers/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }

    const type = qs?.type as string | undefined;
    const key = `animelok:v1:servers:${episodeId}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { servers: JSON.parse(cachedData) };

    const servers = await Animelok.fetchEpisodeServers(episodeId, type);
    if (servers && servers.length > 0) {
      Cache.set(key, JSON.stringify(servers), 7200);
    }
    return { servers };
  });
