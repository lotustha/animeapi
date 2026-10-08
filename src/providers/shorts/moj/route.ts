import { Elysia, t } from "elysia";
import { Cache } from "../../../core/cache.js";
import { Moj } from "./moj.js";

const prefix = "/shorts/moj";

const readLang = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z]{2,20}$/.test(value) ? value : "Hindi";

export const mojRoutes = new Elysia({ prefix: "/moj" })
  .get("/", () => ({
    name: "moj",
    description: "Moj (ShareChat) short videos — direct MP4s, no proxy needed",
    endpoints: [
      prefix + "/feed?limit=10                      → For You feed (new batch each call)",
      prefix + "/search/{query}?offset=&lang=Hindi  → Search shorts",
      prefix + "/tag/{hashtag}?offset=&lang=Hindi   → Popular shorts for a hashtag",
    ],
  }))

  // ─── For You feed ──────────────────────────────────────────────────────────
  // Not cached: every call is meant to return the next unseen batch.
  .get("/feed", async ({ query }) => {
    const limit = Math.min(Math.max(parseInt(query?.limit as string) || 10, 1), 20);
    return Moj.feed(limit);
  })

  // ─── Search ────────────────────────────────────────────────────────────────
  .get(
    "/search/:query",
    async ({ params: { query: term }, query }) => {
      const offset = (query?.offset as string) || "0";
      const lang = readLang(query?.lang);
      const key = `moj:search:${lang}:${term}:${offset}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const page = await Moj.search(term, offset, lang);
      if (page.results.length > 0) Cache.set(key, JSON.stringify(page), 1800);
      return page;
    },
    { params: t.Object({ query: t.String() }) },
  )

  // ─── Hashtag ───────────────────────────────────────────────────────────────
  .get(
    "/tag/:tag",
    async ({ params: { tag }, query, status }) => {
      const name = tag.replace(/^#/, "").trim().toLowerCase();
      const offset = (query?.offset as string) || undefined;
      const lang = readLang(query?.lang);
      const key = `moj:tag:${lang}:${name}:${offset ?? ""}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const idKey = `moj:tagid:${name}`;
      const cachedId = await Cache.get(idKey);
      const tagId = cachedId ? Number(cachedId) : await Moj.tagId(name);
      if (!tagId) return status(404, { message: "Hashtag not found" });
      if (!cachedId) Cache.set(idKey, String(tagId), -1);

      const page = await Moj.tag(tagId, offset, lang);
      if (page.results.length > 0) Cache.set(key, JSON.stringify(page), 1800);
      return { tag: name, tagId, ...page };
    },
    { params: t.Object({ tag: t.String() }) },
  );
