import { Elysia } from "elysia";
import { Cache } from "../../../core/cache.js";
import { Anigo } from "./anigo.js";

export const anigoRoutes = new Elysia({ prefix: "/anigo" })

  // ─── Search ────────────────────────────────────────────────────────────────
  .get("/search/:query", async ({ params: { query }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anigo:search:${query}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anigo.search(query, page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200); // 12 hours
    }
    return results;
  })

  // ─── Spotlight ─────────────────────────────────────────────────────────────
  .get("/spotlight", async () => {
    const cachedData = await Cache.get("anigo:spotlight");
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Anigo.spotlight();
    if (results && results.length > 0) {
      Cache.set("anigo:spotlight", JSON.stringify(results), 43200); // 12 hours
    }
    return { results };
  })

  // ─── Schedule ──────────────────────────────────────────────────────────────
  .get("/schedule/:date", async ({ params: { date } }) => {
    const key = `anigo:schedule:${date}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Anigo.schedule(date);
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200); // 12 hours
    }
    return { results };
  })

  // ─── Search Suggestions ────────────────────────────────────────────────────
  .get("/suggestions/:query", async ({ params: { query } }) => {
    const key = `anigo:suggestions:${query}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Anigo.suggestions(query);
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200); // 12 hours
    }
    return { results };
  })

  // ─── Recent Episodes (recently updated) ────────────────────────────────────
  .get("/recent-episodes", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anigo:recent-episodes:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anigo.recentlyUpdated(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 60); // 1 minute for recent episodes
    }
    return results;
  })

  // ─── Recently Added ────────────────────────────────────────────────────────
  .get("/recent-added", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anigo:recent-added:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anigo.recentlyAdded(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 60); // 1 minute for recently added
    }
    return results;
  })

  // ─── Latest Completed ──────────────────────────────────────────────────────
  .get("/completed", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anigo:completed:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anigo.latestCompleted(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200);
    }
    return results;
  })

  // ─── New Releases ──────────────────────────────────────────────────────────
  .get("/new-releases", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anigo:new-releases:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anigo.newReleases(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200);
    }
    return results;
  })

  // ─── Movies ────────────────────────────────────────────────────────────────
  .get("/movies", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anigo:movies:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anigo.movies(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7); // 7 days
    }
    return results;
  })

  // ─── TV ────────────────────────────────────────────────────────────────────
  .get("/tv", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anigo:tv:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anigo.tv(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7);
    }
    return results;
  })

  // ─── OVA ───────────────────────────────────────────────────────────────────
  .get("/ova", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anigo:ova:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anigo.ova(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7);
    }
    return results;
  })

  // ─── ONA ───────────────────────────────────────────────────────────────────
  .get("/ona", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anigo:ona:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anigo.ona(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7);
    }
    return results;
  })

  // ─── Specials ──────────────────────────────────────────────────────────────
  .get("/specials", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anigo:specials:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anigo.specials(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7);
    }
    return results;
  })

  // ─── Genre List ────────────────────────────────────────────────────────────
  .get("/genres", async () => {
    const key = `anigo:genres`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Anigo.genres();
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 30); // 30 days
    }
    return { results };
  })

  // ─── By Genre ──────────────────────────────────────────────────────────────
  .get("/genre/:genre", async ({ params: { genre }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `anigo:genre:${genre}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Anigo.genreSearch(genre, page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 3); // 3 days
    }
    return results;
  })

  // ─── Anime Info ────────────────────────────────────────────────────────────
  .get("/info/:id?", async ({ params: { id }, set }) => {
    if (!id) {
      set.status = 400;
      return { message: "id is required" };
    }

    const key = `anigo:info:${id}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const res = await Anigo.info(id);
    if (!res) {
      set.status = 404;
      return { message: "Anime not found" };
    }

    Cache.set(key, JSON.stringify(res), 86400 * 3); // 3 days for info
    return res;
  })

  // ─── Watch / Stream Sources ────────────────────────────────────────────────
  .get("/watch/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }

    const type = qs?.type as "softsub" | "dub" | "hardsub" | undefined;
    const animeSlug = episodeId.split("$")[0] ?? episodeId;

    // Return the response directly as it's already structured perfectly
    return await Anigo.streams(animeSlug, episodeId, type);
  })

  // ─── Episode Servers ───────────────────────────────────────────────────────
  .get("/servers/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }

    const type = qs?.type as "softsub" | "dub" | "hardsub" | undefined;
    return {
      servers: await Anigo.fetchEpisodeServers(episodeId, type ?? "hardsub"),
    };
  });
