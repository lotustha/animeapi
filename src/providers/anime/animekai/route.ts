import { Elysia } from "elysia";
import { Cache } from "../../../core/cache.js";
import { AnimeKai } from "./animekai.js";

export const animekaiRoutes = new Elysia({ prefix: "/animekai" })

  // ─── Search ────────────────────────────────────────────────────────────────
  .get("/search/:query", async ({ params: { query }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animekai:search:${query}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await AnimeKai.search(query, page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200); // 12 hours
    }
    return results;
  })

  // ─── Spotlight ─────────────────────────────────────────────────────────────
  .get("/spotlight", async () => {
    const cachedData = await Cache.get("animekai:spotlight");
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await AnimeKai.spotlight();
    if (results && results.length > 0) {
      Cache.set("animekai:spotlight", JSON.stringify(results), 43200); // 12 hours
    }
    return { results };
  })

  // ─── Schedule ──────────────────────────────────────────────────────────────
  .get("/schedule/:date", async ({ params: { date } }) => {
    const key = `animekai:schedule:${date}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await AnimeKai.schedule(date);
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200); // 12 hours
    }
    return { results };
  })

  // ─── Search Suggestions ────────────────────────────────────────────────────
  .get("/suggestions/:query", async ({ params: { query } }) => {
    const key = `animekai:suggestions:${query}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await AnimeKai.suggestions(query);
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200); // 12 hours
    }
    return { results };
  })

  // ─── Recent Episodes (recently updated) ────────────────────────────────────
  .get("/recent-episodes", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animekai:recent-episodes:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await AnimeKai.recentlyUpdated(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 60); // 1 minute for recent episodes
    }
    return results;
  })

  // ─── Recently Added ────────────────────────────────────────────────────────
  .get("/recent-added", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animekai:recent-added:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await AnimeKai.recentlyAdded(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 60); // 1 minute for recently added
    }
    return results;
  })

  // ─── Latest Completed ──────────────────────────────────────────────────────
  .get("/completed", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animekai:completed:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await AnimeKai.latestCompleted(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200);
    }
    return results;
  })

  // ─── New Releases ──────────────────────────────────────────────────────────
  .get("/new-releases", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animekai:new-releases:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await AnimeKai.newReleases(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200);
    }
    return results;
  })

  // ─── Movies ────────────────────────────────────────────────────────────────
  .get("/movies", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animekai:movies:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await AnimeKai.movies(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7); // 7 days
    }
    return results;
  })

  // ─── TV ────────────────────────────────────────────────────────────────────
  .get("/tv", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animekai:tv:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await AnimeKai.tv(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7);
    }
    return results;
  })

  // ─── OVA ───────────────────────────────────────────────────────────────────
  .get("/ova", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animekai:ova:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await AnimeKai.ova(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7);
    }
    return results;
  })

  // ─── ONA ───────────────────────────────────────────────────────────────────
  .get("/ona", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animekai:ona:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await AnimeKai.ona(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7);
    }
    return results;
  })

  // ─── Specials ──────────────────────────────────────────────────────────────
  .get("/specials", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animekai:specials:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await AnimeKai.specials(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7);
    }
    return results;
  })

  // ─── Genre List ────────────────────────────────────────────────────────────
  .get("/genres", async () => {
    const key = `animekai:genres`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await AnimeKai.genres();
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 30); // 30 days
    }
    return { results };
  })

  // ─── By Genre ──────────────────────────────────────────────────────────────
  .get("/genre/:genre", async ({ params: { genre }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `animekai:genre:${genre}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await AnimeKai.genreSearch(genre, page);
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

    const key = `animekai:info:${id}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const res = await AnimeKai.info(id);
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

    // Uncached, this pays for anikai's ~270 KB watch page (~6.5s) plus the
    // vivibebe resolve on every call. Keep the TTL modest: the extracted m3u8
    // is a stable path, but servers do come and go.
    const key = `animekai:v1:watch:${episodeId}:${type ?? "hardsub"}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const res = await AnimeKai.streams(animeSlug, episodeId, type);
    if (res?.results?.length > 0) Cache.set(key, JSON.stringify(res), 1800);
    return res;
  })

  // ─── Episode Servers ───────────────────────────────────────────────────────
  .get("/servers/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }

    const type = qs?.type as "softsub" | "dub" | "hardsub" | undefined;

    const key = `animekai:v1:servers:${episodeId}:${type ?? "hardsub"}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { servers: JSON.parse(cachedData) };

    const servers = await AnimeKai.fetchEpisodeServers(episodeId, type ?? "hardsub");
    if (servers.length > 0) Cache.set(key, JSON.stringify(servers), 1800);
    return { servers };
  })

  // ─── Downloads ─────────────────────────────────────────────────────────────
  .get("/download/:episodeId", async ({ params: { episodeId }, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }

    const key = `animekai:v1:download:${episodeId}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const res = await AnimeKai.downloads(episodeId);
    if (!res) {
      set.status = 404;
      return { message: "No downloads found for this episode" };
    }

    // Host links are stable for a released episode; a day is plenty.
    if (res.rows.length > 0) Cache.set(key, JSON.stringify(res), 86400);
    return res;
  });
