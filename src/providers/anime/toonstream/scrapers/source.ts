import * as cheerio from "cheerio";
import { Cache } from "../lib/cache.js";
import {
  ASCDN_SOURCE_TTL,
  EPISODE_IFRAMES_TTL,
  MOVIE_IFRAMES_TTL,
  PROXIFY,
  RUBYSTREAM_SOURCE_TTL,
  TOONSTREAM_BASE,
  UserAgent,
  VIDMOLY_SOURCE_TTL,
  embedPlayerOrigins,
} from "../lib/const.js";
import { absolute } from "../lib/parse.js";
import { proxifySource } from "../lib/proxy.js";
import { DirectSource } from "../lib/types.js";
import { getAsCdnSource } from "./embed/as-cdn.js";
import { getRubystmSource } from "./embed/rubystm.js";
import { getVidmolyDirectSource, isVidmolyUrl } from "./embed/vidmoly.js";

/**
 * Pulls the player list off a watch page.
 *
 * The rebuilt site no longer puts external player URLs in the page. Each entry
 * under `aside#aa-options` is now an internal `/embed/<hash>` iframe (the first
 * is eager-loaded via `src`, the rest lazy via `data-src`), and that page holds
 * a single iframe pointing at the real host. So this is one extra hop per
 * player compared to the old scraper.
 */
export function getEmbedPaths(html: string): string[] {
  const $ = cheerio.load(html);
  const paths: string[] = [];

  $("#aa-options iframe, aside#aa-options iframe, .video iframe").each((_, el) => {
    const src = $(el).attr("src") ?? $(el).attr("data-src");
    if (!src) return;
    // Skip trailers and anything that isn't the site's own embed indirection.
    if (!/\/embed\/[a-z0-9]+/i.test(src)) return;
    const abs = absolute(src);
    if (!paths.includes(abs)) paths.push(abs);
  });

  return paths;
}

/** Resolves one /embed/<hash> page down to the external player URL it wraps. */
async function resolveEmbed(embedUrl: string, referer: string): Promise<string | null> {
  try {
    const res = await fetch(embedUrl, {
      headers: { "User-Agent": UserAgent, Referer: referer },
    });
    if (!res.ok) return null;
    const $ = cheerio.load(await res.text());
    const src = $("iframe").first().attr("src") ?? $("iframe").first().attr("data-src");
    return src && /^https?:\/\//i.test(src) ? src : null;
  } catch (err) {
    console.log("Error resolving embed", embedUrl, err);
    return null;
  }
}

export async function getPlayerIframeUrls(pageHtml: string, pageUrl: string): Promise<string[]> {
  const embedPaths = getEmbedPaths(pageHtml);
  const out: string[] = [];

  for (const path of embedPaths) {
    const resolved = await resolveEmbed(path, pageUrl);
    if (resolved && !out.includes(resolved)) out.push(resolved);
  }

  console.log(`Scraped ${out.length} player iframe url(s) from ${embedPaths.length} embed(s)`);
  return out;
}

async function getPageEmbeds(pageUrl: string, cacheKey: string, ttl: number): Promise<string[]> {
  const cached = await Cache.get(cacheKey, true);
  if (cached) return cached;

  try {
    const res = await fetch(pageUrl, { headers: { "User-Agent": UserAgent } });
    if (!res.ok) throw new Error("Failed to fetch " + pageUrl);

    const urls = await getPlayerIframeUrls(await res.text(), pageUrl);
    if (urls.length > 0) Cache.set(cacheKey, true, urls, ttl);
    return urls;
  } catch (err) {
    console.log("ERROR", err);
    return [];
  }
}

/** Episode slugs are "<series-slug>-<season>x<episode>". */
export async function getEpisodeEmbeds(epSlug: string): Promise<string[]> {
  return getPageEmbeds(
    `${TOONSTREAM_BASE}/episode/${epSlug}/`,
    `episode:iframes:${epSlug}`,
    EPISODE_IFRAMES_TTL,
  );
}

export async function getMovieEmbeds(slug: string): Promise<string[]> {
  return getPageEmbeds(
    `${TOONSTREAM_BASE}/movies/${slug}`,
    `movie:iframes:${slug}`,
    MOVIE_IFRAMES_TTL,
  );
}

const { asCdnOrigin, rubyStreamOrigin } = embedPlayerOrigins;

// Only these three reduce to a direct stream. The rest (gdmirrorbot,
// cloudy.upns, abyssplayer, blakiteapi, emturbovid) stay embeds for the client
// to iframe — they hide their sources behind obfuscated/encrypted players.
export async function resolveDirectSource(url: string): Promise<DirectSource | null> {
  let scrape: (() => Promise<DirectSource | null | undefined>) | null = null;
  let ttl = 0;

  if (url.startsWith(asCdnOrigin)) {
    scrape = () => getAsCdnSource(url);
    ttl = ASCDN_SOURCE_TTL;
  } else if (url.startsWith(rubyStreamOrigin)) {
    scrape = () => getRubystmSource(url);
    ttl = RUBYSTREAM_SOURCE_TTL;
  } else if (isVidmolyUrl(url)) {
    // Short TTL: the signed m3u8 carries e=43200 (12h) and goes stale.
    scrape = () => getVidmolyDirectSource(url);
    ttl = VIDMOLY_SOURCE_TTL;
  }

  if (!scrape) return null;

  try {
    const key = `source:${url}`;
    let src: DirectSource | null = await Cache.get(key, true);

    if (!src) {
      src = (await scrape()) ?? null;
      if (src) Cache.set(key, true, src, ttl);
    }

    if (!src) return null;
    return PROXIFY ? proxifySource(src) : src;
  } catch (err) {
    console.log("Error:", err);
    return null;
  }
}
