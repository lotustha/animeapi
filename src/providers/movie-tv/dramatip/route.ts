import { Elysia, t } from "elysia";
import { Cache } from "../../../core/cache.js";
import { Logger } from "../../../core/logger.js";
import { singleFlight } from "../nartodrama/scraper/single-flight.js";
import { Dramatip, DramatipBusy } from "./dramatip.js";

const MISS = "  miss";
/** A title or episode that is not there is asked about again after this. */
const MISS_TTL = 300;
const STREAM_MISS_TTL = 60;
const LISTING_TTL = 1800;
const SEARCH_TTL = 3600;
const SOURCES_TTL = 21600;
const INFO_TTL = 21600;
/** A link the app must renew (signed, or a session): not worth keeping long. */
const STREAM_SHORT_TTL = 1200;
const STREAM_TTL = 10800;

const readLang = (query: Record<string, unknown> | undefined) =>
  String(query?.lang ?? "en-US").trim() || "en-US";
const readPage = (query: Record<string, unknown> | undefined) =>
  Math.max(1, parseInt(String(query?.page ?? "1"), 10) || 1);

/**
 * Run [work] for a route, answering 503 + Retry-After when dramatip is busy.
 *
 * "Busy" and "not there" are different answers and the callers act on the
 * difference: ani-nexus waits on a 503 and gives up on a 404. Anything else
 * thrown is ours to log, and is also a 503 - an error here is not a verdict on
 * the title either.
 */
async function answering<T>(
  set: { status?: number | string; headers: Record<string, any> },
  work: () => Promise<T>,
): Promise<T | { message: string; reason: string }> {
  try {
    return await work();
  } catch (err) {
    if (!(err instanceof DramatipBusy)) Logger.error(err);
    set.status = 503;
    set.headers["retry-after"] = "20";
    return {
      message: "dramatip could not answer",
      reason: err instanceof DramatipBusy ? "rate-limited" : "upstream-error",
    };
  }
}

export const dramatipRoutes = new Elysia({ prefix: "/dramatip" })
  .get("/", () => ({
    name: "dramatip-api",
    version: "1.0",
    description: "DramaTip short drama aggregator (primary)",
    endpoints: [
      "/dramatip/home?page=1&lang=en-US",
      "/dramatip/search?key=query&page=1",
      "/dramatip/sources",
      "/dramatip/source/:key?page=1",
      "/dramatip/info/:slug",
      "/dramatip/watch/:slug/:episode",
    ],
  }))

  // ─── Catalogue, newest first ───────────────────────────────────────────────
  .get("/home", ({ query, set }) =>
    answering(set, async () => {
      const page = readPage(query);
      const lang = readLang(query);
      const key = `dramatip:v2:home:${lang}:${page}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const results = await singleFlight(key, () => Dramatip.home(page, lang));
      if (results.results.length > 0) Cache.set(key, JSON.stringify(results), LISTING_TTL);
      return results;
    }),
  )

  // ─── Search ────────────────────────────────────────────────────────────────
  .get(
    "/search",
    ({ query, set, status }) => {
      const q = String(query?.key ?? "").trim();
      if (!q) return status(400, { message: "Missing search key" });
      return answering(set, async () => {
        const page = readPage(query);
        const lang = readLang(query);
        const key = `dramatip:v2:search:${lang}:${q.toLowerCase()}:${page}`;
        const cached = await Cache.get(key);
        if (cached) return JSON.parse(cached);

        const results = await singleFlight(key, () => Dramatip.search(q, page, lang));
        // An empty answer is cached too, briefly: a term with no matches is
        // typed as often as one with.
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

  // ─── Upstream apps ─────────────────────────────────────────────────────────
  .get("/sources", ({ query, set }) =>
    answering(set, async () => {
      const lang = readLang(query);
      const key = `dramatip:v2:sources:${lang}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const results = { results: await Dramatip.sources(lang) };
      if (results.results.length > 0) Cache.set(key, JSON.stringify(results), SOURCES_TTL);
      return results;
    }),
  )

  .get(
    "/source/:key",
    ({ params: { key: app }, query, set }) =>
      answering(set, async () => {
        const page = readPage(query);
        const lang = readLang(query);
        const key = `dramatip:v2:source:${lang}:${app}:${page}`;
        const cached = await Cache.get(key);
        if (cached) return JSON.parse(cached);

        const results = await singleFlight(key, () => Dramatip.source(app, page, lang));
        if (results.results.length > 0) Cache.set(key, JSON.stringify(results), LISTING_TTL);
        return results;
      }),
    { params: t.Object({ key: t.String() }) },
  )

  // ─── Info + episode list ───────────────────────────────────────────────────
  .get(
    "/info/:slug",
    ({ params: { slug }, query, set, status }) =>
      answering(set, async () => {
        const lang = readLang(query);
        const key = `dramatip:v2:info:${lang}:${slug}`;
        // `?fresh=1` is the refresh job asking whether new episodes are out.
        const cached = query?.fresh === "1" ? null : await Cache.get(key);
        if (cached === MISS) return status(404, { message: "Series not found" });
        if (cached) return JSON.parse(cached);

        const info = await singleFlight(key, () => Dramatip.info(slug, lang));
        if (!info) {
          Cache.set(key, MISS, MISS_TTL);
          return status(404, { message: "Series not found" });
        }
        Cache.set(key, JSON.stringify(info), INFO_TTL);
        return info;
      }),
    { params: t.Object({ slug: t.String() }) },
  )

  // ─── Episode stream ────────────────────────────────────────────────────────
  .get(
    "/watch/:slug/:episode",
    ({ params: { slug, episode }, query, set, status }) => {
      if (!/^\d+$/.test(episode)) {
        return status(400, { message: "Episode must be a positive integer" });
      }
      return answering(set, async () => {
        const number = Math.max(1, parseInt(episode, 10));
        const lang = readLang(query);
        const key = `dramatip:v2:watch:${lang}:${slug}:${number}`;

        // `?fresh=1` is the player saying the last link did not play.
        const cached = query?.fresh === "1" ? null : await Cache.get(key);
        if (cached === MISS) return status(404, { message: "No sources found for this episode" });
        if (cached) return JSON.parse(cached);

        const stream = await singleFlight(key, () => Dramatip.watch(slug, number, lang));
        if (!stream) {
          Cache.set(key, MISS, STREAM_MISS_TTL);
          return status(404, { message: "No sources found for this episode" });
        }
        const { refresh, ...body } = stream;
        Cache.set(key, JSON.stringify(body), refresh ? STREAM_SHORT_TTL : STREAM_TTL);
        return body;
      });
    },
    { params: t.Object({ slug: t.String(), episode: t.String() }) },
  );
