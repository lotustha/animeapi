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

/** cache.get → fetch → cache.set for the raw passthrough routes. */
const cachedRaw = async (key: string, ttl: number, load: () => Promise<unknown>) => {
  const cached = await Cache.get(key);
  if (cached) return JSON.parse(cached);
  const data = await load();
  if (data != null) Cache.set(key, JSON.stringify(data), ttl);
  return data;
};

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
      prefix + "/watch/{id}?audio=hi              → a dub (langCode from info.dubs)",
      prefix + "/home                             → raw home rows (Bollywood first)",
      prefix + "/filter?type=movie&country=India&sort=Latest&page=1 → raw browse filter",
      prefix + "/ranking/{id}?page=1&perPage=24   → raw ranking list",
      prefix + "/detail/{subjectId}               → raw detail",
      prefix + "/suggest/{query}?perPage=12       → raw search suggestions",
    ],
  }))

  // ─── Raw MovieBox payloads ─────────────────────────────────────────────────
  .get("/home", async ({ status }) => {
    const data = await cachedRaw("moviebox:home:v2", 1800, () => MovieBox.home());
    return data ?? status(502, { message: "Home unavailable" });
  })

  .get("/filter", async ({ query, status }) => {
    const filter = {
      type: query?.type === "tv" ? ("tv" as const) : ("movie" as const),
      classify: query?.classify as string | undefined,
      country: query?.country as string | undefined,
      genre: query?.genre as string | undefined,
      year: query?.year as string | undefined,
      sort: query?.sort as string | undefined,
    };
    const page = parseInt(query?.page as string) || 1;
    const perPage = Math.min(parseInt(query?.perPage as string) || 24, 50);
    const facets = [filter.classify, filter.country, filter.genre, filter.year, filter.sort];
    const key = `moviebox:filter:${filter.type}:${facets.map((f) => f || "All").join(":")}:${page}:${perPage}`;
    const data = await cachedRaw(key, 3600, () => MovieBox.filter(filter, page, perPage));
    return data ?? status(502, { message: "Filter unavailable" });
  })

  .get(
    "/ranking/:id",
    async ({ params: { id }, query, status }) => {
      const page = parseInt(query?.page as string) || 1;
      const perPage = Math.min(parseInt(query?.perPage as string) || 24, 50);
      const data = await cachedRaw(`moviebox:ranking:${id}:${page}:${perPage}`, 3600, () =>
        MovieBox.ranking(id, page, perPage),
      );
      return data ?? status(404, { message: "Ranking list not found" });
    },
    { params: t.Object({ id: t.String() }) },
  )

  .get(
    "/detail/:subjectId",
    async ({ params: { subjectId }, status }) => {
      const data = await cachedRaw(`moviebox:detail:${subjectId}`, INFO_TTL, () =>
        MovieBox.detail(subjectId),
      );
      return data ?? status(404, { message: "Title not found" });
    },
    { params: t.Object({ subjectId: t.String() }) },
  )

  .get(
    "/suggest/:query",
    async ({ params: { query: term }, query }) => {
      const perPage = Math.min(parseInt(query?.perPage as string) || 12, 30);
      const data = await cachedRaw(`moviebox:suggest:${term}:${perPage}`, 43200, () =>
        MovieBox.suggest(term, perPage),
      );
      return data ?? { items: [] };
    },
    { params: t.Object({ query: t.String() }) },
  )

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

      const audio = (query?.audio as string | undefined) || undefined;
      const dub = MovieBox.pickDub(info, audio);
      if (audio && !dub) {
        return status(404, {
          message: `No "${audio}" audio for this title`,
          audioTracks: info.dubs,
        });
      }

      const key = `moviebox:watch:${id}:${season}:${episode}:${dub?.subjectId ?? ""}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const stream = await MovieBox.watch(info, season, episode, dub);
      if (!stream) return status(404, { message: "No sources for this title/episode" });
      Cache.set(key, JSON.stringify(stream), STREAM_TTL);
      return stream;
    },
    { params: t.Object({ id: t.String() }) },
  );
