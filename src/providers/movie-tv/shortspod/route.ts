import { Elysia, t } from "elysia";
import { Cache } from "../../../core/cache.js";
import { ShortsPod } from "./shortspod.js";

const MISS = "  miss";
const MISS_TTL = 300;
const STREAM_MISS_TTL = 20;
const LISTING_TTL = 3600;
const INFO_TTL = 21600;

export const shortspodRoutes = new Elysia({ prefix: "/shortspod" })
  .get("/", () => ({
    name: "shortspod-api",
    version: "1.0",
    description: "ShortsPod short drama provider (primary)",
    endpoints: [
      "/shortspod/home?page=1",
      "/shortspod/search?key=query",
      "/shortspod/info/:id",
      "/shortspod/watch/:id/:episode",
    ],
  }))

  // ─── Home (ranking pages) ──────────────────────────────────────────────────
  .get("/home", async ({ query }) => {
    const page = parseInt(query?.page as string) || 1;
    const key = `shortspod:home:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);

    const results = await ShortsPod.home(page);
    if (results.results.length > 0) Cache.set(key, JSON.stringify(results), LISTING_TTL);
    return results;
  })

  // ─── Search ────────────────────────────────────────────────────────────────
  .get(
    "/search",
    async ({ query, status }) => {
      const q = query?.key as string | undefined;
      if (!q || !q.trim()) return status(400, { message: "Missing search key" });
      const page = parseInt(query?.page as string) || 1;
      const key = `shortspod:search:${q.trim()}:${page}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const results = await ShortsPod.search(q, page);
      Cache.set(key, JSON.stringify(results), LISTING_TTL);
      return results;
    },
    { query: t.Object({ key: t.String(), page: t.Optional(t.String()) }) },
  )

  // ─── Info + episode list ───────────────────────────────────────────────────
  .get(
    "/info/:id",
    async ({ params: { id }, status }) => {
      const key = `shortspod:info:${id}`;
      const cached = await Cache.get(key);
      if (cached === MISS) return status(404, { message: "Series not found" });
      if (cached) return JSON.parse(cached);

      const info = await ShortsPod.info(id);
      if (!info) {
        Cache.set(key, MISS, MISS_TTL);
        return status(404, { message: "Series not found" });
      }

      Cache.set(key, JSON.stringify(info), INFO_TTL);
      return info;
    },
    { params: t.Object({ id: t.String() }) },
  )

  // ─── Episode stream ────────────────────────────────────────────────────────
  .get(
    "/watch/:id/:episode",
    async ({ params: { id, episode }, status }) => {
      if (!/^\d+$/.test(episode)) {
        return status(400, { message: "Episode must be a positive integer" });
      }
      const number = Math.max(1, parseInt(episode, 10));
      const key = `shortspod:watch:${id}:${number}`;

      const cached = await Cache.get(key);
      if (cached === MISS) return status(404, { message: "No sources found for this episode" });
      if (cached) return JSON.parse(cached);

      const stream = await ShortsPod.watch(id, number);
      if (!stream) {
        Cache.set(key, MISS, STREAM_MISS_TTL);
        return status(404, { message: "No sources found for this episode" });
      }

      // MP4 URLs are stable (not signed/expiring like HLS), so cache longer.
      Cache.set(key, JSON.stringify(stream), INFO_TTL);
      return stream;
    },
    { params: t.Object({ id: t.String(), episode: t.String() }) },
  );