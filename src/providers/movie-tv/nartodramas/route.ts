import { Elysia, t } from "elysia";
import { Cache } from "../../../core/cache.js";
import { Logger } from "../../../core/logger.js";
import { singleFlight } from "../nartodrama/scraper/single-flight.js";
import { Nartodramas, NartodramasBusy } from "./nartodramas.js";

const MISS = "  miss";
const MISS_TTL = 300;
const STREAM_MISS_TTL = 60;
const LISTING_TTL = 1800;
const SEARCH_TTL = 3600;
const INFO_TTL = 21600;
const STREAM_TTL = 10800;

const readPage = (query: Record<string, unknown> | undefined) =>
  Math.max(1, Math.min(10_000, parseInt(String(query?.page ?? "1"), 10) || 1));

/** Busy upstream -> 503 + Retry-After; "not there" is a 404 from the route. */
async function answering<T>(
  set: { status?: number | string; headers: Record<string, any> },
  work: () => Promise<T>,
): Promise<T | { message: string; reason: string }> {
  try {
    return await work();
  } catch (err) {
    if (!(err instanceof NartodramasBusy)) Logger.error(err);
    set.status = 503;
    set.headers["retry-after"] = "20";
    return {
      message: "nartodramas could not answer",
      reason: err instanceof NartodramasBusy ? "rate-limited" : "upstream-error",
    };
  }
}

export const nartodramasRoutes = new Elysia({ prefix: "/nartodramas" })
  .get("/", () => ({
    name: "nartodramas-api",
    version: "1.0",
    description: "Narto Dramas (www.nartodramas.com): new titles, replacing narto-drama.com",
    endpoints: [
      "/nartodramas/home?page=1",
      "/nartodramas/search?key=query&page=1",
      "/nartodramas/info/:slug",
      "/nartodramas/watch/:slug/:episode",
    ],
  }))

  .get("/home", ({ query, set }) =>
    answering(set, async () => {
      const page = readPage(query);
      const key = `nartodramas:v1:home:${page}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);
      const results = await singleFlight(key, () => Nartodramas.list(page));
      if (results.results.length > 0) Cache.set(key, JSON.stringify(results), LISTING_TTL);
      return results;
    }),
  )

  .get(
    "/search",
    ({ query, set, status }) => {
      const q = String(query?.key ?? "").trim();
      if (!q) return status(400, { message: "Missing search key" });
      return answering(set, async () => {
        const page = readPage(query);
        const key = `nartodramas:v2:search:${q.toLowerCase()}:${page}`;
        const cached = await Cache.get(key);
        if (cached) return JSON.parse(cached);
        const results = await singleFlight(key, () => Nartodramas.search(q, page));
        Cache.set(key, JSON.stringify(results), results.results.length > 0 ? SEARCH_TTL : MISS_TTL);
        return results;
      });
    },
    {
      query: t.Object({
        key: t.String(),
        page: t.Optional(t.String()),
        lang: t.Optional(t.String()),
      }),
    },
  )

  .get(
    "/info/:slug",
    ({ params: { slug }, query, set, status }) =>
      answering(set, async () => {
        const key = `nartodramas:v1:info:${slug}`;
        const cached = query?.fresh === "1" ? null : await Cache.get(key);
        if (cached === MISS) return status(404, { message: "Series not found" });
        if (cached) return JSON.parse(cached);
        const info = await singleFlight(key, () => Nartodramas.info(slug));
        if (!info) {
          Cache.set(key, MISS, MISS_TTL);
          return status(404, { message: "Series not found" });
        }
        Cache.set(key, JSON.stringify(info), INFO_TTL);
        return info;
      }),
    { params: t.Object({ slug: t.String() }) },
  )

  .get(
    "/watch/:slug/:episode",
    ({ params: { slug, episode }, query, set, status }) => {
      if (!/^\d+$/.test(episode)) return status(400, { message: "Episode must be a positive integer" });
      return answering(set, async () => {
        const number = Math.max(1, parseInt(episode, 10));
        const key = `nartodramas:v1:watch:${slug}:${number}`;
        // `?fresh=1`: the player saying the last link did not play, or the
        // import gate - both want a link checked now.
        const fresh = query?.fresh === "1";
        const cached = fresh ? null : await Cache.get(key);
        if (cached === MISS) return status(404, { message: "No sources found for this episode" });
        if (cached) return JSON.parse(cached);
        const stream = await singleFlight(`${key}:${fresh}`, () => Nartodramas.watch(slug, number, fresh));
        if (!stream) {
          Cache.set(key, MISS, STREAM_MISS_TTL);
          return status(404, { message: "No sources found for this episode" });
        }
        Cache.set(key, JSON.stringify(stream), STREAM_TTL);
        return stream;
      });
    },
    { params: t.Object({ slug: t.String(), episode: t.String() }) },
  );
