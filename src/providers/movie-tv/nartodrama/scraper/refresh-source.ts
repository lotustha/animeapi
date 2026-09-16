import { Cache } from "../../../../core/cache.js";
import { Logger } from "../../../../core/logger.js";
import { nartodrama, nartodrama_edge } from "../../../origins.js";
import { refreshSourceSchema, episodeItemsSchema } from "../types.js";
import type { RefreshSource } from "../types.js";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Upstream localizes every catalogue by session locale, and it picks that
// locale from the *caller's IP* on first contact - so the identical request
// answers in English from one host and French from the VPS. `?lang=` overrides
// the geo guess and pins the session for later requests, so every call that can
// carry it does. Changing this one value changes the language of the whole
// scrape; upstream offers 22 locales.
export const LANG = "en-US";

/**
 * Pull a `const <name> = "...";` string literal out of the inline player script.
 * The values are PHP-escaped JSON strings (`https:\/\/...`), so they are decoded
 * as JSON rather than used verbatim.
 */
export function readScriptString(html: string, name: string): string | null {
  const match = html.match(new RegExp("const\\s+" + name + '\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"'));
  if (!match) return null;
  try {
    return JSON.parse('"' + match[1] + '"');
  } catch {
    return null;
  }
}

/**
 * Extract the `const episodeItemsRaw = [ ... ];` literal by scanning for a
 * balanced bracket rather than a lazy regex — episode titles routinely contain
 * brackets and the array is ~60 objects deep.
 */
export function readEpisodeItems(html: string): unknown[] {
  const anchor = html.indexOf("episodeItemsRaw");
  if (anchor === -1) return [];
  const start = html.indexOf("[", anchor);
  if (start === -1) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(html.slice(start, i + 1));
          const result = episodeItemsSchema.safeParse(parsed);
          return result.success ? result.data : [];
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

/**
 * Decide whether a resolved source is HLS.
 *
 * Mirrors the site player's own test: several upstreams (bilitv and friends)
 * hand back a tokenized `/e/m/<jwt>?mh=1` URL with no extension that still
 * serves application/vnd.apple.mpegurl, so an extension check alone is wrong.
 */
export function isHlsSource(url: string, flagged?: boolean): boolean {
  if (flagged) return true;
  const lower = url.toLowerCase();
  return lower.includes(".m3u") || lower.includes("/e/m/") || /[?&]mh=1(?:&|$)/.test(lower);
}

/** Resolved URLs are sometimes site-relative (`/e/s/<jwt>` subtitles). */
export function absoluteUrl(url: string): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return nartodrama + (url.startsWith("/") ? url : "/" + url);
}

/**
 * Upstream apps whose CDN refuses the production VPS by IP.
 *
 * melolo answers 410 Gone for a request originating on the France VPS while the
 * *same* signed URL returns 206 from other regions — so it is a geo/IP block,
 * not expiry. Since proxifySource puts the server in the middle, proxying these
 * guarantees failure; handing the client the direct URL lets the viewer's own
 * connection decide, which is the only way these play at all today.
 */
const DIRECT_ONLY_PROVIDERS = new Set(["melolo"]);

export function servesDirect(app: string | null | undefined): boolean {
  return DIRECT_ONLY_PROVIDERS.has(
    String(app || "")
      .trim()
      .toLowerCase(),
  );
}

/**
 * One retry, with a per-attempt deadline.
 *
 * A cold title can leave the upstream resolving for long enough that the
 * gateway in front of this API gives up and answers 502 before we answer at
 * all. Bounding each attempt fails fast instead of burning that budget, and the
 * single retry absorbs the transient 5xx/network blips seen on first hit.
 */
async function fetchWithRetry(url: string, init: RequestInit, timeoutMs = 15000) {
  let lastErr: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status >= 500 && attempt === 0) continue; // transient upstream — retry once
      return res;
    } catch (err) {
      lastErr = err;
    }
  }

  if (lastErr) Logger.warn(`nartodrama: fetch failed after retry — ${url.slice(0, 80)}`);
  return null;
}

export interface WatchPageContext {
  /** Only present on a freshly fetched page — never cached (it is ~900 KB). */
  html?: string;
  refreshBase: string;
  contextToken: string | null;
  edgeBase: string;
  /** Upstream app backing this title (idrama, melolo, reelshort, …). */
  app: string | null;
  episodes: unknown[];
}

export function watchUrl(slug: string, episode: number) {
  return `${nartodrama}/detail/watch/${slug}/${Math.max(1, episode)}?lang=${LANG}`;
}

export async function fetchWatchPage(
  slug: string,
  episode: number,
): Promise<WatchPageContext | null> {
  const res = await fetchWithRetry(watchUrl(slug, episode), {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
  });
  if (!res || !res.ok) return null;

  const html = await res.text();
  return {
    html,
    refreshBase:
      readScriptString(html, "refreshSourceBaseUrl") ||
      `${nartodrama}/detail/watch/${slug}?lang=${LANG}`,
    contextToken: readScriptString(html, "refreshSourceContextToken"),
    edgeBase: readScriptString(html, "refreshSourceEdgeBase") || nartodrama_edge,
    app: readScriptString(html, "movieSourceAppName"),
    episodes: readEpisodeItems(html),
  };
}

/** Seconds until the rs_ctx token expires, or null if it can't be read. */
function tokenLifetime(token: string | null): number | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64").toString());
    const exp = Number(payload?.exp);
    if (!exp) return null;
    return exp - Math.floor(Date.now() / 1000);
  } catch {
    return null;
  }
}

/**
 * Watch-page context, cached per series.
 *
 * The page is ~900 KB and is fetched only to read the rs_ctx token, the episode
 * list and the upstream app name — the actual stream still comes from a live
 * edge call afterwards. The token is series-scoped (its payload carries the
 * slug but no episode) and runs ~12h, so one fetch serves every episode of a
 * series instead of re-pulling 900 KB per stream request.
 *
 * TTL is bounded by the token's own expiry so a cached context can never
 * outlive the credential it exists to carry.
 */
export async function getWatchContext(
  slug: string,
  episode: number,
): Promise<WatchPageContext | null> {
  const key = `nartodrama:ctx:${slug}`;

  const cached = await Cache.get(key);
  if (cached) {
    try {
      return JSON.parse(cached) as WatchPageContext;
    } catch {
      /* corrupt entry — fall through and refetch */
    }
  }

  const ctx = await fetchWatchPage(slug, episode);
  if (!ctx) return null;

  // Never store the raw HTML.
  const { html: _html, ...storable } = ctx;
  const lifetime = tokenLifetime(ctx.contextToken);
  const ttl = Math.min(lifetime ? lifetime - 300 : 1800, 21600);
  if (ttl > 60) Cache.set(key, JSON.stringify(storable), ttl);

  return ctx;
}

/**
 * Build the edge refresh-source URL. The main domain blocks /refresh-source at
 * nginx (403), so the request always goes to <edgeBase>/e/rs<path><query>.
 */
function buildEdgeUrl(ctx: WatchPageContext, episode: number, force: boolean): string {
  const url = new URL(ctx.refreshBase);
  url.pathname = url.pathname.replace(/\/+$/, "") + `/${Math.max(1, episode)}/refresh-source`;
  if (ctx.contextToken) url.searchParams.set("rs_ctx", ctx.contextToken);
  if (force) {
    url.searchParams.set("force", "1");
    url.searchParams.set("no_cache", "1");
  }
  return ctx.edgeBase.replace(/\/+$/, "") + "/e/rs" + url.pathname + url.search;
}

async function callRefreshSource(
  ctx: WatchPageContext,
  slug: string,
  episode: number,
  force: boolean,
): Promise<RefreshSource | null> {
  const res = await fetchWithRetry(buildEdgeUrl(ctx, episode, force), {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      Referer: watchUrl(slug, episode),
    },
  });
  if (!res) return null;

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return null;
  }

  const parsed = refreshSourceSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * Resolve the signed stream for one episode.
 *
 * Mirrors the site's own direct → repair ladder: ask for the cached source
 * first, and only spend a `force=1` (which makes narto re-query the upstream
 * provider API) when the cheap call comes back unusable. Always forcing would
 * bypass their cache and hammer the upstream on every request.
 */
export async function resolveSource(
  ctx: WatchPageContext,
  slug: string,
  episode: number,
): Promise<RefreshSource | null> {
  try {
    const cheap = await callRefreshSource(ctx, slug, episode, false);
    if (cheap?.ok && (cheap.play_url || cheap.direct_play_url)) return cheap;

    const repaired = await callRefreshSource(ctx, slug, episode, true);
    if (repaired?.ok && (repaired.play_url || repaired.direct_play_url)) return repaired;

    Logger.warn(`nartodrama: no source for ${slug} ep ${episode}`);
    return null;
  } catch (err) {
    Logger.error(err);
    return null;
  }
}
