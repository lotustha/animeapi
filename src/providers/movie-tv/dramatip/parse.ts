import * as cheerio from "cheerio";
import type { DramaCard, DramaEpisode } from "../nartodrama/types.js";

// Everything that turns a dramatip page into data, with no network in it, so
// it can be tested against saved pages.
//
// dramatip is a Next.js App Router site. Its HTML is server-rendered, and the
// same data is repeated in the RSC "flight" payload (`self.__next_f.push`
// chunks). Cards and JSON-LD are read from the HTML, which is the stable part;
// the flight payload is used only for what the HTML does not say plainly: the
// episode list and the first episode's stream descriptor.

export const DRAMATIP = "https://dramatip.net";

/** Site locales, by the language part of ours. English has no path prefix. */
const LOCALES = new Set([
  "en", "de", "es", "ru", "fr", "ar", "ko", "th", "pt", "it", "ja", "id", "vi", "fil", "hi", "ms",
]);

/**
 * Our locale ("hi-IN") as dramatip's ("hi"), or null when it has none.
 * Tagalog is "fil" there and "tl" in some of our callers.
 */
export function siteLocale(lang: string | undefined | null): string | null {
  const base = String(lang ?? "en").trim().toLowerCase().split(/[-_]/)[0] || "en";
  const code = base === "tl" ? "fil" : base;
  return LOCALES.has(code) ? code : null;
}

/** `/series/page/2` in a locale: `/hi/series/page/2`. */
export function localePath(locale: string, path: string): string {
  return (locale === "en" ? "" : `/${locale}`) + path;
}

export interface DramatipCard extends DramaCard {
  /** "EP 55" on the card, when it says. */
  totalEpisodes: number | null;
}

/**
 * The site's image loader appends a width to every poster (`?w=3840`,
 * `@w=3840`). The bare URL is the original; a 3840px poster in a grid of
 * thumbnails is not what anyone wants to download.
 */
export function cleanPoster(url: string | undefined | null): string {
  return String(url ?? "").replace(/[?@&]w=\d+$/, "");
}

/**
 * Every title card on a listing page (home, source, category, search).
 *
 * ONLY THE CARDS INSIDE AN `<article>`. Every page also carries a "trending"
 * rail in its sidebar - the same handful of titles whatever the page is - as
 * plain list links. Read along with the grid, the rail came back as the first
 * results of every search: "mafia boss" and "billionaire" opened on the same
 * six unrelated titles (2026-11-19, caught on the first live call).
 *
 * In a card the title is the poster's `alt`, and an "EP 55" badge gives the
 * episode count.
 */
export function parseCards(html: string): DramatipCard[] {
  const $ = cheerio.load(html);
  const bySlug = new Map<string, DramatipCard>();

  $("article a[href*='/series/']").each((_, el) => {
    const link = $(el);
    const match = (link.attr("href") || "").match(/\/series\/([a-z0-9][a-z0-9-]*)\/?$/i);
    if (!match || match[1] === "page") return;
    const slug = match[1];
    const card = link.closest("article");

    const img = card.find("img").first();
    const title = (img.attr("alt") || card.find("h2,h3").first().text() || "").trim();
    if (!title || bySlug.has(slug)) return;

    const ep = card.text().match(/EP\s*(\d+)/i);
    bySlug.set(slug, {
      id: slug,
      title,
      url: `${DRAMATIP}/series/${slug}`,
      poster: cleanPoster(img.attr("src") || img.attr("data-src")),
      totalEpisodes: ep ? Number(ep[1]) : null,
    });
  });

  return [...bySlug.values()];
}

/** The highest page number the pagination links to, or 1. */
export function lastPage(html: string): number {
  let max = 1;
  for (const m of html.matchAll(/href="[^"]*(?:\/page\/|[?&](?:amp;)?page=)(\d+)"/g)) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max;
}

/** The RSC flight payload of a page, as one string. */
export function flightOf(html: string): string {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      out += JSON.parse(m[1]);
    } catch {
      /* a chunk that is not a JSON string literal carries nothing we read */
    }
  }
  return out;
}

/**
 * A balanced `{...}` or `[...]` starting at [from], which must be its opening
 * bracket. Strings are skipped, so a brace inside a synopsis does not end it.
 */
export function balanced(text: string, from: number): string | null {
  const open = text[from];
  const close = open === "{" ? "}" : open === "[" ? "]" : "";
  if (!close) return null;
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return null;
}

/** The JSON value after `"key":` in [text], parsed, or null. */
export function jsonAfter(text: string, key: string): unknown {
  const at = text.indexOf(`"${key}":`);
  if (at < 0) return null;
  const start = at + key.length + 3;
  const raw = balanced(text, start);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** One entry of a stream descriptor's `chain`. */
export interface ChainEntry {
  enc?: string;
  type?: string;
  source?: string;
  refresh?: boolean;
  refreshAfter?: number | null;
  encByQuality?: Record<string, string>;
}

export interface Descriptor {
  source?: string;
  chain?: ChainEntry[];
  subtitle?: { enc?: string; format?: string; language?: string } | null;
}

export interface ParsedInfo {
  title: string;
  description: string;
  poster: string;
  /** The upstream app as dramatip names it: "DramaBox", "ShortTV". */
  sourceName: string;
  totalEpisodes: number;
  tags: string[];
  episodes: DramaEpisode[];
  /** Episode one's stream descriptor, which the detail page already carries. */
  first: Descriptor | null;
}

/**
 * A detail page (`/series/<slug>`).
 *
 * Title, synopsis and poster come from the JSON-LD `TVSeries` block, which is
 * there for search engines and so is the least likely thing to change. The
 * episode list is only in the flight payload, as `chapter_id` / `serial_number`
 * objects; they are read one by one rather than as an array because the array
 * has `$`-references to other parts of the payload inside it.
 */
export function parseInfo(html: string, slug: string): ParsedInfo | null {
  const $ = cheerio.load(html);

  let series: Record<string, unknown> | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (series) return;
    try {
      const data = JSON.parse($(el).text());
      const nodes = Array.isArray(data?.["@graph"]) ? data["@graph"] : [data];
      series = nodes.find((n: any) => n?.["@type"] === "TVSeries") ?? null;
    } catch {
      /* malformed ld+json: try the next block */
    }
  });

  const ld = (series ?? {}) as Record<string, any>;
  const title = String(ld.name || $("h1").first().text() || "").trim();
  if (!title) return null;

  const flight = flightOf(html);

  const episodes: DramaEpisode[] = [];
  const seen = new Set<number>();
  for (const m of flight.matchAll(
    /"chapter_id":"?[^",}]*"?,"serial_number":(\d+),"cover":("(?:[^"\\]|\\.)*"|null)(?:[^{}]*?"is_locked":(true|false))?/g,
  )) {
    const number = Number(m[1]);
    if (!Number.isFinite(number) || number < 1 || seen.has(number)) continue;
    seen.add(number);
    let cover = "";
    try {
      cover = m[2] === "null" ? "" : String(JSON.parse(m[2]));
    } catch {
      cover = "";
    }
    episodes.push({
      id: `${slug}-${number}`,
      number,
      title: `Episode ${number}`,
      thumbnail: cover,
      isPlayable: m[3] !== "true",
    });
  }
  // Fallback: the player's own list, which is numbers only.
  if (episodes.length === 0) {
    for (const m of flight.matchAll(/\{"serial_number":(\d+),"qualities":/g)) {
      const number = Number(m[1]);
      if (seen.has(number)) continue;
      seen.add(number);
      episodes.push({
        id: `${slug}-${number}`,
        number,
        title: `Episode ${number}`,
        thumbnail: "",
        isPlayable: true,
      });
    }
  }
  episodes.sort((a, b) => a.number - b.number);

  const first = jsonAfter(flight, "sourceFirst") as Descriptor | null;
  const declared = Number(ld.numberOfEpisodes);

  const genre = ld.genre;
  const tags = (Array.isArray(genre) ? genre : genre ? [genre] : [])
    .map((g: unknown) => String(g).trim())
    .filter(Boolean);

  const image = Array.isArray(ld.image) ? ld.image[0] : ld.image;
  return {
    title,
    description: String(ld.description || "").trim(),
    poster: cleanPoster(
      typeof image === "string" ? image : image?.url || $("meta[property='og:image']").attr("content"),
    ),
    sourceName: String(first?.source || first?.chain?.[0]?.source || "").trim(),
    totalEpisodes: Number.isFinite(declared) && declared > 0 ? declared : episodes.length,
    tags,
    episodes,
    first: first && typeof first === "object" ? first : null,
  };
}

/** Every upstream app on `/sources`: its key, display name and title count. */
export function parseSources(html: string): { key: string; label: string; count: number }[] {
  const $ = cheerio.load(html);
  const out = new Map<string, { key: string; label: string; count: number }>();
  $("a[href*='/source/']").each((_, el) => {
    const link = $(el);
    const match = (link.attr("href") || "").match(/\/source\/([a-z0-9-]+)\/?$/i);
    if (!match) return;
    const leaves = link
      .find("*")
      .filter((_, n) => $(n).children().length === 0)
      .map((_, n) => $(n).text().trim())
      .get()
      .filter(Boolean);
    const texts = leaves.length > 0 ? leaves : [link.text().trim()];
    const countText = texts.map((t) => t.replace(/[,.\s]/g, "").match(/^(\d+)/)).find(Boolean);
    const label = texts.find((t) => !/^\d/.test(t)) || match[1];
    const count = countText ? Number(countText[1]) : 0;
    const known = out.get(match[1]);
    // The header menu links every app with no count; the grid has the count.
    if (!known || count > known.count) out.set(match[1], { key: match[1], label, count });
  });
  return [...out.values()].sort((a, b) => b.count - a.count);
}

/** "DramaBox" -> "dramabox": the key the rest of our system files an app under. */
export function appKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
