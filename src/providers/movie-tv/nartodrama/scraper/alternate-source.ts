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
 * Keyed by source app so a second site (ReelAll serves DramaBox and FlexTV per
 * episode) can be added as another entry.
 */
export interface AlternateSite {
  name: string;
  /** narto `movieSourceAppName` values this site carries per episode. */
  apps: ReadonlySet<string>;
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
  return text
    .replace(/&#0?39;|&#8217;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

const VIBESHORT = "https://vibeshort.org";
const FETCH_TIMEOUT_MS = 8000;

async function page(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
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

const SITES: AlternateSite[] = [vibeShort];

const MAP_TTL = 21600;
const MISS_TTL = 3600;
const NO_MATCH = "-";

/**
 * A playable link for `episode` from the first alternate site that carries it,
 * or null. `title` may be the slug: [normaliseTitle] makes the two compare equal.
 * The series lookup is cached, misses included, so a title no site carries
 * costs its searches once an hour at most.
 */
export async function alternateSource(
  app: string | null,
  title: string,
  episodeCount: number,
  episode: number,
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
    return await Promise.race([lookup(app, title, episodeCount, episode, sites, probe), deadline]);
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
  sites: AlternateSite[],
  probe: (url: string) => Promise<number>,
): Promise<{ site: string; url: string } | null> {
  // A slug (no spaces) is searched as words; a real title as written — its
  // own hyphens ("10-Year-Old") are what the site's search matches on.
  const query = /\s/.test(title) ? title.trim() : title.replace(/-/g, " ");
  for (const site of sites) {
    if (!site.apps.has(app)) continue;
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
