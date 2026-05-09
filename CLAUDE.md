# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

This repo is **Mugen / Cooren API** — a multi-provider media scraping API built on **Bun + ElysiaJS** in TypeScript. It serves anime, manga, movies/TV, music, and direct stream sources behind a single Elysia app, with an internal HLS/MP4 proxy and a cross-platform AniZip ID-mapping endpoint.

The codebase is multi-runtime: it runs under Bun (primary), Node.js, and Deno. Runtime is detected at `src/core/runtime.ts` and the Elysia adapter is swapped accordingly in `src/app.ts` (Node uses `@elysiajs/node`).

## Common commands

```bash
bun install                # install deps (use Bun, not npm — bun.lock is the lockfile)

bun run dev                # dev server on PORT (default 3000)
bun run hot                # dev with --hot reload
bun run dev:node           # run via tsx + .env (Node)
bun run dev:deno           # run under Deno

bun run build:bun          # bundle for Bun runtime → dist/
bun run build:node         # tsc compile for Node → dist/
bun run build:cpanel       # tsc compile for cPanel deployment

bun run start:cpanel:cjs   # production entry for cPanel/LiteSpeed (cpanel-entry.cjs → dist/src/index.js)

bun run test               # custom provider runner (scripts/tests/index.ts)
bun run test:vitest        # Vitest — picks up *.vitest.test.ts and src/**/*.test.ts
bun run test:jest          # Jest — picks up *.jest.test.ts (excludes vitest files)

bun run lint               # eslint src
bun run lint:fix
bun run format             # prettier --write src
```

Run a single test file: `bun run test:vitest path/to/file.vitest.test.ts` or `bun run test:jest path/to/file.jest.test.ts`. The two runners deliberately use different filename suffixes so they don't pick up each other's files (see `vitest.config.ts` and `jest.config.cjs`).

## Architecture

**Entry points.** `src/index.ts` is the canonical entry — it validates config and binds `app.listen(PORT)` unconditionally (the previous serverless-style conditional broke cPanel/LiteSpeed). `src/app.ts` exports `createApp()`, which wires CORS, OpenAPI docs at `/docs`, path normalization, and mounts all top-level route groups. `src/server.ts` is an alternate entry that branches on `isDeno` to call `Deno.serve` instead of `app.listen` — both files coexist; production uses `src/index.ts`. `cpanel-entry.cjs` is a CommonJS shim that hand-parses `.env` (handling quoted values + inline comments) and dynamically imports the compiled ESM bundle for LiteSpeed's `lsnode.js`.

**Provider layout.** Every provider is a self-contained module:

```
src/providers/<category>/<provider>/
├── route.ts        # Elysia routes, mounted with prefix /<category>/<provider>
├── <provider>.ts   # static class with the scraping methods
├── types.ts        # zod schemas + TS types
└── scraper/        # (optional) decryption, unpackers, helpers specific to this site
```

Categories are `anime`, `manga`, `movie-tv`, `music`, `stream`. Each category has its own `route.ts` that `.use()`s every provider in that category and exposes a `GET /<category>` overview endpoint listing all sub-routes — keep this overview in sync when adding/removing providers. The category routers are then mounted in `src/app.ts`.

**Adding a provider.** Create the four-file structure above, register the provider's Elysia router in the matching `src/providers/<category>/route.ts`, add the source site URL to `src/providers/origins.ts` (all base URLs are centralized there — never hardcode), and append entries to the category's overview endpoint.

**Module resolution.** TypeScript is configured with `moduleResolution: "Bundler"` but the compiled output runs under Node ESM, so **all relative imports must include the `.js` extension** (e.g. `import { Cache } from "../../../core/cache.js"`). The script `scripts/fix-imports.mjs` rewrites bare relative imports to add `.js` — run it if you author new code without extensions.

**Caching.** `src/core/cache.ts` exposes a static `Cache` class with three backends selected by env: `default` (Bun-native `RedisClient`, Bun-only), `uptash` (Upstash REST, runtime-agnostic), and `file` (filesystem JSON in `./cache/`, used on cPanel where Redis isn't available). When `ENABLE_CACHE !== "true"`, all `Cache.get/set` calls become no-ops and routes pass through. Provider routes follow the convention `key = "<provider>:<operation>:<args>"` with TTLs in seconds (`-1` = forever); see `animekai/route.ts` for the canonical pattern of `cache.get → fetch → cache.set`.

**Internal proxy.** `src/core/proxyRoutes.ts` mounts `/proxy/{m3u8-proxy,ts-segment,mp4-proxy,fetch}`. The m3u8 proxy rewrites every URI inside the playlist to be re-routed through this same server, using `SERVER_ORIGIN` (required env var outside test) as the public base. Helpers in `src/core/proxy.ts` (`proxifySource`) wrap source URLs from scrapers so clients can stream through the proxy. There are hard size limits per route (5 MB m3u8, 50 MB segment, 20 GB mp4, 50 MB generic fetch).

**Mappings.** `src/anizip/` wraps `api.ani.zip` for cross-platform ID resolution (MAL ↔ AniList ↔ Kitsu ↔ TMDB ↔ IMDB ↔ AniDB ↔ TVDB). Exposed at `GET /mappings?<id_type>=<value>` via `src/core/mappingRoutes.ts`.

**Subdirectory deployment.** Setting `BASE_PATH=/api` (or similar) prefixes the entire app — used for cPanel where the API is mounted under a path. Implemented by setting `appConfig.prefix` in `createApp()`.

## Conventions

- **Code style:** Prettier with `printWidth: 100`, `tabWidth: 2`, double quotes, trailing commas. ESLint extends recommended + typescript-eslint; `@typescript-eslint/no-explicit-any` is **off** — `any` is allowed in scraper code.
- **Static class pattern:** Providers expose `static` methods on a class (e.g. `Animepahe.search()`, `AnimeKai.info()`) rather than functions or instances. Routes call these directly; there's no DI.
- **Validation:** All upstream JSON responses are parsed with `zod` schemas via `safeParse`. On schema mismatch, return `[]` / `null` rather than throwing — see `Animepahe.search` for the pattern.
- **Logger:** Use `Logger` from `src/core/logger.ts` — never `console.log` for application logs (the proxy and cache modules still use `console` in places; new code should not).

## Environment

`.env.example` is the source of truth for env vars. Required for non-test runs: `PORT`, `CUSTOM_DOMAIN`, `SERVER_ORIGIN` (validated at startup in `src/core/config.ts`; `SERVER_ORIGIN` is enforced by `proxyRoutes.ts`). Cache backend selection: `ENABLE_CACHE`, `CACHE_PROVIDER` (`default` | `uptash` | `file`), plus the relevant `REDIS_URL` or `UPSTASH_REDIS_REST_*` pair.

## Deployment

`.github/workflows/deploy.yml` SSHs to the production VPS at `/www/wwwroot/api.mugenstream.fun` and runs `git pull origin main` on every push to `main` — there is no build step in CI, so the VPS must build/restart on its own (e.g. via PM2 watch or a separate hook). Be aware that pushes to `main` deploy immediately.
