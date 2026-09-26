import { Elysia, t } from "elysia";
import { Cache } from "../../../core/cache.js";
import { MovieBox } from "./moviebox.js";
import type { MovieBoxInfo } from "./types.js";

const prefix = "/movie-tv/moviebox";

// MP4 URLs are signed by the CDN and expire, so streams get a short TTL.
// Catalogue data is stable and cached hard.
const STREAM_TTL = 300;
const INFO_TTL = 21600;

const getInfo = async (id: string): Promise<MovieBoxInfo | null> => {
  const key = `moviebox:info:${id}`;
  const cached = await Cache.get(key);
  if (cached) return JSON.parse(cached);

  const info = await MovieBox.info(id);
  if (info) Cache.set(key, JSON.stringify(info), INFO_TTL);
  return info;
};

const readType = (value: unknown) => (value === "movie" || value === "tv" ? value : "all");

export const movieBoxRoutes = new Elysia({ prefix: "/moviebox" })
  .get("/", () => ({
    name: "moviebox",
    description: "MovieBox (themoviebox.xyz) — movies & TV with direct MP4 sources",
    endpoints: [
      prefix + "/trending?page=1",
      prefix + "/search/{query}?page=1&type=all|movie|tv",
      prefix + "/info/{id}",
      prefix + "/watch/{id}                      → movie",
      prefix + "/watch/{id}?season=1&episode=1   → tv episode",
    ],
  }))

  // ─── Trending ──────────────────────────────────────────────────────────────
  .get("/trending", async ({ query }) => {
    const page = parseInt(query?.page as string) || 1;
    const key = `moviebox:trending:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);

    const results = await MovieBox.trending(page);
    if (results.results.length > 0) Cache.set(key, JSON.stringify(results), 3600);
    return results;
  })

  // ─── Search ────────────────────────────────────────────────────────────────
  .get(
    "/search/:query",
    async ({ params: { query: term }, query }) => {
      const page = parseInt(query?.page as string) || 1;
      const type = readType(query?.type);
      const key = `moviebox:search:${type}:${term}:${page}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const results = await MovieBox.search(term, page, type);
      if (results.results.length > 0) Cache.set(key, JSON.stringify(results), 43200);
      return results;
    },
    { params: t.Object({ query: t.String() }) },
  )

  // ─── Info ──────────────────────────────────────────────────────────────────
  .get(
    "/info/:id",
    async ({ params: { id }, status }) => {
      const info = await getInfo(id);
      return info ?? status(404, { message: "Title not found" });
    },
    { params: t.Object({ id: t.String() }) },
  )

  // ─── Watch ─────────────────────────────────────────────────────────────────
  .get(
    "/watch/:id",
    async ({ params: { id }, query, status }) => {
      const season = parseInt(query?.season as string) || 0;
      const episode = parseInt(query?.episode as string) || 0;

      const info = await getInfo(id);
      if (!info) return status(404, { message: "Title not found" });
      if (info.type === "tv" && (season < 1 || episode < 1)) {
        return status(400, { message: "TV titles need ?season=N&episode=N" });
      }

      const key = `moviebox:watch:${id}:${season}:${episode}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const stream = await MovieBox.watch(info, season, episode);
      if (!stream) return status(404, { message: "No sources for this title/episode" });
      Cache.set(key, JSON.stringify(stream), STREAM_TTL);
      return stream;
    },
    { params: t.Object({ id: t.String() }) },
  );
