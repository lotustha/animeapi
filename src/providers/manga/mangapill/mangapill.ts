import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { mangapill } from "../../origins.js";
import type {
  MangaPillCard,
  MangaPillChapter,
  MangaPillDetail,
  MangaPillHome,
  MangaPillRead,
  MangaPillRecentCard,
  MangaPillSearch,
  MangaPillSearchFilters,
} from "./types.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

/** Header the image CDN (cdn.readdetectiveconan.com) needs or it answers 403. */
export const MANGAPILL_IMAGE_HEADERS = { Referer: `${mangapill}/` } as const;

/** Thrown for anything the routes must turn into an error envelope. */
export class MangaPillError extends Error {
  constructor(
    message: string,
    public readonly status: 404 | 502,
  ) {
    super(message);
    this.name = "MangaPillError";
  }
}

// Values the site's own filter form offers. Card badges carry no class that
// says which is which (search colours them, home does not), so a badge is
// classified by its text.
const STATUSES = new Set([
  "publishing",
  "finished",
  "on hiatus",
  "discontinued",
  "not yet published",
]);

const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();

/** "Chapter 271.5" → 271.5; falls back to the chapter code (10271500 → 271.5). */
export function chapterNumber(text: string, code?: string): number | null {
  const m = /Chapter\s+(\d+(?:\.\d+)?)/i.exec(text) ?? /^#\s*(\d+(?:\.\d+)?)$/.exec(text.trim());
  if (m) return parseFloat(m[1]);
  if (code && /^\d{8}$/.test(code)) return (parseInt(code, 10) % 1e7) / 1000;
  return null;
}

/** "/manga/2085/jujutsu-kaisen" → { id: "2085", slug: "jujutsu-kaisen" } */
function mangaHref(href: string | undefined): { id: string; slug: string } | null {
  const m = /\/manga\/(\d+)(?:\/([^/?#]+))?/.exec(href ?? "");
  return m ? { id: m[1], slug: m[2] ?? "" } : null;
}

/** "/chapters/2085-10271500/jujutsu-kaisen-chapter-271.5" → "2085-10271500" */
function chapterHref(href: string | undefined): string | null {
  const m = /\/chapters\/(\d+-\d+)/.exec(href ?? "");
  return m ? m[1] : null;
}

function readBadges(
  $: CheerioAPI,
  card: ReturnType<CheerioAPI>,
): Pick<MangaPillCard, "type" | "status" | "year"> {
  let type: string | null = null;
  let status: string | null = null;
  let year: number | null = null;
  // The first flex-wrap row is type/year/status; a second row holds genres.
  card
    .find("div.flex-wrap")
    .first()
    .children("div")
    .each((_, el) => {
      const text = clean($(el).text());
      if (!text) return;
      if (/^\d{4}$/.test(text)) year = parseInt(text, 10);
      else if (STATUSES.has(text.toLowerCase())) status = text;
      else if (!type) type = text;
    });
  return { type, status, year };
}

/** One manga card (search results, home trending). `link` is the cover anchor. */
function parseMangaCard($: CheerioAPI, link: ReturnType<CheerioAPI>): MangaPillCard | null {
  const ref = mangaHref(link.attr("href"));
  if (!ref) return null;
  const card = link.parent();
  const title = clean(card.find("div.font-black").first().text());
  if (!title) return null;
  const alt = clean(card.find("div.line-clamp-2.text-xs").first().text());
  return {
    id: ref.id,
    slug: ref.slug,
    title,
    altTitle: alt || null,
    cover: link.find("img").attr("data-src") || link.find("img").attr("src") || "",
    ...readBadges($, card),
  };
}

function findSection($: CheerioAPI, heading: RegExp) {
  return $("h4")
    .filter((_, el) => heading.test(clean($(el).text())))
    .first();
}

export function parseSearch(html: string, page: number): MangaPillSearch {
  const $ = cheerio.load(html);
  const results: MangaPillCard[] = [];
  const seen = new Set<string>();
  $('a.relative.block[href^="/manga/"]').each((_, el) => {
    const card = parseMangaCard($, $(el));
    if (card && !seen.has(card.id)) {
      seen.add(card.id);
      results.push(card);
    }
  });
  const hasNextPage = $("a.btn")
    .toArray()
    .some((el) => clean($(el).text()) === "Next");
  return { provider: "MangaPill", page, hasNextPage, results };
}

export function parseGenres(html: string): string[] {
  const $ = cheerio.load(html);
  const genres = $('input[name="genre"]')
    .toArray()
    .map((el) => clean($(el).attr("value")))
    .filter(Boolean);
  return [...new Set(genres)];
}

export function parseHome(html: string): MangaPillHome {
  const $ = cheerio.load(html);

  const trending: MangaPillCard[] = [];
  const trendingHead = findSection($, /^Trending/i);
  trendingHead
    .closest(".container")
    .find('a.relative.block[href^="/manga/"]')
    .each((_, el) => {
      const card = parseMangaCard($, $(el));
      if (card) trending.push(card);
    });

  const recent: MangaPillRecentCard[] = [];
  const recentHead = findSection($, /^New Chapters/i);
  recentHead
    .parent()
    .find('a.relative.block[href^="/chapters/"]')
    .each((_, el) => {
      const link = $(el);
      const chapterId = chapterHref(link.attr("href"));
      const card = link.parent();
      const mangaLink = card.find('a[href^="/manga/"]').first();
      const ref = mangaHref(mangaLink.attr("href"));
      if (!chapterId || !ref) return;
      const title = clean(mangaLink.find("div").first().text());
      if (!title) return;
      const alt = clean(mangaLink.find("div").eq(1).text());
      const badge = clean(card.find('a[href^="/chapters/"] div.font-black').first().text());
      const number = chapterNumber(badge, chapterId.split("-")[1]);
      recent.push({
        id: ref.id,
        slug: ref.slug,
        title,
        altTitle: alt || null,
        cover: link.find("img").attr("data-src") || "",
        type: null,
        status: null,
        year: null,
        chapterId,
        chapterNumber: number,
        chapterTitle: number !== null ? `Chapter ${number}` : badge,
      });
    });

  return { trending, recent };
}

function labelValue($: CheerioAPI, label: string): string | null {
  const el = $("label")
    .filter((_, l) => clean($(l).text()) === label)
    .first();
  const value = clean(el.next("div").text());
  return value || null;
}

/** Returns null when the page is not a manga detail page. */
export function parseDetail(html: string, fallbackId: string): MangaPillDetail | null {
  const $ = cheerio.load(html);
  const h1 = $("h1").first();
  const title = clean(h1.text());
  if (!title) return null;

  const canonical = mangaHref($('link[rel="canonical"]').attr("href"));
  const id = canonical?.id ?? fallbackId;
  const slug = canonical?.slug ?? "";

  const header = h1.parent();
  const alt = clean(header.find("div.text-secondary").first().text());

  const info = h1.closest("div.flex-col");
  const descEl = info.find("p").first().clone();
  descEl.find("br").replaceWith("\n");
  const description = descEl
    .text()
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const cover =
    info.parent().find("img[data-src]").first().attr("data-src") ||
    $('meta[property="og:image"]').attr("content") ||
    "";

  const yearText = labelValue($, "Year");
  const year = yearText && /^\d{4}$/.test(yearText) ? parseInt(yearText, 10) : null;

  const genres = $("label")
    .filter((_, l) => clean($(l).text()) === "Genres")
    .first()
    .parent()
    .find("a")
    .toArray()
    .map((a) => clean($(a).text()))
    .filter(Boolean);

  const chapters: MangaPillChapter[] = [];
  const seen = new Set<string>();
  $('#chapters a[href^="/chapters/"]').each((_, el) => {
    const chId = chapterHref($(el).attr("href"));
    if (!chId || seen.has(chId)) return;
    seen.add(chId);
    const text = clean($(el).text()) || clean($(el).attr("title"));
    chapters.push({ id: chId, number: chapterNumber(text, chId.split("-")[1]), title: text });
  });

  return {
    id,
    slug,
    title,
    altTitle: alt || null,
    cover,
    description,
    type: labelValue($, "Type"),
    status: labelValue($, "Status"),
    year,
    genres,
    chapters,
  };
}

/** Returns null when the page is not a chapter reader page. */
export function parseRead(html: string, chapterId: string): MangaPillRead | null {
  const $ = cheerio.load(html);
  const heading = clean($("h1").first().text());
  if (!heading) return null;
  const canonicalId = chapterHref($('link[rel="canonical"]').attr("href"));
  const id = canonicalId ?? chapterId;
  const [mangaId, code] = id.split("-");
  const titleMatch = /(Chapter\s+\d+(?:\.\d+)?.*)$/i.exec(heading);
  const pages = $("img.js-page")
    .toArray()
    .map((el) => $(el).attr("data-src") || $(el).attr("src") || "")
    .filter(Boolean)
    .map((url, i) => ({ index: i + 1, url }));
  return {
    id,
    mangaId,
    number: chapterNumber(heading, code),
    title: titleMatch ? clean(titleMatch[1]) : heading,
    pages,
    imageHeaders: { ...MANGAPILL_IMAGE_HEADERS },
  };
}

export function buildSearchUrl(filters: MangaPillSearchFilters): string {
  const params = new URLSearchParams();
  params.set("q", filters.q ?? "");
  if (filters.type) params.set("type", filters.type);
  if (filters.status) params.set("status", filters.status);
  for (const g of filters.genres ?? []) params.append("genre", g);
  params.set("page", String(filters.page && filters.page > 0 ? filters.page : 1));
  return `${mangapill}/search?${params.toString()}`;
}

async function fetchHtml(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: `${mangapill}/`,
      },
    });
  } catch (e: any) {
    throw new MangaPillError(`MangaPill unreachable: ${e?.message ?? e}`, 502);
  }
  if (res.status === 404) throw new MangaPillError("Not found on MangaPill", 404);
  if (!res.ok) throw new MangaPillError(`MangaPill answered ${res.status}`, 502);
  return res.text();
}

export class MangaPill {
  static async search(filters: MangaPillSearchFilters): Promise<MangaPillSearch> {
    const html = await fetchHtml(buildSearchUrl(filters));
    return parseSearch(html, filters.page && filters.page > 0 ? filters.page : 1);
  }

  static async home(): Promise<MangaPillHome> {
    const data = parseHome(await fetchHtml(`${mangapill}/`));
    if (!data.trending.length && !data.recent.length) {
      throw new MangaPillError("MangaPill home page had no sections", 502);
    }
    return data;
  }

  static async genres(): Promise<string[]> {
    const genres = parseGenres(await fetchHtml(`${mangapill}/search`));
    if (!genres.length) throw new MangaPillError("MangaPill genre list was empty", 502);
    return genres;
  }

  static async detail(id: string): Promise<MangaPillDetail> {
    const data = parseDetail(await fetchHtml(`${mangapill}/manga/${id}`), id);
    if (!data) throw new MangaPillError("Manga not found", 404);
    return data;
  }

  static async read(chapterId: string): Promise<MangaPillRead> {
    const data = parseRead(await fetchHtml(`${mangapill}/chapters/${chapterId}`), chapterId);
    if (!data) throw new MangaPillError("Chapter not found", 404);
    if (!data.pages.length) throw new MangaPillError("Chapter page had no images", 502);
    return data;
  }
}
