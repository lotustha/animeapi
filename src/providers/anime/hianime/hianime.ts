import * as cheerio from "cheerio";
import { Logger } from "../../../core/logger.js";
import { hianime as hianimeOrigin } from "../../origins.js";
import { USER_AGENT } from "../animepahe/scraper/index.js";
import { MegaUp } from "./scraper/megaup.js";
import type {
  HiAnimeCard,
  HiAnimeEpisode,
  HiAnimeHome,
  HiAnimeInfo,
  HiAnimePagedResult,
  HiAnimeServer,
  HiAnimeSpotlight,
} from "./types.js";

// hianime.ws ships a JSON API at /api/v1/titles/{aniId} for metadata and
// /api/v1/titles/{aniId}/episodes for the episode list. Server/source AJAX
// still goes through /ajax/links/{list,view} with enc-kai tokens.
export class HiAnime {
  private static baseUrl = hianimeOrigin;

  private static headers(): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      Accept: "text/html, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.5",
      Connection: "keep-alive",
      Referer: `${this.baseUrl}/`,
    };
  }

  private static parseInt(text: string | undefined | null): number {
    if (!text) return 0;
    const n = parseInt(String(text).trim(), 10);
    return Number.isFinite(n) ? n : 0;
  }

  // ─── Card scraper for /home, /browser, /genres/*, /movie, /tv etc. ─────────

  private static scrapeFlwCard($: cheerio.CheerioAPI, el: any): HiAnimeCard | null {
    const card = $(el);
    const linkEl = card.find("a.film-poster-ahref").first();
    const href =
      linkEl.attr("href") ?? card.find(".film-name a, a.dynamic-name").first().attr("href") ?? "";
    const id = href.replace(/^\/watch\//, "");
    if (!id) return null;

    // The aniId can come from a.film-poster-ahref[data-tip] (search/category cards)
    // or .film-poster[data-tip] (Most Viewed sidebar cards).
    const aniId =
      linkEl.attr("data-tip") ?? card.find(".film-poster").first().attr("data-tip") ?? null;

    // The inner <a class="dynamic-name"> carries data-jp; the outer <h3 class="film-name"> does not.
    const innerAnchor = card.find(".film-name a, a.dynamic-name").first();
    const titleEl = innerAnchor.length ? innerAnchor : card.find(".film-name").first();
    const tick = card.find(".film-poster .tick, .film-stats .tick, .fd-infor .tick").first();
    const fdInfo = card.find(".fd-infor .fdi-item, .film-stats .item");

    const sub = this.parseInt(tick.find(".tick-sub").text());
    const dub = this.parseInt(tick.find(".tick-dub").text());
    const episodes = this.parseInt(tick.find(".tick-eps").text()) || Math.max(sub, dub);

    return {
      id,
      aniId,
      title: titleEl.text().trim(),
      japaneseTitle: titleEl.attr("data-jp")?.trim() || null,
      url: `${this.baseUrl}${href}`,
      image: card.find("img.film-poster-img").attr("data-src")
        || card.find("img.film-poster-img").attr("src")
        || null,
      type: fdInfo.first().text().trim(),
      duration: fdInfo.eq(1).text().trim() || null,
      rating: tick.find(".tick-pg").text().trim() || null,
      quality: tick.find(".tick-quality").text().trim() || null,
      sub,
      dub,
      episodes,
    };
  }

  // Trending uses a swiper of compact .item cards (number + title + poster link),
  // not the standard .flw-item layout, so it gets a dedicated parser.
  private static scrapeTrendingItem($: cheerio.CheerioAPI, el: any): HiAnimeCard | null {
    const card = $(el);
    const posterLink = card.find("a.film-poster").first();
    const href = posterLink.attr("href") ?? "";
    const id = href.replace(/^\/watch\//, "");
    if (!id) return null;
    const titleEl = card.find(".film-title").first();
    return {
      id,
      aniId: null,
      title: titleEl.text().trim(),
      japaneseTitle: titleEl.attr("data-jp")?.trim() || null,
      url: `${this.baseUrl}${href}`,
      image: posterLink.find("img").attr("data-src") || posterLink.find("img").attr("src") || null,
      type: "",
      duration: null,
      rating: null,
      quality: null,
      sub: 0,
      dub: 0,
      episodes: 0,
    };
  }

  private static async scrapeCardPage(
    url: string,
  ): Promise<HiAnimePagedResult<HiAnimeCard>> {
    try {
      const res = await fetch(url, { headers: this.headers() });
      const html = await res.text();
      const $ = cheerio.load(html);

      const pagination = $("ul.pagination");
      const currentPage = this.parseInt(pagination.find(".page-item.active .page-link").text());

      const nextHref = pagination.find(".page-item.active").next().find("a.page-link").attr("href");
      const hasNextPage = !!nextHref && /page=\d+/.test(nextHref);

      const lastHref = pagination.find(".page-item:last-child a.page-link").attr("href");
      const totalPages =
        this.parseInt(lastHref?.split("page=")[1]) || (currentPage || 1);

      const results: HiAnimeCard[] = [];
      $(".flw-item").each((_, el) => {
        const card = this.scrapeFlwCard($, el);
        if (card) results.push(card);
      });

      return {
        currentPage: results.length === 0 ? 0 : currentPage || 1,
        hasNextPage: results.length === 0 ? false : hasNextPage,
        totalPages: results.length === 0 ? 0 : totalPages,
        results,
      };
    } catch (err) {
      Logger.error(`HiAnime scrapeCardPage error for ${url}: ${String(err)}`);
      return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    }
  }

  // ─── Browsing endpoints ─────────────────────────────────────────────────────

  static async search(query: string, page: number = 1): Promise<HiAnimePagedResult<HiAnimeCard>> {
    if (page <= 0) page = 1;
    const q = encodeURIComponent(query.replace(/[\W_]+/g, "+"));
    return this.scrapeCardPage(`${this.baseUrl}/browser?keyword=${q}&page=${page}`);
  }

  static async movies(page: number = 1) {
    return this.scrapeCardPage(`${this.baseUrl}/movie?page=${Math.max(page, 1)}`);
  }
  static async tv(page: number = 1) {
    return this.scrapeCardPage(`${this.baseUrl}/tv?page=${Math.max(page, 1)}`);
  }
  static async ova(page: number = 1) {
    return this.scrapeCardPage(`${this.baseUrl}/ova?page=${Math.max(page, 1)}`);
  }
  static async ona(page: number = 1) {
    return this.scrapeCardPage(`${this.baseUrl}/ona?page=${Math.max(page, 1)}`);
  }
  static async specials(page: number = 1) {
    return this.scrapeCardPage(`${this.baseUrl}/special?page=${Math.max(page, 1)}`);
  }
  static async completed(page: number = 1) {
    return this.scrapeCardPage(`${this.baseUrl}/completed?page=${Math.max(page, 1)}`);
  }
  static async newReleases(page: number = 1) {
    return this.scrapeCardPage(`${this.baseUrl}/new-releases?page=${Math.max(page, 1)}`);
  }
  static async recentlyUpdated(page: number = 1) {
    return this.scrapeCardPage(`${this.baseUrl}/updates?page=${Math.max(page, 1)}`);
  }
  static async recentlyAdded(page: number = 1) {
    return this.scrapeCardPage(`${this.baseUrl}/recent?page=${Math.max(page, 1)}`);
  }
  static async genreSearch(genre: string, page: number = 1) {
    if (!genre) throw new Error("genre is required");
    return this.scrapeCardPage(`${this.baseUrl}/genres/${genre}?page=${Math.max(page, 1)}`);
  }

  // ─── Genres list ────────────────────────────────────────────────────────────

  static async genres(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/home`, { headers: this.headers() });
      const $ = cheerio.load(await res.text());
      const slugs = new Set<string>();
      $('a[href^="/genres/"]').each((_, el) => {
        const href = $(el).attr("href") ?? "";
        const m = /\/genres\/([^/?#]+)/.exec(href);
        if (m && m[1]) slugs.add(m[1]);
      });
      return [...slugs];
    } catch (err) {
      Logger.error(`HiAnime genres error: ${String(err)}`);
      return [];
    }
  }

  // ─── Home page (spotlight + sections) ───────────────────────────────────────

  static async home(): Promise<HiAnimeHome> {
    const empty: HiAnimeHome = {
      spotlight: [],
      trending: [],
      latestUpdates: [],
      mostViewed: [],
    };
    try {
      const res = await fetch(`${this.baseUrl}/home`, { headers: this.headers() });
      const html = await res.text();
      const $ = cheerio.load(html);

      // Spotlight slides
      $(".swiper-slide .deslide-item").each((_, el) => {
        const slide = $(el);
        const titleEl = slide.find(".desi-head-title").first();
        const watchHref = slide.find(".desi-buttons a[href^='/watch/']").attr("href") ?? "";
        const id = watchHref.replace(/^\/watch\//, "");
        if (!id) return;
        const scd = slide.find(".sc-detail .scd-item");
        const tick = slide.find(".tick");
        const rankText = slide.find(".desi-sub-text").text().trim();
        const rankMatch = /#(\d+)/.exec(rankText);
        empty.spotlight.push({
          id,
          aniId: null, // spotlight DOM doesn't expose aniId; resolved on info() call
          rank: rankMatch ? parseInt(rankMatch[1]!, 10) : null,
          title: titleEl.text().trim(),
          japaneseTitle: titleEl.attr("data-jp")?.trim() || null,
          url: `${this.baseUrl}${watchHref}`,
          banner: slide.find(".deslide-cover-img img").attr("data-src")
            || slide.find(".deslide-cover-img img").attr("src")
            || null,
          description: slide.find(".desi-description").text().trim() || null,
          type: scd.eq(0).text().trim() || null,
          duration: scd.eq(1).text().trim() || null,
          releaseDate: scd.eq(2).text().trim() || null,
          quality: tick.find(".tick-quality").text().trim() || null,
          sub: this.parseInt(tick.find(".tick-sub").text()),
          dub: this.parseInt(tick.find(".tick-dub").text()),
        });
      });

      // Trending (swiper of compact items)
      $("section.block_area_trending .swiper-slide .item").each((_, el) => {
        const parsed = this.scrapeTrendingItem($, el);
        if (parsed) empty.trending.push(parsed);
      });

      // Most Viewed (sidebar with day/week/month tabs — first tab is rendered visible).
      // Use only the active tab to avoid 3x duplication.
      $(".cbox-realtime .tab-content .tab-body[style*='display: block'] li").each((_, el) => {
        const parsed = this.scrapeFlwCard($, el);
        if (parsed) empty.mostViewed.push(parsed);
      });

      // Latest Updates section uses the standard .flw-item grid.
      $("section#latest-updates .flw-item, section.block_area_home .flw-item").each((_, el) => {
        const parsed = this.scrapeFlwCard($, el);
        if (parsed) empty.latestUpdates.push(parsed);
      });

      return empty;
    } catch (err) {
      Logger.error(`HiAnime home error: ${String(err)}`);
      return empty;
    }
  }

  static async spotlight(): Promise<HiAnimeSpotlight[]> {
    const home = await this.home();
    return home.spotlight;
  }

  // ─── Suggestions (search dropdown) ──────────────────────────────────────────

  static async suggestions(query: string): Promise<HiAnimeCard[]> {
    try {
      const url = `${this.baseUrl}/ajax/anime/search?keyword=${encodeURIComponent(
        query.replace(/[\W_]+/g, "+"),
      )}`;
      const res = await fetch(url, {
        headers: { ...this.headers(), "X-Requested-With": "XMLHttpRequest" },
      });
      const data = (await res.json()) as { result?: any };
      const html = typeof data.result === "string" ? data.result : data.result?.html ?? "";
      const $ = cheerio.load(typeof html === "string" ? html : "");
      const out: HiAnimeCard[] = [];
      $(".flw-item, a.aitem").each((_, el) => {
        const card = this.scrapeFlwCard($, el);
        if (card) out.push(card);
      });
      return out;
    } catch (err) {
      Logger.warn(`HiAnime suggestions error: ${String(err)}`);
      return [];
    }
  }

  // ─── Info (page metadata + episodes) ────────────────────────────────────────

  // The route receives the URL slug (e.g. "naruto-shippuuden-5626"). hianime
  // exposes everything else via JSON keyed by the short aniId, so we resolve
  // slug → aniId once by reading the watch-page DOM.
  private static async resolveAniId(slug: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/watch/${slug}`, { headers: this.headers() });
      const html = await res.text();
      const $ = cheerio.load(html);
      const fromVote = $("#vote-info").attr("data-id");
      if (fromVote) return fromVote.trim();
      const fromWatchList = $("#watch-list-content").attr("data-id");
      if (fromWatchList) return fromWatchList.trim();
      const fromTip = $("a.film-poster-ahref[data-tip]").first().attr("data-tip");
      return fromTip?.trim() ?? null;
    } catch (err) {
      Logger.warn(`HiAnime resolveAniId error for ${slug}: ${String(err)}`);
      return null;
    }
  }

  static async info(idOrSlug: string): Promise<HiAnimeInfo | null> {
    try {
      const slug = idOrSlug.split("$")[0]!;
      const aniId = await this.resolveAniId(slug);
      if (!aniId) return null;

      const titleToken = await MegaUp.generateToken(aniId);

      // Title metadata + episodes — fetched in parallel since they're independent.
      const [titleRes, episodesRes] = await Promise.all([
        fetch(`${this.baseUrl}/api/v1/titles/${aniId}?_=${titleToken}`, {
          headers: { ...this.headers(), "X-Requested-With": "XMLHttpRequest" },
        }),
        fetch(`${this.baseUrl}/api/v1/titles/${aniId}/episodes?_=${titleToken}`, {
          headers: { ...this.headers(), "X-Requested-With": "XMLHttpRequest" },
        }),
      ]);

      const titleJson = (await titleRes.json()) as { status?: string; result?: any };
      if (titleJson.status !== "ok" || !titleJson.result) return null;
      const t = titleJson.result;

      const episodesJson = (await episodesRes.json()) as { status?: string; result?: any };
      const epResult = episodesJson.result ?? {};

      const sub = Number(t.episode_sub_latest) || 0;
      const dub = Number(t.episode_dub_latest) || 0;

      const episodes: HiAnimeEpisode[] = [];
      const ranges = Array.isArray(epResult.rangedEpisodes) ? epResult.rangedEpisodes : [];
      for (const range of ranges) {
        for (const ep of range.episodes ?? []) {
          const number = Number(ep.number);
          episodes.push({
            id: `${slug}$ep=${ep.slug ?? number}$token=${ep.token}`,
            number,
            title: ep.detail_name ?? ep.name ?? `Episode ${number}`,
            isFiller: !!ep.is_filler,
            isSubbed: number <= sub,
            isDubbed: number <= dub,
            releaseDate: ep.detail_release ?? null,
            url: `${this.baseUrl}/watch/${slug}#ep=${ep.slug ?? number}`,
          });
        }
      }

      // Recommendations — scraped from the watch page since the JSON API doesn't expose them.
      const recommendations: HiAnimeCard[] = [];
      try {
        const watchRes = await fetch(`${this.baseUrl}/watch/${slug}`, { headers: this.headers() });
        const $$ = cheerio.load(await watchRes.text());
        $$("section.block_area_category .flw-item").each((_, el) => {
          const card = this.scrapeFlwCard($$, el);
          if (card) recommendations.push(card);
        });
      } catch {
        /* recommendations are optional */
      }

      return {
        id: slug,
        aniId,
        title: t.title_default ?? "",
        japaneseTitle: t.title_romanji ?? null,
        altTitles: Array.isArray(t.alt_titles) ? t.alt_titles : [],
        description: t.synopsis ?? null,
        image: t.poster?.medium ?? t.poster?.original ?? null,
        banner: t.backdrop?.medium ?? t.backdrop?.original ?? null,
        url: `${this.baseUrl}/watch/${slug}`,
        type: t.type ?? null,
        status: t.status ?? null,
        season: t.season ?? null,
        duration: t.duration ?? null,
        rating: t.rating ?? null,
        quality: t.quality ?? null,
        broadcast: t.broadcast ?? null,
        startDate: t.start_date ?? null,
        endDate: t.end_date ?? null,
        year: t.start_date_year ?? null,
        episodeCount: t.episode_count ?? null,
        sub,
        dub,
        hasSub: sub > 0,
        hasDub: dub > 0,
        subOrDub: sub > 0 && dub > 0 ? "both" : dub > 0 ? "dub" : "sub",
        malId: t.mal_id ? String(t.mal_id) : null,
        anilistId: t.al_id ? String(t.al_id) : null,
        refScore: t.ref_score ?? null,
        followedCount: t.followed_count ?? null,
        genres: Array.isArray(t.genres) ? t.genres.map((g: any) => g.title) : [],
        studios: Array.isArray(t.studios) ? t.studios.map((s: any) => s.title) : [],
        producers: Array.isArray(t.producers) ? t.producers.map((p: any) => p.title) : [],
        countries: Array.isArray(t.countries) ? t.countries.map((c: any) => c.title) : [],
        tags: Array.isArray(t.tags) ? t.tags.map((tg: any) => tg.title) : [],
        episodes,
        recommendations,
      };
    } catch (err) {
      Logger.error(`HiAnime info error: ${String(err)}`);
      return null;
    }
  }

  // ─── Episode servers ────────────────────────────────────────────────────────

  static async fetchEpisodeServers(
    episodeId: string,
    subOrDub: "softsub" | "dub" | "hardsub" = "hardsub",
  ): Promise<HiAnimeServer[]> {
    try {
      const token = episodeId.split("$token=")[1];
      if (!token) return [];

      const ajaxToken = await MegaUp.generateToken(token);
      const res = await fetch(
        `${this.baseUrl}/ajax/links/list?token=${token}&_=${ajaxToken}`,
        { headers: { ...this.headers(), "X-Requested-With": "XMLHttpRequest" } },
      );
      const data = (await res.json()) as { result?: string };
      if (typeof data.result !== "string") return [];

      const $ = cheerio.load(data.result);
      const servers: HiAnimeServer[] = [];

      const targetGroups =
        subOrDub === "dub"
          ? [{ id: "dub", type: "dub" as const }]
          : [
              { id: "sub", type: "hardsub" as const },
              { id: "softsub", type: "softsub" as const },
            ];

      for (const group of targetGroups) {
        const items = $(`.servers-${group.id} .server-item, .ps_-block-${group.id} .server-item`);
        await Promise.all(
          items.toArray().map(async (server) => {
            const lid = $(server).find(".server").attr("data-lid");
            if (!lid) return;
            const viewToken = await MegaUp.generateToken(lid);
            const viewRes = await fetch(
              `${this.baseUrl}/ajax/links/view?id=${lid}&_=${viewToken}`,
              { headers: { ...this.headers(), "X-Requested-With": "XMLHttpRequest" } },
            );
            const viewData = (await viewRes.json()) as { result?: string };
            if (!viewData.result) return;
            const decoded = await MegaUp.decodeIframeData(viewData.result);
            const suffix =
              group.type === "hardsub" ? " (HardSub)" : group.type === "softsub" ? " (SoftSub)" : "";
            servers.push({
              name: `megaup ${$(server).find(".server").text().trim()}${suffix}`.toLowerCase(),
              url: decoded.url,
              isDub: group.type === "dub",
              intro: { start: decoded.skip.intro[0], end: decoded.skip.intro[1] },
              outro: { start: decoded.skip.outro[0], end: decoded.skip.outro[1] },
            });
          }),
        );
      }

      return servers;
    } catch (err) {
      Logger.error(`HiAnime fetchEpisodeServers error: ${String(err)}`);
      return [];
    }
  }

  // ─── Streams (server list + decrypted sources) ──────────────────────────────

  static async streams(
    _animeId: string,
    episodeId: string,
    type?: "softsub" | "dub" | "hardsub",
  ): Promise<any> {
    try {
      const token = episodeId.split("$token=")[1];
      if (!token) return { isDub: false, results: [] };

      const ajaxToken = await MegaUp.generateToken(token);
      const res = await fetch(
        `${this.baseUrl}/ajax/links/list?token=${token}&_=${ajaxToken}`,
        { headers: { ...this.headers(), "X-Requested-With": "XMLHttpRequest" } },
      );
      const data = (await res.json()) as { result?: string };
      if (typeof data.result !== "string") return { isDub: false, results: [] };

      const $ = cheerio.load(data.result);
      const results: any[] = [];
      const seen = new Set<string>();
      const isDubRequest = type === "dub";

      const targetGroups = isDubRequest
        ? [{ id: "dub", label: "dub" as const, subType: null }]
        : [
            { id: "sub", label: "hardsub" as const, subType: "hard" },
            { id: "softsub", label: "softsub" as const, subType: "soft" },
          ];

      let globalIntro: [number, number] | null = null;
      let globalOutro: [number, number] | null = null;

      for (const group of targetGroups) {
        const items = $(`.servers-${group.id} .server-item, .ps_-block-${group.id} .server-item`);

        for (const item of items.toArray()) {
          const lid = $(item).find(".server").attr("data-lid");
          if (!lid || seen.has(lid)) continue;
          seen.add(lid);

          const viewToken = await MegaUp.generateToken(lid);
          const viewData = (await (
            await fetch(`${this.baseUrl}/ajax/links/view?id=${lid}&_=${viewToken}`, {
              headers: { ...this.headers(), "X-Requested-With": "XMLHttpRequest" },
            })
          ).json()) as { result?: string };
          if (!viewData.result) continue;

          const decoded = await MegaUp.decodeIframeData(viewData.result);
          const videoSources = await MegaUp.extract(decoded.url);

          if (!globalIntro && !globalOutro) {
            globalIntro = decoded.skip.intro;
            globalOutro = decoded.skip.outro;
          }

          const formattedSubtitles = (videoSources.subtitles || []).map((sub: any) => ({
            ...sub,
            type: group.subType || "none",
          }));

          const suffix =
            group.label === "hardsub"
              ? " (HardSub)"
              : group.label === "softsub"
                ? " (SoftSub)"
                : group.label === "dub"
                  ? " (Dub)"
                  : "";

          results.push({
            name: `MegaUp ${$(item).find(".server").text().trim()}${suffix}`,
            iframe: decoded.url,
            sources: videoSources.sources,
            subtitles: formattedSubtitles,
            download: videoSources.download,
          });
        }
      }

      return {
        isDub: isDubRequest,
        results,
        ...(globalIntro && { intro: globalIntro }),
        ...(globalOutro && { outro: globalOutro }),
      };
    } catch (err) {
      Logger.error(`HiAnime streams error: ${String(err)}`);
      return { isDub: false, results: [] };
    }
  }
}
