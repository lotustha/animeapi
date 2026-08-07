import type { CheerioAPI } from "cheerio";
import { TOONSTREAM_BASE } from "./const.js";
import { AnimeCard } from "./types.js";

// The rebuilt site kept the old DooPlay-style card markup but now emits
// *relative* hrefs (/series/foo, /movies/bar) instead of absolute ones, and the
// clickable link moved onto a trailing <a class="lnk-blk"> rather than wrapping
// the article. Everything below centralises those two differences so the
// individual scrapers stay thin.

export function absolute(href: string | undefined): string {
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  return TOONSTREAM_BASE + (href.startsWith("/") ? href : `/${href}`);
}

/** Last non-empty path segment: "/series/foo/" and "/series/foo" both → "foo". */
export function slugOf(href: string): string {
  try {
    const path = /^https?:\/\//i.test(href) ? new URL(href).pathname : href;
    const parts = path.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "";
  } catch {
    return "";
  }
}

export function typeOf(href: string): "movie" | "series" {
  return /\/series\//i.test(href) ? "series" : "movie";
}

export function isEpisodeHref(href: string): boolean {
  return /\/episode\//i.test(href);
}

/**
 * Parses one `<li>`/`<article>` card from any listing grid (home rails, search
 * results, /series and /movies pages all share it). Returns null for the
 * decorative slides that carry no link.
 */
export function parseCard($: CheerioAPI, item: any): AnimeCard | null {
  const el = $(item);
  const href = el.find("a.lnk-blk").attr("href") ?? el.find("a").attr("href") ?? "";
  if (!href) return null;
  // Episode cards share this markup but aren't titles — the "latest episodes"
  // rail is parsed separately into LastEpisode[]. Without this they'd be
  // reported as movies whose slug is "<series>-1x4".
  if (isEpisodeHref(href)) return null;

  const title = el.find(".entry-title").first().text().trim();
  const poster =
    el.find(".post-thumbnail img, .post-thumbnail2 img, figure img").first().attr("src") ?? "";
  if (!title || !poster) return null;

  // "TMDB 7.4" → 7.4; absent on some rails.
  const voteText = el.find(".vote").first().text().replace(/TMDB/i, "").trim();
  const tmdbRating = Number(voteText);

  return {
    type: typeOf(href),
    title,
    slug: slugOf(href),
    poster,
    url: absolute(href),
    tmdbRating: Number.isFinite(tmdbRating) ? tmdbRating : 0,
  };
}

/** Reads `nav.pagination` — last numbered page link is the total. */
export function parsePagination($: CheerioAPI, current: number) {
  let end = 1;
  $("nav.pagination a.page-link").each((_, a) => {
    const n = Number($(a).text().trim());
    if (Number.isFinite(n) && n > end) end = n;
  });
  return { current, start: 1, end };
}
