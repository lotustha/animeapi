import * as cheerio from "cheerio";
// The HLS variant parser is provider-agnostic; keep one copy rather than
// duplicating it per provider.
import { fetchVariants } from "../anizen/scraper/hls.js";
// Typed against animekai's schemas on purpose: toonstream's contract is
// "exactly the same node output as anikai", and importing the types makes the
// compiler enforce that.
import type {
  AnimeKaiEpisode,
  AnimeKaiInfo,
  AnimeKaiPagedResult,
  AnimeKaiSearchItem,
  AnimeKaiServer,
} from "../animekai/types.js";
import { TOONSTREAM_BASE, UserAgent } from "./lib/const.js";
import { parseCard, parsePagination } from "./lib/parse.js";
import { proxifyUrl } from "./lib/proxy.js";
import { AnimeCard } from "./lib/types.js";
import { ScrapeHomePage } from "./scrapers/home.js";
import { ScrapeMovieInfo, ScrapeMovies } from "./scrapers/movie.js";
import { ScrapeSearch } from "./scrapers/search.js";
import { ScrapeSeries, ScrapeSeriesInfo } from "./scrapers/series.js";
import { getEpisodeEmbeds, getMovieEmbeds, resolveDirectSource } from "./scrapers/source.js";

// ─── ID scheme ────────────────────────────────────────────────────────────────
//
// The source site splits titles across /movies/<slug> and /series/<slug>, so
// the type is folded into the id the same way anikai folds the episode into
// its: ids are opaque to clients and round-trip through search → info → watch.
//
//   anime id   : movie$<slug>            | series$<slug>
//   episode id : movie$<slug>$ep=1       | series$<slug>$ep=<season>x<episode>

type Kind = "movie" | "series";

function parseId(id: string): { kind: Kind; slug: string } {
  const [head, ...rest] = id.split("$");
  if ((head === "movie" || head === "series") && rest.length > 0) {
    return { kind: head, slug: rest[0]! };
  }
  // Bare slug — assume series, the overwhelmingly common case.
  return { kind: "series", slug: head! };
}

function parseEpisodeId(episodeId: string): { kind: Kind; slug: string; sxe: string } {
  const { kind, slug } = parseId(episodeId);
  const ep = /\$ep=([^$]+)/.exec(episodeId)?.[1] ?? "1x1";
  const sxe = /^\d+x\d+$/.test(ep) ? ep : `1x${ep}`;
  return { kind, slug, sxe };
}

// ─── Node mappers ─────────────────────────────────────────────────────────────

function toSearchItem(card: AnimeCard): AnimeKaiSearchItem {
  return {
    id: `${card.type}$${card.slug}`,
    title: card.title,
    url: card.url,
    image: card.poster,
    japaneseTitle: null,
    type: card.type === "movie" ? "MOVIE" : "TV",
    sub: 0,
    dub: 0,
    episodes: 0,
  };
}

function paged(
  cards: AnimeCard[] | undefined,
  pagination: { current: number; end: number } | undefined,
): AnimeKaiPagedResult<AnimeKaiSearchItem> {
  const results = (cards ?? []).map(toSearchItem);
  const current = pagination?.current ?? 1;
  const end = pagination?.end ?? current;
  return {
    currentPage: results.length === 0 ? 0 : current,
    hasNextPage: results.length === 0 ? false : current < end,
    totalPages: results.length === 0 ? 0 : end,
    results,
  };
}

/** Human label for an embed host: "https://cloudy.upns.one/x" → "Cloudy". */
function hostLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const name = host.split(".")[0] ?? host;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "Embed";
  }
}

export class Toonstream {
  // ─── Browsing ──────────────────────────────────────────────────────────────

  static async search(
    query: string,
    page: number = 1,
  ): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    const res = await ScrapeSearch(query, page);
    return paged(res?.data, res?.pagination);
  }

  static async suggestions(query: string): Promise<any[]> {
    const res = await ScrapeSearch(query, 1);
    return (res?.data ?? []).slice(0, 10).map((card) => ({
      id: `${card.type}$${card.slug}`,
      title: card.title,
      url: card.url,
      japaneseTitle: null,
      image: card.poster,
      type: card.type === "movie" ? "MOVIE" : "TV",
      year: "",
      sub: 0,
      dub: 0,
      episodes: 0,
    }));
  }

  static async movies(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    const res = await ScrapeMovies(page);
    return paged(res?.data, res?.pagination);
  }

  static async tv(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    const res = await ScrapeSeries(page);
    return paged(res?.data, res?.pagination);
  }

  static async spotlight(): Promise<any[]> {
    const home = await ScrapeHomePage();
    const rail = home?.main?.[0]?.data ?? [];
    return rail.map((card) => ({
      id: `${card.type}$${card.slug}`,
      title: card.title,
      japaneseTitle: null,
      banner: card.poster,
      url: card.url,
      type: card.type === "movie" ? "MOVIE" : "TV",
      genres: [],
      releaseDate: "",
      quality: "",
      sub: 0,
      dub: 0,
      description: "",
    }));
  }

  /** Latest-episodes rail off the home page — a single page upstream. */
  static async recentEpisodes(): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    const home = await ScrapeHomePage();
    const results: AnimeKaiSearchItem[] = [];
    for (const ep of home?.lastEpisodes ?? []) {
      const seriesSlug = ep.slug.replace(/-\d+x\d+$/, "");
      const epNum = Number(/\d+x(\d+)/.exec(ep.slug)?.[1]) || 0;
      results.push({
        id: `series$${seriesSlug}`,
        title: ep.title,
        url: `${TOONSTREAM_BASE}/series/${seriesSlug}`,
        image: ep.thumbnail,
        japaneseTitle: null,
        type: "TV",
        sub: epNum,
        dub: epNum,
        episodes: epNum,
      });
    }
    return {
      currentPage: results.length === 0 ? 0 : 1,
      hasNextPage: false,
      totalPages: results.length === 0 ? 0 : 1,
      results,
    };
  }

  // ─── Genres ────────────────────────────────────────────────────────────────

  static async genres(): Promise<string[]> {
    try {
      const res = await fetch(`${TOONSTREAM_BASE}/home`, {
        headers: { "User-Agent": UserAgent },
      });
      if (!res.ok) return [];
      const $ = cheerio.load(await res.text());
      const seen = new Set<string>();
      $('a[href*="/category/"]').each((_, el) => {
        const slug = ($(el).attr("href") ?? "").split("/category/")[1]?.split(/[/?#]/)[0];
        if (slug) seen.add(slug.toLowerCase());
      });
      return [...seen];
    } catch (err) {
      console.log("ERROR", err);
      return [];
    }
  }

  static async genreSearch(
    genre: string,
    page: number = 1,
  ): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    try {
      const url = `${TOONSTREAM_BASE}/category/${genre}?type=all&page=${page}`;
      const res = await fetch(url, { headers: { "User-Agent": UserAgent } });
      if (!res.ok) throw new Error("Failed to fetch " + url);

      const $ = cheerio.load(await res.text());
      const cards: AnimeCard[] = [];
      $("section.movies ul.post-lst li, article.post").each((_, item) => {
        const card = parseCard($, item);
        if (card && !cards.some((c) => c.slug === card.slug && c.type === card.type)) {
          cards.push(card);
        }
      });

      return paged(cards, parsePagination($, page));
    } catch (err) {
      console.log("ERROR", err);
      return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    }
  }

  // ─── Info ──────────────────────────────────────────────────────────────────

  // Everything the site serves is multi-audio (its players expose several
  // language tracks in one stream), so both toggles are advertised and every
  // audio type resolves to the same servers.
  static async info(id: string): Promise<AnimeKaiInfo | null> {
    const { kind, slug } = parseId(id);
    const base = {
      hasSub: true,
      hasDub: true,
      subOrDub: "both" as const,
      recommendations: [],
      relations: [],
    };

    if (kind === "movie") {
      const d = await ScrapeMovieInfo(slug);
      if (!d) return null;
      const url = `${TOONSTREAM_BASE}/movies/${slug}`;
      return {
        id: `movie$${slug}`,
        title: d.title,
        japaneseTitle: null,
        image: d.image,
        description: d.description,
        type: "MOVIE",
        url,
        ...base,
        genres: d.genres.map((g) => g.name),
        status: "",
        season: d.year,
        duration: d.duration,
        episodes: [
          {
            id: `movie$${slug}$ep=1`,
            number: 1,
            title: d.title,
            isFiller: false,
            isSubbed: true,
            isDubbed: true,
            url,
          },
        ],
        totalEpisodes: 1,
      };
    }

    const d = await ScrapeSeriesInfo(slug);
    if (!d) return null;

    const episodes: AnimeKaiEpisode[] = [];
    for (const season of d.seasons) {
      for (const ep of season.episodes) {
        const sxe =
          /(\d+x\d+)$/.exec(ep.slug)?.[1] ??
          /(\d+x\d+)/.exec(ep.epXseason)?.[1] ??
          `${season.season_no}x${ep.episode_no}`;
        const number = episodes.length + 1;
        episodes.push({
          id: `series$${slug}$ep=${sxe}`,
          number,
          title: ep.title || `Episode ${number}`,
          isFiller: false,
          isSubbed: true,
          isDubbed: true,
          url: ep.url,
        });
      }
    }

    return {
      id: `series$${slug}`,
      title: d.title,
      japaneseTitle: null,
      image: d.image,
      description: d.description,
      type: "TV",
      url: `${TOONSTREAM_BASE}/series/${slug}`,
      ...base,
      genres: d.genres.map((g) => g.name),
      status: "",
      season: d.year,
      duration: d.runtime ?? "",
      episodes,
      totalEpisodes: episodes.length,
    };
  }

  // ─── Streams ───────────────────────────────────────────────────────────────

  private static async embedsFor(episodeId: string): Promise<string[]> {
    const { kind, slug, sxe } = parseEpisodeId(episodeId);
    return kind === "movie" ? getMovieEmbeds(slug) : getEpisodeEmbeds(`${slug}-${sxe}`);
  }

  static async streams(
    episodeId: string,
    type?: "softsub" | "dub" | "hardsub",
  ): Promise<{ isDub: boolean; results: any[] }> {
    try {
      const embeds = await this.embedsFor(episodeId);

      // as-cdn21 (Multi Audio), rubystm (Ruby) and vidmoly reduce to a direct
      // stream; the other hosts stay iframes for the client to embed.
      const results = await Promise.all(
        embeds.map(async (embedUrl) => {
          const src = await resolveDirectSource(embedUrl);

          if (!src) {
            return {
              name: `Toonstream ${hostLabel(embedUrl)}`,
              iframe: embedUrl,
              subtitles: [],
              download: null,
              sources: [{ file: embedUrl, type: "iframe" }],
            };
          }

          // Sources that only play with headers (vidmoly's network-bound m3u8,
          // as-cdn's cookie) always carry proxiedUrl — serve that as the file
          // so every node is directly playable, like anikai's HLS entries.
          const file = src.proxiedUrl || src.url;
          const node: any = {
            name: `Toonstream ${src.label ?? hostLabel(embedUrl)}`,
            iframe: embedUrl,
            subtitles: src.subtitles
              ? [{ url: src.subtitles.url, lang: src.subtitles.label || "English", type: "soft" }]
              : [],
            download: null,
            sources: [{ file, type: src.type }],
          };

          if (src.type === "hls") {
            const variants = await fetchVariants(src.url, src.headers ?? {});
            if (variants.length > 0) {
              // If the master had to be proxied, its variant playlists need the
              // same wrapping to stay playable.
              node.qualities =
                file === src.url
                  ? variants
                  : variants.map((v) => ({
                      ...v,
                      file: proxifyUrl(v.file, "hls", src.headers ?? {}),
                    }));
            }
          }

          return node;
        }),
      );

      // Direct streams first so clients default to a playable source.
      results.sort((a: any, b: any) => {
        const rank = (r: any) => (r.sources[0]?.type === "iframe" ? 1 : 0);
        return rank(a) - rank(b);
      });

      return { isDub: type === "dub", results };
    } catch (err) {
      console.log("ERROR", err);
      return { isDub: false, results: [] };
    }
  }

  static async servers(
    episodeId: string,
    type?: "softsub" | "dub" | "hardsub",
  ): Promise<AnimeKaiServer[]> {
    try {
      const embeds = await this.embedsFor(episodeId);
      return embeds.map((url) => ({
        name: `toonstream ${hostLabel(url)}`.toLowerCase(),
        url,
        isDub: type === "dub",
        // The site ships no skip markers.
        intro: { start: 0, end: 0 },
        outro: { start: 0, end: 0 },
      }));
    } catch (err) {
      console.log("ERROR", err);
      return [];
    }
  }
}
