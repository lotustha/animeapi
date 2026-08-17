import { Cache } from "./cache.js";
import { Logger } from "./logger.js";

// Filler flags for episode lists, sourced from Jikan (MyAnimeList).
//
// None of the scraped sites carry real filler data anymore: anizen's JSON API
// has a per-episode `filler` field that is false for every episode of every
// show (verified against Naruto/Bleach/One Piece, which have hundreds of
// canonical fillers between them), and anikai's episode markup has no filler
// class at all. MAL is the de-facto source of truth, so /info enriches its
// episode lists from Jikan's paginated episodes endpoint instead.
//
// Jikan is rate-limited (3 req/s, 60 req/min) and long shows span many pages
// (One Piece ≈ 12), so results are cached hard: a completed walk goes into
// Cache for a week, plus an in-process memo so a disabled Cache backend
// doesn't turn every /info call into a full Jikan crawl.

const JIKAN = "https://api.jikan.moe/v4";
const MAX_PAGES = 25; // 100 eps/page → covers 2500 episodes, above any current show
const SET_TTL = 7 * 86400;
const MISS_TTL = 86400;

const memo = new Map<string, { at: number; value: string }>();
const MEMO_TTL_MS = 6 * 60 * 60_000;

async function memoized(key: string): Promise<string | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.value;
  const cached = await Cache.get(key);
  if (cached) memo.set(key, { at: Date.now(), value: cached });
  return cached ?? null;
}

function remember(key: string, value: string, ttl: number): void {
  memo.set(key, { at: Date.now(), value });
  Cache.set(key, value, ttl);
}

async function jikanJson(url: string): Promise<any | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      // Retry once on rate limiting and on Jikan's not-uncommon transient
      // 5xx (504s under load) instead of failing the whole walk.
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Episode numbers MAL marks as filler for the given anime. Returns an empty
 * set on unknown/invalid ids or when Jikan is unreachable — callers keep
 * their episodes' isFiller at false rather than failing the request.
 */
export async function getFillerEpisodes(malId: number | string | undefined): Promise<Set<number>> {
  const id = parseInt(String(malId ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) return new Set();

  const key = `fillers:mal:${id}`;
  const cached = await memoized(key);
  if (cached) return new Set(JSON.parse(cached));

  const fillers: number[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await jikanJson(`${JIKAN}/anime/${id}/episodes?page=${page}`);
    if (!json || !Array.isArray(json.data)) {
      // Incomplete walk — return what we have but don't cache it, or a
      // half-crawled list would look authoritative for a week.
      Logger.warn(`Fillers: Jikan walk for MAL ${id} died on page ${page}`);
      return new Set(fillers);
    }
    for (const ep of json.data) {
      if (ep?.filler === true && Number.isFinite(ep.mal_id)) fillers.push(ep.mal_id);
    }
    if (!json.pagination?.has_next_page) {
      remember(key, JSON.stringify(fillers), SET_TTL);
      return new Set(fillers);
    }
  }
  return new Set(fillers);
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// AniList's GraphQL search is the primary resolver: it returns idMal directly
// and stays up when Jikan's search index 504s (which it does for whole query
// terms at a time — "bleach" searches failed for hours while "naruto" worked).
async function anilistSearch(term: string): Promise<any[] | null> {
  const query = `query ($s: String) {
    Page(perPage: 10) {
      media(search: $s, type: ANIME) { idMal title { romaji english native } synonyms }
    }
  }`;
  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { s: term } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const media = json?.data?.Page?.media;
    return Array.isArray(media) ? media : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a MAL id from a title, for sites (anikai) that no longer link MAL
 * themselves. Only an exact normalized-title match counts — a fuzzy first-hit
 * would attach the wrong show's filler list, which is worse than none.
 * Misses are cached (as "0") so unknown titles don't re-search on every
 * /info call.
 */
export async function resolveMalId(
  ...titles: (string | undefined | null)[]
): Promise<number | null> {
  const wanted = titles.filter((t): t is string => !!t?.trim()).map(normalizeTitle);
  if (wanted.length === 0) return null;

  const key = `fillers:malid:${wanted[0]!.replace(/\s+/g, "-")}`;
  const cached = await memoized(key);
  if (cached) return cached === "0" ? null : parseInt(cached, 10);

  const media = await anilistSearch(wanted[0]!);
  if (media) {
    for (const m of media) {
      const candidates: string[] = [
        m?.title?.romaji,
        m?.title?.english,
        m?.title?.native,
        ...(Array.isArray(m?.synonyms) ? m.synonyms : []),
      ].filter(Boolean);
      if (m?.idMal && candidates.some((c) => wanted.includes(normalizeTitle(c)))) {
        remember(key, String(m.idMal), SET_TTL);
        return m.idMal;
      }
    }
    remember(key, "0", MISS_TTL);
    return null;
  }

  // AniList unreachable — fall back to Jikan's search.
  const json = await jikanJson(`${JIKAN}/anime?q=${encodeURIComponent(wanted[0]!)}&limit=10`);
  const results = Array.isArray(json?.data) ? json.data : [];

  for (const entry of results) {
    const candidates: string[] = [
      entry?.title,
      entry?.title_english,
      ...(Array.isArray(entry?.titles) ? entry.titles.map((t: any) => t?.title) : []),
    ].filter(Boolean);
    if (candidates.some((c) => wanted.includes(normalizeTitle(c)))) {
      remember(key, String(entry.mal_id), SET_TTL);
      return entry.mal_id;
    }
  }

  // Only cache the miss when the upstream actually answered; a network blip
  // shouldn't suppress resolution for a day.
  if (json) remember(key, "0", MISS_TTL);
  return null;
}
