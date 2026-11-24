import { Elysia } from "elysia";
import { Cache } from "../../../core/cache.js";
import { Logger } from "../../../core/logger.js";
import { MangaPill, MangaPillError } from "./mangapill.js";

const ok = (data: unknown) => ({ status: 200, success: true, data });
const err = (set: any, status: number, message: string) => {
  set.status = status;
  return { status, success: false, message, data: null };
};

const TTL = {
  search: 600, // 10 min
  home: 600, // 10 min
  genres: 86_400, // 24 h — the filter form rarely changes
  detail: 1_800, // 30 min
  read: 86_400, // 24 h — page images of a published chapter don't change
};

/** cache.get → produce → cache.set, with errors mapped to the envelope and never cached. */
async function cached<T>(set: any, key: string, ttl: number, produce: () => Promise<T>) {
  const hit = await Cache.get(key);
  if (hit) {
    try {
      return ok(JSON.parse(hit));
    } catch {
      // fall through and refetch
    }
  }
  try {
    const data = await produce();
    Cache.set(key, JSON.stringify(data), ttl);
    return ok(data);
  } catch (e: any) {
    if (e instanceof MangaPillError) return err(set, e.status, e.message);
    Logger.error(`[MangaPill] ${key}: ${e?.message ?? e}`);
    return err(set, 502, "MangaPill request failed");
  }
}

/** `genre` may arrive once, repeated (array), or comma-separated. */
function genreList(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return values
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}

export const mangapillRoutes = new Elysia({ prefix: "/mangapill" })
  .get(
    "/",
    () => ({
      provider: "MangaPill",
      status: "operational",
      description: "MangaPill provider (server-rendered HTML, no Cloudflare challenge).",
      message: "MangaPill provider is running. Visit /docs for available endpoints.",
    }),
    { detail: { tags: ["manga"], summary: "MangaPill Status" } },
  )

  .get(
    "/search",
    ({ query, set }) => {
      const q = String(query.q ?? "").trim();
      const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
      const type = String(query.type ?? "").trim();
      const status = String(query.status ?? "").trim();
      const genres = genreList(query.genre);
      const key = `mangapill:search:${q.toLowerCase()}:${type}:${status}:${genres.join(",")}:${page}`;
      return cached(set, key, TTL.search, () =>
        MangaPill.search({ q, page, type, status, genres }),
      );
    },
    {
      detail: {
        tags: ["manga"],
        summary: "MangaPill Search / Browse (?q=&page=1&type=&status=&genre=)",
      },
    },
  )

  .get("/home", ({ set }) => cached(set, "mangapill:home", TTL.home, () => MangaPill.home()), {
    detail: { tags: ["manga"], summary: "MangaPill Home (trending + recent chapters)" },
  })

  .get(
    "/genres",
    ({ set }) =>
      cached(set, "mangapill:genres", TTL.genres, async () => ({
        genres: await MangaPill.genres(),
      })),
    { detail: { tags: ["manga"], summary: "MangaPill Genre list" } },
  )

  .get(
    "/detail/:id",
    ({ params: { id }, set }) => {
      if (!/^\d+$/.test(id)) return err(set, 404, "Manga not found");
      return cached(set, `mangapill:detail:${id}`, TTL.detail, () => MangaPill.detail(id));
    },
    { detail: { tags: ["manga"], summary: "MangaPill Detail + chapter list (newest first)" } },
  )

  .get(
    "/read/:chapterId",
    ({ params: { chapterId }, set }) => {
      if (!/^\d+-\d+$/.test(chapterId)) return err(set, 404, "Chapter not found");
      return cached(set, `mangapill:read:${chapterId}`, TTL.read, () => MangaPill.read(chapterId));
    },
    { detail: { tags: ["manga"], summary: "MangaPill Chapter pages" } },
  );
