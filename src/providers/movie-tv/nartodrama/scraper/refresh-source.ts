import { Cache } from "../../../../core/cache.js";
import { Logger } from "../../../../core/logger.js";
import { nartodrama, nartodrama_edge } from "../../../origins.js";
import { refreshSourceSchema, episodeItemsSchema } from "../types.js";
import type { RefreshSource } from "../types.js";
import { browserCheckCookie, isBrowserCheck } from "./browser-check.js";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Upstream localizes every catalogue by session locale, and it picks that
// locale from the *caller's IP* on first contact - so the identical request
// answers in English from one host and French from the VPS. `?lang=` overrides
// the geo guess and pins the session for later requests, so every call that can
// carry it does.
//
// This is the DEFAULT, not the only option: every entry point takes a `lang`
// argument and callers may ask for another locale. Upstream advertises 22, but
// only nine carry their own catalogue — en-US, it-IT, de-DE, pt-PT, pl-PL,
// fr-FR, es-ES, ru-RU and tr-TR. The other thirteen (id-ID, ja-JP, ko-KR,
// zh-TW, th-TH, ar-SA, vi-VN, tl-PH, ms-MY, hi-IN, ta-IN, te-IN, bn-BD) return
// the English list verbatim, so asking for them is legal but pointless.
export const LANG = "en-US";

/** Locales that actually have their own catalogue upstream. */
export const LOCALISED = new Set([
  "en-US",
  "it-IT",
  "de-DE",
  "pt-PT",
  "pl-PL",
  "fr-FR",
  "es-ES",
  "ru-RU",
  "tr-TR",
]);

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

export function watchUrl(slug: string, episode: number, lang: string = LANG) {
  return `${nartodrama}/detail/watch/${slug}/${Math.max(1, episode)}?lang=${lang}`;
}

/**
 * Why there is nothing to play — and the difference is the whole point.
 *
 * Every failure in this file used to come back as `null`, and the route turned
 * `null` into 404 "No sources found". So a rate limit, a slow page and a body
 * that would not parse were all reported as "this episode does not exist" — the
 * one answer a player is told not to wait on. Measured from the app side: a
 * burst of ~50 resolves in two minutes made 17 of 25 providers answer "no
 * source", and the same episode resolved in 2s a minute later; on a viewer's
 * tablet the resulting "unavailable" card sat for 1.7 hours until a tap cured it.
 *
 *   gone — upstream ANSWERED, and has nothing. Safe to cache, not worth waiting on.
 *   busy — we could not find out. Never cached; the caller should ask again, and
 *          `retryAfterSec` says when.
 */
export type SourceMiss =
  | {
      kind: "gone";
      // `duplicate`: upstream gave this episode the previous episode's file.
      // See duplicate-episode.ts.
      reason: "series-not-found" | "upstream-refused" | "no-url" | "duplicate";
    }
  | {
      kind: "busy";
      reason: "rate-limited" | "fetch-failed" | "upstream-5xx" | "token-refused" | "bad-body" | "exception";
      retryAfterSec: number;
    };

export type EdgeAnswer = { kind: "ok"; source: RefreshSource } | SourceMiss;

const RETRY_AFTER_MIN_SEC = 5;
const RETRY_AFTER_MAX_SEC = 120;
const RETRY_AFTER_RATE_LIMITED_SEC = 20;
const RETRY_AFTER_BLIP_SEC = 10;

/** Upstream's own `Retry-After`, in seconds, held to a range a player can use. */
function retryAfterFrom(header: string | null | undefined, fallback: number): number {
  const asked = Number(String(header ?? "").trim());
  const seconds = Number.isFinite(asked) && asked > 0 ? asked : fallback;
  return Math.min(Math.max(Math.round(seconds), RETRY_AFTER_MIN_SEC), RETRY_AFTER_MAX_SEC);
}

export const busy = (
  reason: Extract<SourceMiss, { kind: "busy" }>["reason"],
  retryAfterSec = RETRY_AFTER_BLIP_SEC,
): SourceMiss => ({ kind: "busy", reason, retryAfterSec });

/**
 * Read one edge response. Pure, so every row of this table is pinned by a test.
 *
 * `body` is the parsed JSON, or `undefined` when it would not parse — an HTML
 * challenge page on a 200 is "could not find out", not "nothing there".
 * `retryable` has been in the schema all along; nothing read it.
 */
export function classifyEdgeResponse(
  status: number,
  body: unknown,
  retryAfter?: string | null,
): EdgeAnswer {
  if (status === 429) return busy("rate-limited", retryAfterFrom(retryAfter, RETRY_AFTER_RATE_LIMITED_SEC));
  if (status >= 500) return busy("upstream-5xx", retryAfterFrom(retryAfter, RETRY_AFTER_BLIP_SEC));
  if (status === 401 || status === 403) return busy("token-refused");
  if (status === 404) return { kind: "gone", reason: "upstream-refused" };

  const parsed = refreshSourceSchema.safeParse(body);
  if (!parsed.success) return busy("bad-body");

  const source = parsed.data;
  if (!source.ok) {
    return source.retryable === true
      ? busy("upstream-5xx", retryAfterFrom(retryAfter, RETRY_AFTER_BLIP_SEC))
      : { kind: "gone", reason: "upstream-refused" };
  }
  if (!source.play_url && !source.direct_play_url) return { kind: "gone", reason: "no-url" };
  return { kind: "ok", source };
}

/**
 * The verdict when no rung produced a link: the LAST rung asked decides.
 *
 * "Gone" has to be something upstream said, most recently. A cheap rung that
 * said "nothing" followed by a forced rung that could not be reached is not
 * knowledge that the episode is gone — it is a failed attempt to check.
 */
export function missVerdict(rungs: EdgeAnswer[]): SourceMiss {
  const last = [...rungs].reverse().find((r): r is SourceMiss => r.kind !== "ok");
  return last ?? busy("exception");
}

/** The watch page, or why not. A 404 is the series being gone; anything else is not knowing. */
async function fetchWatchPageAnswer(
  slug: string,
  episode: number,
  lang: string,
): Promise<{ ctx: WatchPageContext } | { miss: SourceMiss }> {
  const res = await fetchWithRetry(watchUrl(slug, episode, lang), {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", Cookie: browserCheckCookie() },
  });
  if (!res) return { miss: busy("fetch-failed") };
  if (res.status === 404) return { miss: { kind: "gone", reason: "series-not-found" } };
  if (res.status === 429) {
    return { miss: busy("rate-limited", retryAfterFrom(res.headers.get("retry-after"), RETRY_AFTER_RATE_LIMITED_SEC)) };
  }
  if (!res.ok) return { miss: busy(res.status >= 500 ? "upstream-5xx" : "token-refused") };

  const html = await res.text();
  // The wall answers 200. Not knowing is busy, never "gone".
  if (isBrowserCheck(html)) {
    Logger.warn(`nartodrama: browser check not passed on watch page ${slug} ep ${episode}`);
    return { miss: busy("bad-body") };
  }
  return {
    ctx: {
      html,
      refreshBase:
        readScriptString(html, "refreshSourceBaseUrl") ||
        `${nartodrama}/detail/watch/${slug}?lang=${lang}`,
      contextToken: readScriptString(html, "refreshSourceContextToken"),
      edgeBase: readScriptString(html, "refreshSourceEdgeBase") || nartodrama_edge,
      app: readScriptString(html, "movieSourceAppName"),
      episodes: readEpisodeItems(html),
    },
  };
}

export async function fetchWatchPage(
  slug: string,
  episode: number,
  lang: string = LANG,
): Promise<WatchPageContext | null> {
  const answer = await fetchWatchPageAnswer(slug, episode, lang);
  return "ctx" in answer ? answer.ctx : null;
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
  lang: string = LANG,
): Promise<WatchPageContext | null> {
  const answer = await getWatchContextResult(slug, episode, lang);
  return "ctx" in answer ? answer.ctx : null;
}

// The locale is part of the key. The cached context carries a refreshBase
// built from it, so reusing an English context for a French request would
// silently serve the wrong locale's stream.
const contextKey = (slug: string, lang: string) => `nartodrama:ctx:${lang}:${slug}`;

/**
 * Drop a cached context whose token the edge has stopped accepting.
 *
 * The context is kept for up to six hours on the strength of the token's own
 * expiry, but upstream rotates tokens early sometimes. Without this a refused
 * token would be "busy" on every retry until the cache let go of it — the
 * caller asking again, as told, and getting the same refusal each time.
 */
export function forgetWatchContext(slug: string, lang: string = LANG) {
  return Cache.purgeSingle(contextKey(slug, lang));
}

/** [getWatchContext], but saying WHY when there is none. See [SourceMiss]. */
export async function getWatchContextResult(
  slug: string,
  episode: number,
  lang: string = LANG,
): Promise<{ ctx: WatchPageContext } | { miss: SourceMiss }> {
  const key = contextKey(slug, lang);

  const cached = await Cache.get(key);
  if (cached) {
    try {
      return { ctx: JSON.parse(cached) as WatchPageContext };
    } catch {
      /* corrupt entry — fall through and refetch */
    }
  }

  const answer = await fetchWatchPageAnswer(slug, episode, lang);
  if (!("ctx" in answer)) return answer;
  const { ctx } = answer;

  // Never store the raw HTML.
  const { html: _html, ...storable } = ctx;
  const lifetime = tokenLifetime(ctx.contextToken);
  const ttl = Math.min(lifetime ? lifetime - 300 : 1800, 21600);
  if (ttl > 60) Cache.set(key, JSON.stringify(storable), ttl);

  return answer;
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
): Promise<EdgeAnswer> {
  const res = await fetchWithRetry(buildEdgeUrl(ctx, episode, force), {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      Referer: watchUrl(slug, episode),
    },
  });
  if (!res) return busy("fetch-failed");

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = undefined;
  }

  return classifyEdgeResponse(res.status, json, res.headers.get("retry-after"));
}

/**
 * When a signed URL stops working, in unix seconds — if the URL says so itself.
 *
 * The provider CDNs sign their links and most of them put the deadline in the
 * query string in one of three spellings: CloudFront's `Expires=<ts>`, Aliyun's
 * `auth_key=<ts>-…`, and the Akamai-style token's `exp=<ts>`. Null when the URL
 * carries none of them, which means "cannot tell", never "does not expire".
 *
 * The token form nests it — `?__token__=exp=<ts>~acl=…` — which is why `=` is an
 * accepted lead-in alongside `?`, `&` and `~`.
 *
 * Ten digits exactly: a unix time in seconds. Anything else in those positions
 * is some other parameter that happens to share a name, and guessing at it
 * would be worse than not knowing.
 */
export function signedUrlExpiry(url: string | null | undefined): number | null {
  const match = String(url ?? "").match(/[?&~=](?:Expires|auth_key|exp)=(\d{10})(?!\d)/);
  return match ? Number(match[1]) : null;
}

/** A minute of grace: a link that dies while the player is opening it is dead. */
const EXPIRY_MARGIN_SEC = 60;

/**
 * Whether a refresh-source answer is worth handing to a player.
 *
 * "Has a URL" was the whole test, and it is not enough. narto caches what the
 * provider gave it and goes on serving that answer long after the signature in
 * it has lapsed — measured on NetShort, the largest source in the catalogue:
 * `ok: true` with a link that had expired seven weeks earlier, 403 on every
 * route, while `force=1` on the same episode returned a fresh link that played.
 * The cached answer LOOKED usable, so the repair rung was never reached and
 * the episode was simply dead to every viewer.
 *
 * The deadline is written in the URL, so checking it costs no request.
 */
export function isUsableSource(source: RefreshSource | null, nowSec = Date.now() / 1000): boolean {
  if (!source?.ok) return false;
  const urls = [source.direct_play_url, source.play_url].filter(Boolean) as string[];
  if (urls.length === 0) return false;
  return !urls.some((url) => {
    const expiry = signedUrlExpiry(url);
    return expiry !== null && expiry < nowSec + EXPIRY_MARGIN_SEC;
  });
}

/**
 * Episodes force-refreshed lately, by `slug#episode` → when.
 *
 * The brake on [isRefusedByCdn]. A probe that keeps failing for a reason a
 * refresh cannot cure — this server geo-blocked by a CDN that serves viewers
 * fine — would otherwise turn every request for that episode into a `force=1`
 * against narto, which is exactly the hammering the cheap-first ladder exists
 * to avoid. One forced refresh per episode per window; after that the cached
 * answer is trusted again and the viewer's own connection decides.
 */
const recentlyForced = new Map<string, number>();
const FORCE_COOLDOWN_MS = 10 * 60_000;

/**
 * How often a player may demand a fresh link for one episode.
 *
 * Short, because the request is evidence (the link really did fail for
 * someone) — but not zero: a client stuck in a retry loop, or a title upstream
 * cannot re-sign at all, must not become a `force=1` per second against narto.
 * Inside the window a fresh request is answered like an ordinary one.
 */
const FRESH_COOLDOWN_MS = 30_000;
const PROBE_TIMEOUT_MS = 4000;

/**
 * Whether the CDN refuses the link in a cached answer — for links that do not
 * say when they expire.
 *
 * [isUsableSource] reads the deadline out of the URL, which costs nothing, but
 * some providers sign with an opaque token that carries no readable date.
 * Melolo is one: its cached link answered `410 melolo-edge: link expired`
 * while `force=1` on the same episode returned one that played (measured from
 * outside the VPS, so not the geo-block this file elsewhere attributes 410s
 * to). For those the only way to know is to ask, so this spends one ranged
 * request for a single byte.
 *
 * Deliberately narrow:
 *  - skipped when any URL carries a readable deadline — that case is already
 *    decided, for free;
 *  - only 401/403/410 count. A timeout, a 5xx or a network error is "could not
 *    tell", and not knowing is not a reason to bypass narto's cache;
 *  - skipped for an episode forced within [FORCE_COOLDOWN_MS].
 */
async function isRefusedByCdn(
  source: RefreshSource | null,
  slug: string,
  episode: number,
  probe: CdnProbe = probeCdn,
): Promise<boolean> {
  const urls = [source?.direct_play_url, source?.play_url].filter(Boolean) as string[];
  if (urls.some((url) => signedUrlExpiry(url) !== null)) return false;

  const url = urls.find((u) => /^https?:\/\//i.test(u));
  if (!url) return false;

  const forcedAt = recentlyForced.get(`${slug}#${episode}`);
  if (forcedAt && Date.now() - forcedAt < FORCE_COOLDOWN_MS) return false;
  // Bounded: entries are only useful for the cooldown, so drop the stale ones
  // whenever the map has grown rather than on a timer nobody would maintain.
  if (recentlyForced.size > 2000) {
    for (const [key, at] of recentlyForced) {
      if (Date.now() - at >= FORCE_COOLDOWN_MS) recentlyForced.delete(key);
    }
  }

  try {
    const status = await probe(url);
    return status === 401 || status === 403 || status === 410;
  } catch {
    return false;
  }
}

/** Ask a CDN for one byte of a link. The status is the answer; the body is not wanted. */
export type CdnProbe = (url: string) => Promise<number>;

async function probeCdn(url: string): Promise<number> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Range: "bytes=0-0" },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  // Do not leave the connection holding a body nobody reads.
  void res.body?.cancel().catch(() => {});
  return res.status;
}

/**
 * Whether a cached answer is worth handing to a player — the CDN having the
 * last word when the date in the link says no.
 *
 * [isUsableSource] condemns a link whose readable deadline has passed, and it
 * was wrong about FlexTV: that provider stamps every link with its IMPORT time
 * (`auth_key=1784842668-…`, July) and the CDN serves it months later. Measured
 * 2026-09-24 on "Die vorübergehende Braut des CEOs": every cold resolve was
 * called dead, forced against narto — the expensive call, past narto's cache
 * to the provider — and came back with the identical link. Two upstream calls
 * per resolve, on the provider whose viewer had just drawn narto's 429.
 *
 * So a lapsed date now costs one ranged request instead of a forced refresh:
 *  - the CDN serves the byte (2xx) → the date was not a deadline; use the link;
 *  - it refuses (401/403/410) → dead, as NetShort's really are; force;
 *  - it cannot be asked (timeout, 5xx, network) → the date stands; force, as
 *    before this check existed. Unlike the opaque-token case, here there IS
 *    evidence against the link, so not knowing does not rescue it.
 * A link without a readable date is judged as before, by [isRefusedByCdn].
 */
export async function isServable(
  source: RefreshSource | null,
  slug: string,
  episode: number,
  probe: CdnProbe = probeCdn,
  nowSec = Date.now() / 1000,
): Promise<boolean> {
  if (!source?.ok) return false;
  const urls = [source.direct_play_url, source.play_url].filter(Boolean) as string[];
  if (urls.length === 0) return false;
  if (isUsableSource(source, nowSec)) return !(await isRefusedByCdn(source, slug, episode, probe));

  const lapsed = urls.find((url) => {
    const expiry = signedUrlExpiry(url);
    return expiry !== null && expiry < nowSec + EXPIRY_MARGIN_SEC && /^https?:\/\//i.test(url);
  });
  if (!lapsed) return false;
  try {
    const status = await probe(lapsed);
    return status >= 200 && status < 300;
  } catch {
    return false;
  }
}

/**
 * Resolve the signed stream for one episode.
 *
 * Mirrors the site's own direct → repair ladder: ask for the cached source
 * first, and only spend a `force=1` (which makes narto re-query the upstream
 * provider API) when the cheap call comes back unusable. Always forcing would
 * bypass their cache and hammer the upstream on every request.
 *
 * "Unusable" includes a link that has already expired — see [isUsableSource].
 * The repaired answer is NOT held to that test: by then there is nothing left
 * to try, and a link this code only suspects is dead is still a better answer
 * than none if the suspicion is wrong.
 */
export async function resolveSource(
  ctx: WatchPageContext,
  slug: string,
  episode: number,
  options: { fresh?: boolean } = {},
): Promise<RefreshSource | null> {
  const answer = await resolveSourceResult(ctx, slug, episode, options);
  return answer.kind === "ok" ? answer.source : null;
}

const isRateLimited = (answer: EdgeAnswer) => answer.kind === "busy" && answer.reason === "rate-limited";

/**
 * [resolveSource], but saying WHY when there is no link. See [SourceMiss].
 *
 * One rule is new rather than renamed: A RATE-LIMITED RUNG ENDS THE LADDER. The
 * rungs used to be told apart only by "got a link" and "did not", so a 429 on
 * the cheap call looked like a dead cache entry and was answered with a forced
 * call — a second request, and the expensive kind, at the exact moment upstream
 * had asked for fewer. Under a burst that doubled the load that caused it.
 */
export async function resolveSourceResult(
  ctx: WatchPageContext,
  slug: string,
  episode: number,
  options: { fresh?: boolean } = {},
  call: typeof callRefreshSource = callRefreshSource,
  probe: CdnProbe = probeCdn,
): Promise<EdgeAnswer> {
  const rungs: EdgeAnswer[] = [];
  try {
    // A player reported the last link dead: skip the cached rung altogether.
    // The probe below can be fooled — a CDN that answers this server but
    // refuses the viewer, a token that lapses between the probe and the play —
    // and the viewer's own failed attempt cannot.
    const tag = `${slug}#${episode}`;
    const forcedAt = recentlyForced.get(tag);
    if (options.fresh && !(forcedAt && Date.now() - forcedAt < FRESH_COOLDOWN_MS)) {
      recentlyForced.set(tag, Date.now());
      const demanded = await call(ctx, slug, episode, true);
      if (demanded.kind === "ok") return demanded;
      if (isRateLimited(demanded)) return demanded;
      rungs.push(demanded);
      // Upstream had nothing new; fall through to the ordinary ladder rather
      // than answer with nothing.
    }

    const cheap = await call(ctx, slug, episode, false);
    const cached = cheap.kind === "ok" ? cheap.source : null;
    if (await isServable(cached, slug, episode, probe)) return cheap;
    if (isRateLimited(cheap)) return cheap;
    rungs.push(cheap);
    if (cached) Logger.warn(`nartodrama: cached source for ${slug} ep ${episode} is dead — forcing a refresh`);
    recentlyForced.set(tag, Date.now());

    const repaired = await call(ctx, slug, episode, true);
    if (repaired.kind === "ok") return repaired;
    rungs.push(repaired);

    const verdict = missVerdict(rungs);
    Logger.warn(`nartodrama: no source for ${slug} ep ${episode} — ${verdict.kind} (${verdict.reason})`);
    return verdict;
  } catch (err) {
    Logger.error(err);
    return busy("exception");
  }
}
