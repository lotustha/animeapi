import { Elysia, t } from "elysia";
import { Cache } from "../../../core/cache.js";
import { NartoDrama } from "./nartodrama.js";

const prefix = "/movie-tv/nartodrama";

// The resolved CDN URL is signed (`ts`/`secret`) and expires, so the stream
// response gets a deliberately short TTL. Listings and metadata are stable and
// cached hard.
const STREAM_TTL = 300;

export const nartoDramaRoutes = new Elysia({ prefix: "/nartodrama" })

  .get("/", () => ({
    name: "nartodrama-api",
    version: "1.0",
    description: "Short drama / mini series provider",
    endpoints: [
      prefix + "/home?page=1",
      prefix + "/search/{query}?page=1",
      prefix + "/genre/{genre}?page=1",
      prefix + "/tag/{tag}?page=1",
      prefix + "/providers",
      prefix + "/provider/{key}",
      prefix + "/resolve/{provider}/{bookId}",
      prefix + "/info/{slug}",
      prefix + "/watch/{slug}/{episode}",
    ],
  }))

  // ─── Home ──────────────────────────────────────────────────────────────────
  .get("/home", async ({ query }) => {
    const page = parseInt(query?.page as string) || 1;
    const key = `nartodrama:home:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);

    const results = await NartoDrama.home(page);
    if (results.results.length > 0) Cache.set(key, JSON.stringify(results), 3600);
    return results;
  })

  // ─── Search ────────────────────────────────────────────────────────────────
  .get(
    "/search/:query",
    async ({ params: { query: term }, query }) => {
      const page = parseInt(query?.page as string) || 1;
      const key = `nartodrama:search:${term}:${page}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const results = await NartoDrama.search(term, page);
      if (results.results.length > 0) Cache.set(key, JSON.stringify(results), 43200);
      return results;
    },
    { params: t.Object({ query: t.String() }) },
  )

  // ─── Genre ─────────────────────────────────────────────────────────────────
  .get(
    "/genre/:genre",
    async ({ params: { genre }, query }) => {
      const page = parseInt(query?.page as string) || 1;
      const key = `nartodrama:genre:${genre}:${page}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const results = await NartoDrama.genre(genre, page);
      if (results.results.length > 0) Cache.set(key, JSON.stringify(results), 43200);
      return results;
    },
    { params: t.Object({ genre: t.String() }) },
  )

  // ─── Tag ───────────────────────────────────────────────────────────────────
  .get(
    "/tag/:tag",
    async ({ params: { tag }, query }) => {
      const page = parseInt(query?.page as string) || 1;
      const key = `nartodrama:tag:${tag}:${page}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const results = await NartoDrama.tag(tag, page);
      if (results.results.length > 0) Cache.set(key, JSON.stringify(results), 43200);
      return results;
    },
    { params: t.Object({ tag: t.String() }) },
  )

  // ─── Upstream providers ────────────────────────────────────────────────────
  .get("/providers", async () => {
    const key = `nartodrama:providers`;
    const cached = await Cache.get(key);
    if (cached) return { results: JSON.parse(cached) };

    const results = await NartoDrama.providers();
    if (results.length > 0) Cache.set(key, JSON.stringify(results), 86400);
    return { results };
  })

  .get(
    "/provider/:key",
    async ({ params: { key: provider }, status }) => {
      const key = `nartodrama:provider:${provider}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const catalogue = await NartoDrama.providerCatalogue(provider);
      if (!catalogue) return status(404, { message: "Provider not found" });

      Cache.set(key, JSON.stringify(catalogue), 3600);
      return catalogue;
    },
    { params: t.Object({ key: t.String() }) },
  )

  // Provider items are keyed by bookId, not slug — resolve one to a slug that
  // /info and /watch accept.
  .get(
    "/resolve/:provider/:bookId",
    async ({ params: { provider, bookId }, status }) => {
      const key = `nartodrama:resolve:${provider}:${bookId}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const resolved = await NartoDrama.resolve(provider, bookId);
      if (!resolved) return status(404, { message: "Could not resolve this title" });

      // Derived mapping, not content: if narto re-imports a title under a new
      // slug, a day-long cache would serve a slug that 404s on /info. Hours.
      Cache.set(key, JSON.stringify(resolved), 21600);
      return resolved;
    },
    { params: t.Object({ provider: t.String(), bookId: t.String() }) },
  )

  // ─── Info + episode list ───────────────────────────────────────────────────
  .get(
    "/info/:slug",
    async ({ params: { slug }, status }) => {
      const key = `nartodrama:info:${slug}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const info = await NartoDrama.info(slug);
      if (!info) return status(404, { message: "Series not found" });

      Cache.set(key, JSON.stringify(info), 21600);
      return info;
    },
    { params: t.Object({ slug: t.String() }) },
  )

  // ─── Episode stream ────────────────────────────────────────────────────────
  .get(
    "/watch/:slug/:episode",
    async ({ params: { slug, episode }, status }) => {
      // Reject non-numeric episodes outright — silently coercing them to 1
      // would serve episode 1 under a bogus cache key and mask client bugs.
      if (!/^\d+$/.test(episode)) {
        return status(400, { message: "Episode must be a positive integer" });
      }
      const number = Math.max(1, parseInt(episode, 10));
      const key = `nartodrama:watch:${slug}:${number}`;
      const cached = await Cache.get(key);
      if (cached) return JSON.parse(cached);

      const stream = await NartoDrama.watch(slug, number);
      if (!stream) return status(404, { message: "No sources found for this episode" });

      Cache.set(key, JSON.stringify(stream), STREAM_TTL);
      return stream;
    },
    { params: t.Object({ slug: t.String(), episode: t.String() }) },
  );
