import * as cheerio from "cheerio";
import { Cache } from "../lib/cache.js";
import {
  ASCDN_SOURCE_TTL,
  embedPlayerOrigins,
  RUBYSTREAM_SOURCE_TTL,
  UserAgent,
  VIDMOLY_SOURCE_TTL,
} from "../lib/const.js";
import { absolute } from "../lib/parse.js";
import { proxifySource } from "../lib/proxy.js";
import { DirectSource } from "../lib/types.js";
import { getAsCdnSource } from "./embed/as-cdn.js";
import { getRubystmSource } from "./embed/rubystm.js";
import { getVidmolyDirectSource, isVidmolyUrl } from "./embed/vidmoly.js";
import { PROXIFY } from "../route.js";

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

const { asCdnOrigin, rubyStreamOrigin } = embedPlayerOrigins;

// Only these two reduce to a direct stream. The rest (gdmirrorbot, cloudy.upns,
// abyssplayer, blakiteapi, emturbovid) are returned as embeds for the client to
// iframe — they hide their sources behind obfuscated/encrypted players.
export async function getDirectSources(playerIframeUrls: string[]) {
  const directSources: DirectSource[] = [];

  for (const url of playerIframeUrls) {
    try {
      if (url.startsWith(asCdnOrigin)) {
        const key = `source:${url}`;
        const cachedSource = await Cache.get(key, true);

        if (cachedSource) {
          directSources.push(cachedSource);
        } else {
          const src = await getAsCdnSource(url);
          if (src) {
            Cache.set(key, true, src, ASCDN_SOURCE_TTL);
            directSources.push(src);
          }
        }
      } else if (url.startsWith(rubyStreamOrigin)) {
        const key = `source:${url}`;
        const cachedSource = await Cache.get(key, true);

        if (cachedSource) {
          directSources.push(cachedSource);
        } else {
          const src = await getRubystmSource(url);
          if (src) {
            Cache.set(key, true, src, RUBYSTREAM_SOURCE_TTL);
            directSources.push(src);
          }
        }
      } else if (isVidmolyUrl(url)) {
        const key = `source:${url}`;
        const cachedSource = await Cache.get(key, true);

        if (cachedSource) {
          directSources.push(cachedSource);
        } else {
          const src = await getVidmolyDirectSource(url);
          if (src) {
            // Short TTL: the signed m3u8 carries e=43200 (12h) and goes stale.
            Cache.set(key, true, src, VIDMOLY_SOURCE_TTL);
            directSources.push(src);
          }
        }
      } else console.log("No source-scraper found for", url, "- skipping");
    } catch (err) {
      console.log("Error:", err);
    }
  }

  console.log(`Successfully Scraped ${directSources.length} direct source(s)`);

  if (PROXIFY) {
    return directSources.map((src) => proxifySource(src));
  } else {
    return directSources;
  }
}
