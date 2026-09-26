import { Cache } from "../../../../core/cache.js";
import { Logger } from "../../../../core/logger.js";
import { probeCdn, UA } from "./refresh-source.js";

/**
 * Another site carrying the same upstream app's episodes — asked only when
 * narto has said an episode is GONE, never when it is merely busy.
 *
 * Why: narto sometimes cannot re-sign an episode at all. "Bow to 10-Year-Old
 * Archmage Aldric" (ShortMax) eps 70–72 and 75–76 on 2026-09-25: the forced
 * refresh handed back the same `410 link expired`, while VibeShort served the
 * very same episodes straight from ShortMax's own CDN, from this server, with
 * links that also play from a viewer's IP.
 *
 * Keyed by source app: VibeShort carries ShortMax, ReelAll carries DramaBox
 * and FlexTV (see [reelAll]).
 */
export interface AlternateSite {
  name: string;
  /**
   * narto `movieSourceAppName` values this site carries per episode, in
   * LOWERCASE — [lookup] lowercases the app before asking.
   */
  apps: ReadonlySet<string>;
  /**
   * narto locales (`?lang=`) this site may answer for. Absent = every locale.
   * The series-map cache key carries no locale, so this is checked BEFORE the
   * cache: an en-US hit must not be handed to a tl-PH request whose titles
   * happen to read as English.
   */
  langs?: ReadonlySet<string>;
  /** The site's key for a series, or null. Must match title AND episode count. */
  find(title: string, episodeCount: number): Promise<string | null>;
  /** A stream URL for one episode, or null. */
  episodeUrl(key: string, episode: number): Promise<string | null>;
}

/** Lowercase letters and digits only — so a slug and its title compare equal. */
export function normaliseTitle(title: string): string {
  return decodeEntities(title)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function decodeEntities(text: string): string {
  return (
    text
      .replace(/&#0?39;|&#8217;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      // Any other numeric entity. ReelAll writes "All&#8230; My" (an ellipsis);
      // left encoded, [normaliseTitle] kept its digits ("all8230my") and the
      // title never matched narto's (2026-09-26).
      .replace(/&#(\d+);/g, (m, n) => fromCodePoint(Number(n)) ?? m)
      .replace(/&#x([0-9a-f]+);/gi, (m, n) => fromCodePoint(parseInt(n, 16)) ?? m)
      // Last, so "&amp;#39;" stays the literal text it encodes.
      .replace(/&amp;/g, "&")
  );
}

function fromCodePoint(code: number): string | null {
  try {
    return String.fromCodePoint(code);
  } catch {
    return null;
  }
}

const VIBESHORT = "https://vibeshort.org";
const FETCH_TIMEOUT_MS = 8000;

async function page(url: string, accept = "text/html"): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Search results as `[key, title]`: each card links `/detail/<key>` and names the title in its cover's alt. */
export function readVibeShortCards(html: string): Array<[string, string]> {
  const cards: Array<[string, string]> = [];
  for (const m of html.matchAll(/href="\/detail\/([^"]+)"[^>]*class="drama-card"[\s\S]*?alt="([^"]*)"/g)) {
    cards.push([m[1], decodeEntities(m[2])]);
  }
  return cards;
}

/** The last episode a detail page links to — its episode count. */
export function readVibeShortEpisodeCount(html: string, key: string): number {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let max = 0;
  for (const m of html.matchAll(new RegExp(`href="/watch/${escaped}/(\\d+)"`, "g"))) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

export const vibeShort: AlternateSite = {
  name: "vibeshort",
  // Only apps checked episode-for-episode against narto. VibeShort also lists
  // DramaBox, NetShort and KalosTV; add them once one title each is checked.
  apps: new Set(["shortmax"]),
  // English only, made explicit on 2026-09-26. VibeShort lists English titles
  // with English subtitles; before this gate a non-English request still
  // searched it, but with narto's localised title, so it could only ever match
  // a title that reads the same in English — and then serve English subs to
  // someone who asked for another language. en-US is the app's default locale
  // and the case this fallback was built for (the Archmage episodes), so the
  // gate keeps that and drops only the accidental cases.
  langs: new Set(["en-US"]),

  async find(title, episodeCount) {
    const html = await page(`${VIBESHORT}/search?q=${encodeURIComponent(title)}`);
    if (!html) return null;
    const wanted = normaliseTitle(title);
    const hit = readVibeShortCards(html).find(([, name]) => normaliseTitle(name) === wanted);
    if (!hit) return null;
    // Same title is not enough: a copy cut into a different number of episodes
    // would silently play the wrong episode for every number.
    const detail = await page(`${VIBESHORT}/detail/${hit[0]}`);
    if (!detail || readVibeShortEpisodeCount(detail, hit[0]) !== episodeCount) return null;
    return hit[0];
  },

  async episodeUrl(key, episode) {
    const html = await page(`${VIBESHORT}/watch/${key}/${episode}`);
    return html?.match(/videoUrl\s*=\s*"(https:[^"]+)"/)?.[1] ?? null;
  },
};

// ─── ReelAll ────────────────────────────────────────────────────────────────
// Measured 2026-09-25/26: a WordPress site whose REST search finds a series by
// title (punctuation included), and whose /api/<code>/<id>/<ep>.mp4 answers a
// 302 to the origin app's own CDN — but only for codes db/dx (DramaBox) and ft
// (FlexTV). Every other code (sm, rs, fr, ns, gs) answers 404 "Not an mp4
// source" or 403 "Origin required", so those are never asked. About a quarter
// of titles answer 503/404 for every episode; the probe in [lookup] weeds
// those out per episode. No Cloudflare. English only (subbed AND dubbed).

const REELALL = "https://reelall.com";
/** Series pages fetched per search, at most — all in parallel, inside the 6s deadline. */
const REELALL_PAGES = 3;

/**
 * A ReelAll title without its SEO tail. Three forms seen (2026-09-26):
 * search JSON "<T> — Watch Full Series All Episodes", and og:title
 * "<T> Eng Sub — Watch…" / "<T> Eng Dub — Watch…". Entities decoded first,
 * since the dash itself may arrive as one.
 */
export function reelAllTitle(raw: string): string {
  return decodeEntities(raw)
    .replace(/\s*(?:Eng(?:lish)?\s+(?:Sub|Dub)\s*)?[—–-]\s*Watch Full Series\b.*$/i, "")
    .trim();
}

interface ReelAllHit {
  code: string;
  id: string;
  title: string;
  url: string;
}

/**
 * Series from a wp-json search answer, for the given codes only. The id comes
 * from the URL (`/<slug>-dx-42000024470/`): the JSON `id` is the WordPress
 * post id, not the app's series id. Only reelall.com URLs are kept — they are
 * fetched next. Titles that already match `wanted` (normalised) go first, so
 * the few pages fetched are the likely ones.
 */
export function readReelAllSearch(json: string, codes: readonly string[], wanted: string): ReelAllHit[] {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const tail = new RegExp(`-(${codes.map((c) => c.replace(/[^a-z0-9]/gi, "")).join("|")})-(\\d+)\\/?$`);
  const hits: ReelAllHit[] = [];
  for (const row of rows) {
    const url = typeof row?.url === "string" ? row.url : "";
    if (!url.startsWith(`${REELALL}/`)) continue;
    const m = url.match(tail);
    if (!m) continue;
    hits.push({ code: m[1], id: m[2], title: reelAllTitle(typeof row?.title === "string" ? row.title : ""), url });
  }
  const matches = (t: string) => normaliseTitle(t) === wanted;
  return [...hits.filter((h) => matches(h.title)), ...hits.filter((h) => !matches(h.title))];
}

/**
 * Title and episode count of a series page. The count is read off the player
 * element whose `data-series` is this id — the page also carries cards for
 * other series, and its attributes span several lines.
 */
export function readReelAllSeries(html: string, id: string): { title: string; episodes: number } | null {
  const og = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/)?.[1];
  const count = html.match(new RegExp(`data-series="${id}"[\\s\\S]{0,500}?data-episodes="(\\d+)"`))?.[1];
  if (og === undefined || !count) return null;
  return { title: reelAllTitle(og), episodes: Number(count) };
}

/**
 * One ReelAll entry per narto app, so each has its own name in logs, cache
 * keys and /health counters. `get` is the fetcher, swapped in tests.
 */
export function reelAll(
  name: string,
  apps: readonly string[],
  codes: readonly string[],
  get: (url: string, accept?: string) => Promise<string | null> = page,
): AlternateSite {
  return {
    name,
    apps: new Set(apps.map((a) => a.toLowerCase())),
    // English only: every ReelAll series is English (subbed or dubbed), and
    // its search matches on English titles.
    langs: new Set(["en-US"]),

    async find(title, episodeCount) {
      const json = await get(
        `${REELALL}/wp-json/wp/v2/search?search=${encodeURIComponent(title)}&per_page=10`,
        "application/json",
      );
      if (!json) return null;
      const wanted = normaliseTitle(title);
      const candidates = readReelAllSearch(json, codes, wanted).slice(0, REELALL_PAGES);
      // In parallel: search + three pages one after another would not fit the
      // shared 6s deadline on a slow afternoon.
      const pages = await Promise.all(
        candidates.map((c) => get(c.url).catch(() => null)),
      );
      for (let i = 0; i < candidates.length; i++) {
        const html = pages[i];
        if (!html) continue;
        const series = readReelAllSeries(html, candidates[i].id);
        // Same rule as VibeShort: title AND episode count, or a copy cut
        // differently plays the wrong episode for every number.
        if (series && normaliseTitle(series.title) === wanted && series.episodes === episodeCount) {
          return `${candidates[i].code}/${candidates[i].id}`;
        }
      }
      return null;
    },

    // A stable URL, not the CDN link: it 302s to the origin, which the probe
    // follows (plain fetch does), so what is judged is the origin's answer.
    async episodeUrl(key, episode) {
      return `${REELALL}/api/${key}/${episode}.mp4`;
    },
  };
}

export const reelAllDramaBox = reelAll("reelall-dramabox", ["dramabox"], ["db", "dx"]);
export const reelAllFlexTv = reelAll("reelall-flextv", ["flextv"], ["ft"]);

const SITES: AlternateSite[] = [vibeShort, reelAllDramaBox, reelAllFlexTv];

const MAP_TTL = 21600;
const MISS_TTL = 3600;
const NO_MATCH = "-";

/**
 * A playable link for `episode` from the first alternate site that carries it,
 * or null. `title` may be the slug: [normaliseTitle] makes the two compare equal.
 * The series lookup is cached, misses included, so a title no site carries
 * costs its searches once an hour at most. `lang` is the request's narto
 * locale: a site with `langs` is only asked for those (see [AlternateSite]).
 */
export async function alternateSource(
  app: string | null,
  title: string,
  episodeCount: number,
  episode: number,
  lang: string,
  sites: AlternateSite[] = SITES,
  probe: (url: string) => Promise<number> = probeCdn,
  deadlineMs: number = DEADLINE_MS,
): Promise<{ site: string; url: string } | null> {
  if (!app || episodeCount < 1) return null;
  // Bounded as a whole: a first lookup is search + detail + watch + probe, and
  // ani-nexus gives the entire resolve 25s, reading its own timeout as busy. A
  // slow site must cost a quick "gone", not turn it into endless retries.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
  });
  try {
    return await Promise.race([lookup(app, title, episodeCount, episode, lang, sites, probe), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const DEADLINE_MS = 6000;

async function lookup(
  app: string,
  title: string,
  episodeCount: number,
  episode: number,
  lang: string,
  sites: AlternateSite[],
  probe: (url: string) => Promise<number>,
): Promise<{ site: string; url: string } | null> {
  // A slug (no spaces) is searched as words; a real title as written — its
  // own hyphens ("10-Year-Old") are what the site's search matches on.
  const query = /\s/.test(title) ? title.trim() : title.replace(/-/g, " ");
  // Lowercased: narto's keys are lowercase ("dramabox", "flextv") but ctx.app
  // is whatever the page wrote, and before this fix a capitalised "DramaBox"
  // would have skipped every site without a word (review, 2026-09-26).
  const appKey = app.toLowerCase();
  for (const site of sites) {
    if (!site.apps.has(appKey)) continue;
    // Before the cache: its key has no locale (see [AlternateSite.langs]).
    if (site.langs && !site.langs.has(lang)) continue;
    try {
      const mapKey = `nartodrama:alt:${site.name}:${normaliseTitle(title)}:${episodeCount}`;
      let key = await Cache.get(mapKey);
      if (!key) {
        key = (await site.find(query, episodeCount)) ?? NO_MATCH;
        // A slug-only search misses titles whose own hyphens matter; its miss
        // must not stand in for what the real title would have found.
        if (key !== NO_MATCH || query === title.trim()) {
          Cache.set(mapKey, key, key === NO_MATCH ? MISS_TTL : MAP_TTL);
        }
      }
      if (key === NO_MATCH) continue;
      const url = await site.episodeUrl(key, episode);
      if (!url) continue;
      const status = await probe(url);
      if (status >= 200 && status < 300) return { site: site.name, url };
    } catch (err) {
      Logger.warn(`nartodrama: alternate ${site.name} failed for "${title}" ep ${episode}: ${String(err)}`);
    }
  }
  return null;
}
