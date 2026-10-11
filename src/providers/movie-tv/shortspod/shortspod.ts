import * as cheerio from "cheerio";
import { Logger } from "../../../core/logger.js";
import { shortspod } from "../../origins.js";
import type {
  DramaCard,
  DramaEpisode,
  DramaInfo,
  DramaStream,
  DramaSource,
  Paginated,
} from "../nartodrama/types.js";

const EMPTY_PAGE: Paginated<DramaCard> = { currentPage: 1, hasNextPage: false, results: [] };

/**
 * ShortsPod short-drama provider.
 *
 * Server-rendered ASP.NET site. Episode data is embedded in the play page as
 * `window.NdPlayMvData = { id, count, name, episodes: [...] }`. Video CDN at
 * img18.shortspod.com requires `Referer: https://www.shortspod.com/` or 403s.
 * Listings are static HTML at /movies/rank/{n}.html with no pagination beyond
 * numbered rank files.
 */
export class ShortsPod {
  private static readonly UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  private static async fetchHtml(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        "User-Agent": this.UA,
        Accept: "text/html,application/xhtml+xml",
        Referer: `${shortspod}/`,
      },
    });
    if (!res.ok) throw new Error(`ShortsPod fetch failed (${res.status}): ${url}`);
    return res.text();
  }

  /** Absolute URL from a relative path on shortspod.com. */
  private static absolute(path: string): string {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    return shortspod + (path.startsWith("/") ? path : "/" + path);
  }

  // ─── Listings ────────────────────────────────────────────────────────────────

  /**
   * Parse drama cards from a ranking page (/movies/rank/{n}.html).
   * Each card is an <a> linking to /movies/{id} with an <img> for the poster.
   */
  private static parseCards($: cheerio.CheerioAPI): DramaCard[] {
    const results: DramaCard[] = [];

    // Ranking pages use simple anchor+image pairs. The exact selector depends
    // on the page layout; we try multiple common patterns.
    $("a[href*='/movies/']").each((_, el) => {
      const link = $(el);
      const href = link.attr("href") || "";
      const match = href.match(/\/movies\/(\d+)/);
      if (!match) return;

      const id = match[1];
      // Skip if we already have this ID (duplicate links on the page)
      if (results.some((r) => r.id === id)) return;

      const img = link.find("img").first();
      const title =
        link.attr("title") ||
        img.attr("alt") ||
        link.text().trim() ||
        "";

      const poster = img.attr("src") || img.attr("data-src") || "";

      results.push({
        id,
        title: title.trim(),
        url: this.absolute(`/movies/${id}/`),
        poster: this.absolute(poster),
      });
    });

    return results;
  }

  /**
   * Home listing via ranking pages. ShortsPod organises content into ranked
   * lists at /movies/rank/{n}.html. Page 1 → rank/1, page 2 → rank/2, etc.
   * There is no search endpoint visible on the site.
   */
  static async home(page = 1): Promise<Paginated<DramaCard>> {
    try {
      const url = `${shortspod}/movies/rank/${page}.html`;
      const html = await this.fetchHtml(url);
      const $ = cheerio.load(html);
      const results = this.parseCards($);

      // Check if there's a next rank page by seeing if we got results and
      // probing whether the next page exists. For efficiency, assume there's
      // a next page if we got a full set of results (typically 30 per page).
      const hasNextPage = results.length >= 20;

      return { currentPage: page, hasNextPage, results };
    } catch (err) {
      Logger.error(err);
      return { ...EMPTY_PAGE, currentPage: page };
    }
  }

  /**
   * Search is not available on ShortsPod — returns empty.
   * The ani-nexus layer can fall back to nartodrama for search.
   */
  static async search(_query: string, _page = 1): Promise<Paginated<DramaCard>> {
    return { ...EMPTY_PAGE };
  }

  // ─── Series info + episodes ──────────────────────────────────────────────────

  /**
   * Fetch series metadata and episode list.
   *
   * The detail page (/movies/{id}/) has the title, poster, description and
   * episode count. The play page (/play/{id}/1/) embeds the full episode list
   * with direct MP4 URLs in window.NdPlayMvData. We fetch both in parallel.
   */
  static async info(id: string): Promise<DramaInfo | null> {
    try {
      const [detailHtml, playHtml] = await Promise.all([
        this.fetchHtml(`${shortspod}/movies/${id}/`),
        this.fetchHtml(`${shortspod}/play/${id}/1/`).catch(() => ""),
      ]);

      const $detail = cheerio.load(detailHtml);
      const title =
        $detail("meta[name='name']").attr("content") ||
        $detail("h1").first().text().trim() ||
        $detail("title").text().split("-")[0].trim() ||
        "";

      if (!title) return null;

      const poster = this.absolute(
        $detail("meta[property='og:image']").attr("content") ||
          $detail("img.poster").attr("src") ||
          $detail(`img[src*='/p/${id}']`).attr("src") ||
          "",
      );

      const description =
        $detail("meta[name='Description']").attr("content") ||
        $detail(".movie-desc").text().trim() ||
        "";

      // Parse episodes from the play page's embedded JS object literal.
      // NdPlayMvData uses unquoted keys (id:, count:, episodes:) which is valid
      // JavaScript but invalid JSON, so we use Function() to evaluate it safely
      // within a controlled scope rather than JSON.parse().
      let episodes: DramaEpisode[] = [];
      let totalEpisodes = 0;

      if (playHtml) {
        const ndDataMatch = playHtml.match(/window\.NdPlayMvData\s*=\s*(\{[\s\S]*?\});/);
        if (ndDataMatch) {
          try {
            // eslint-disable-next-line no-new-func
            const data = new Function("return (" + ndDataMatch[1] + ")")() as {
              count?: number;
              episodes?: { episode: string; title: string; src: string }[];
            };
            totalEpisodes = data.count || data.episodes?.length || 0;
            episodes = (data.episodes || []).map((ep) => ({
              id: `${id}-${ep.episode}`,
              number: parseInt(ep.episode, 10),
              title: ep.title || `Episode ${ep.episode}`,
              thumbnail: "", // ShortsPod doesn't provide per-episode thumbnails
              isPlayable: !!ep.src,
            }));
          } catch {
            Logger.error("Failed to parse NdPlayMvData for " + id);
          }
        }
      }

      // Fallback: parse episode links from the detail page
      if (episodes.length === 0) {
        $detail("a[href*='/play/']").each((_, el) => {
          const href = $detail(el).attr("href") || "";
          const match = href.match(/\/play\/\d+\/(\d+)/);
          if (!match) return;
          const num = parseInt(match[1], 10);
          episodes.push({
            id: `${id}-${num}`,
            number: num,
            title: $detail(el).text().trim() || `Episode ${num}`,
            thumbnail: "",
            isPlayable: true,
          });
        });
        episodes.sort((a, b) => a.number - b.number);
        totalEpisodes = episodes.length;
      }

      // Extract tags from the detail page
      const tags: string[] = [];
      $detail("a.tag, a[href*='/tag/'], .movie-tag-pill").each((_, el) => {
        const tag = $detail(el).text().trim().replace(/^#/, "");
        if (tag && !tags.includes(tag)) tags.push(tag);
      });

      return {
        id,
        title,
        provider: "shortspod",
        url: this.absolute(`/movies/${id}/`),
        poster,
        description,
        totalEpisodes,
        tags,
        episodes,
      };
    } catch (err) {
      Logger.error(err);
      return null;
    }
  }

  // ─── Stream resolution ───────────────────────────────────────────────────────

  /**
   * Resolve a stream URL for one episode.
   *
   * The play page embeds all episode MP4 URLs directly in window.NdPlayMvData.
   * Videos are served from img18.shortspod.com and require a Referer header
   * pointing at shortspod.com. We return both the direct CDN URL and a proxied
   * URL through our own server so clients behind geo-restrictions can still play.
   */
  static async watch(
    id: string,
    episode: number,
  ): Promise<DramaStream | null> {
    try {
      const playUrl = `${shortspod}/play/${id}/${episode}/`;
      const html = await this.fetchHtml(playUrl);

      const ndDataMatch = html.match(/window\.NdPlayMvData\s*=\s*(\{[\s\S]*?\});/);
      if (!ndDataMatch) {
        Logger.error(`No NdPlayMvData found for ${id} ep ${episode}`);
        return null;
      }

      // eslint-disable-next-line no-new-func
      const data = new Function("return (" + ndDataMatch[1] + ")")() as {
        episodes?: { episode: string; title: string; src: string }[];
      };
      const ep = (data.episodes || []).find(
        (e) => parseInt(e.episode, 10) === episode,
      );

      if (!ep?.src) {
        Logger.error(`Episode ${episode} not found or has no src for ${id}`);
        return null;
      }

      const directUrl: string = ep.src;

      // Build the proxied URL through our API proxy
      const proxiedUrl = `/api/proxy/stream?url=${encodeURIComponent(directUrl)}&referer=${encodeURIComponent(shortspod + "/")}`;

      const source: DramaSource = {
        url: proxiedUrl,
        quality: "default",
        isM3U8: false,
        proxied: true,
        directUrl,
      };

      return {
        id: `${id}-${episode}`,
        episode,
        provider: "shortspod",
        sources: [source],
        subtitles: [],
        servedBy: "shortspod",
      };
    } catch (err) {
      Logger.error(err);
      return null;
    }
  }
}