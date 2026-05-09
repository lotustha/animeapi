import * as cheerio from "cheerio";
import { Logger } from "../../../core/logger.js";
import { anigo as anigoOrigin } from "../../origins.js";
import { USER_AGENT } from "../animepahe/scraper/index.js";
import { MegaUp } from "./scraper/megaup.js";
import type {
  AnigoEpisode,
  AnigoInfo,
  AnigoPagedResult,
  AnigoRelatedItem,
  AnigoSearchItem,
  AnigoServer,
} from "./types.js";

// Anigo encodes Japanese titles inside Alpine's x-data="JTitle(`...`)" rather than
// using a data-jp attribute, so fall back to parsing the directive when the attr is empty.
const JTITLE_RE = /JTitle\(\s*[`'"]([\s\S]*?)[`'"]\s*\)/;

function jpTitle(el: any): string {
  const direct = el.attr("data-jp");
  if (direct && direct.trim()) return direct.trim();
  const xData = el.attr("x-data");
  return xData ? (JTITLE_RE.exec(xData)?.[1]?.trim() ?? "") : "";
}

export class Anigo {
  private static baseUrl = anigoOrigin;

  private static headers(): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      Connection: "keep-alive",
      Accept: "text/html, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.5",
      "Sec-GPC": "1",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      Priority: "u=0",
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      Referer: `${this.baseUrl}/`,
      Cookie: "__p_mov=1; usertype=guest; session=vLrU4aKItp0QltI2asH83yugyWDsSSQtyl9sxWKO",
    };
  }

  // ─── Paginated Card Scraper ──────────────────────────────────────────────────

  private static async scrapeCardPage(url: string): Promise<AnigoPagedResult<AnigoSearchItem>> {
    try {
      const res = await fetch(url, { headers: this.headers() });
      const html = await res.text();
      const $ = cheerio.load(html);

      const pagination = $("ul.pagination");
      const currentPage =
        parseInt(pagination.find(".page-item.active span.page-link").text().trim()) || 0;

      const nextPageHref = pagination
        .find(".page-item.active")
        .next()
        .find("a.page-link")
        .attr("href");
      const nextPageVal = nextPageHref?.split("page=")[1];
      const hasNextPage = !!nextPageVal && nextPageVal !== "";

      const lastPageHref = pagination.find(".page-item:last-child a.page-link").attr("href");
      const lastPageVal = lastPageHref?.split("page=")[1];
      const totalPages =
        lastPageVal && lastPageVal !== "" ? parseInt(lastPageVal) || 0 : currentPage;

      const results: AnigoSearchItem[] = [];
      $(".unit, .aitem").each((_, ele) => {
        const card = $(ele);
        const isAnchor = card.prop('tagName')?.toLowerCase() === 'a';
        const atag = isAnchor ? card : card.find("a.poster");
        const titleTag = card.find("h6.title");

        const id = atag.attr("href")?.replace("/watch/", "") || "";
        // Skip Alpine.js template skeletons that match `.unit` but have no real href.
        if (!id) return;
        const type = card.find(".aniBadge span.type").text().trim() || card.find(".aniMeta span.type").text().trim() || card.find(".aniMeta span").first().text().trim();

        const image = card.find("img").attr("data-src") || card.find("img").attr("src");
        const title = titleTag.text().trim();
        const japaneseTitle = jpTitle(titleTag);

        const subText = card.find(".subdub .sub").text().trim();
        const dubText = card.find(".subdub .dub").text().trim();
        const totalText = card.find(".subdub .total").text().trim();

        results.push({
          id,
          title,
          url: `${this.baseUrl}${atag.attr("href")}`,
          image,
          japaneseTitle,
          type,
          sub: parseInt(subText) || 0,
          dub: parseInt(dubText) || 0,
          episodes: parseInt(totalText) || parseInt(subText) || 0,
        });
      });

      return {
        currentPage: results.length === 0 ? 0 : currentPage,
        hasNextPage: results.length === 0 ? false : hasNextPage,
        totalPages: results.length === 0 ? 0 : totalPages,
        results,
      };
    } catch (err) {
      Logger.error(`Anigo scrapeCardPage error for ${url}: ${String(err)}`);
      return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    }
  }

  // ─── Browsing Endpoints ──────────────────────────────────────────────────────

  static async search(query: string, page: number = 1): Promise<AnigoPagedResult<AnigoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(
      `${this.baseUrl}/browser?keyword=${encodeURIComponent(query.replace(/[\W_]+/g, "+"))}&page=${page}`,
    );
  }

  static async latest(page: number = 1): Promise<AnigoPagedResult<AnigoSearchItem>> {
    return this.recentlyUpdated(page);
  }

  static async recentlyUpdated(page: number = 1): Promise<AnigoPagedResult<AnigoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/updates?page=${page}`);
  }

  static async latestCompleted(page: number = 1): Promise<AnigoPagedResult<AnigoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/completed?page=${page}`);
  }

  static async newReleases(page: number = 1): Promise<AnigoPagedResult<AnigoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/new-releases?page=${page}`);
  }

  static async recentlyAdded(page: number = 1): Promise<AnigoPagedResult<AnigoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/recent?page=${page}`);
  }

  static async movies(page: number = 1): Promise<AnigoPagedResult<AnigoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/movie?page=${page}`);
  }

  static async tv(page: number = 1): Promise<AnigoPagedResult<AnigoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/tv?page=${page}`);
  }

  static async ova(page: number = 1): Promise<AnigoPagedResult<AnigoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/ova?page=${page}`);
  }

  static async ona(page: number = 1): Promise<AnigoPagedResult<AnigoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/ona?page=${page}`);
  }

  static async specials(page: number = 1): Promise<AnigoPagedResult<AnigoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/special?page=${page}`);
  }

  static async genreSearch(
    genre: string,
    page: number = 1,
  ): Promise<AnigoPagedResult<AnigoSearchItem>> {
    if (!genre) throw new Error("genre is required");
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/genres/${genre}?page=${page}`);
  }

  // ─── Genres ─────────────────────────────────────────────────────────────────

  static async genres(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/home`, { headers: this.headers() });
      const html = await res.text();
      const $ = cheerio.load(html);
      const results: string[] = [];
      $(".headerMenu")
        .find("ul.c4 li a")
        .each((_, ele) => {
          results.push($(ele).text().trim().toLowerCase());
        });
      return results;
    } catch (err) {
      Logger.error(`Anigo genres error: ${String(err)}`);
      return [];
    }
  }

  // ─── Schedule ────────────────────────────────────────────────────────────────

  static async schedule(date: string = new Date().toISOString().split("T")[0]!): Promise<any[]> {
    try {
      const tz = 5.5;
      const timestamp = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
      const url = `${this.baseUrl}/ajax/schedule/items?tz=${tz}&time=${timestamp}`;
      const res = await fetch(url, { headers: this.headers() });
      const data = await res.json();
      let html = data.result;
      if (typeof html === "object" && html.html) html = html.html;

      const $ = cheerio.load(typeof html === "string" ? html : "");
      const results: any[] = [];
      $("ul li").each((_, ele) => {
        const card = $(ele);
        const titleElement = card.find("span.title");
        results.push({
          id: card.find("a").attr("href")?.split("/")[2],
          title: titleElement.text().trim(),
          japaneseTitle: jpTitle(titleElement),
          airingTime: card.find("span.time").text().trim(),
          airingEpisode: card.find("span").last().text().trim().replace("EP ", ""),
        });
      });
      return results;
    } catch (err) {
      Logger.error(`Anigo schedule error: ${String(err)}`);
      return [];
    }
  }

  // ─── Spotlight ───────────────────────────────────────────────────────────────

  static async spotlight(): Promise<any[]> {
    try {
      const res = await fetch(`${this.baseUrl}/home`, { headers: this.headers() });
      const html = await res.text();
      const $ = cheerio.load(html);
      const results: any[] = [];
      // section.mostViewed has three tab panels (day/week/month); only scrape the
      // first one to avoid duplicate entries.
      const tabPanel = $("section.mostViewed .section-inner > div[x-show]").first();
      tabPanel.find("a.unit, a.aniOntop").each((_, el) => {
        const card = $(el);
        const isOntop = card.hasClass("aniOntop");
        const titleElement = card.find(isOntop ? "h5.title" : "h6.title");
        const id = card.attr("href")?.replace("/watch/", "");

        const posterDiv = card.find(".poster > div");
        const style = posterDiv.attr("style") || "";
        const banner = style.match(/background-image:\s*url\((['"]?)(.+?)\1\)/)?.[2] || null;
        const image = banner || card.find("img").attr("data-src") || card.find("img").attr("src");

        results.push({
          id,
          title: titleElement.text().trim(),
          japaneseTitle: jpTitle(titleElement),
          banner: image,
          url: `${this.baseUrl}${card.attr("href")}`,
          type: card.find("span.type").text().trim(),
          sub: parseInt(card.find(".sub").text().trim()) || 0,
          dub: parseInt(card.find(".dub").text().trim()) || 0,
          episodes: parseInt(card.find(".total").text().trim()) || parseInt(card.find(".sub").text().trim()) || 0,
        });
      });
      return results;
    } catch (err) {
      Logger.error(`Anigo spotlight error: ${String(err)}`);
      return [];
    }
  }

  // ─── Search Suggestions ──────────────────────────────────────────────────────

  static async suggestions(query: string): Promise<any[]> {
    try {
      const url = `${this.baseUrl}/ajax/anime/search?keyword=${encodeURIComponent(query.replace(/[\W_]+/g, "+"))}`;
      const res = await fetch(url, { headers: this.headers() });
      const data = await res.json();
      // Consumet accesses result.html; handle both shapes
      const htmlContent = data.result?.html ?? data.result ?? "";
      const $ = cheerio.load(typeof htmlContent === "string" ? htmlContent : "");
      const results: any[] = [];
      $("a.aitem, a.unit").each((_, el) => {
        const card = $(el);
        const titleElement = card.find(".title");
        const id = card.attr("href")?.split("/")[2];
        results.push({
          id,
          title: titleElement.text().trim(),
          url: `${this.baseUrl}/watch/${id}`,
          japaneseTitle: jpTitle(titleElement) || null,
          image: card.find(".poster img").attr("src") || card.find("img").attr("data-src") || card.find("img").attr("src"),
          type: card.find(".info").children().eq(-3).text().trim() || card.find(".aniBadge span.type").text().trim() || card.find(".aniMeta span.type").text().trim() || card.find(".aniMeta span").first().text().trim(),
          year: card.find(".info").children().eq(-2).text().trim(),
          sub: parseInt(card.find(".info span.sub").text() || card.find(".subdub .sub").text()) || 0,
          dub: parseInt(card.find(".info span.dub").text() || card.find(".subdub .dub").text()) || 0,
          episodes: parseInt(card.find(".info").children().eq(-4).text().trim() || card.find(".subdub .total").text().trim()) || 0,
        });
      });
      return results;
    } catch (err) {
      Logger.error(`Anigo suggestions error: ${String(err)}`);
      return [];
    }
  }

  // ─── Anime Info ──────────────────────────────────────────────────────────────

  static async info(id: string): Promise<AnigoInfo | null> {
    try {
      const animeSlug = id.split("$")[0]!;
      const res = await fetch(`${this.baseUrl}/watch/${animeSlug}`, {
        headers: this.headers(),
      });
      const html = await res.text();
      const $ = cheerio.load(html);

      // Anigo wraps the metadata in `section.aniDetail` (not animekai's `.entity-scroll`).
      const detail = $("section.aniDetail");
      const main = detail.find(".mainData .dataScroll");
      const titleEl = main.find(".title").first();
      const aniMeta = main.find(".aniMeta").first();
      const subdub = aniMeta.find(".subdub");
      const detailRows = main.find(".detail");

      const subCount = parseInt(subdub.find(".sub").text().trim()) || 0;
      const dubCount = parseInt(subdub.find(".dub").text().trim()) || 0;

      const info: any = {
        id: animeSlug,
        title: titleEl.text().trim(),
        japaneseTitle: jpTitle(titleEl),
        image: detail.find(".posterZone .poster img").attr("src"),
        description: main.find(".desc").text().trim(),
        // Type sits as the bold child of an .aniMeta <span> (e.g. <span><b>TV</b></span>).
        type: aniMeta.find("span > b").first().text().trim().toUpperCase(),
        rating: aniMeta.find(".rating").text().trim() || null,
        url: `${this.baseUrl}/watch/${animeSlug}`,
        sub: subCount,
        dub: dubCount,
      };

      const hasSub = subCount > 0;
      const hasDub = dubCount > 0;
      info.hasSub = hasSub;
      info.hasDub = hasDub;
      info.subOrDub = hasSub && hasDub ? "both" : hasDub ? "dub" : "sub";

      // Genres live in `<div class="genre"><a>...</a></div>` directly, not in `.detail` rows.
      info.genres = main
        .find(".genre a")
        .toArray()
        .map((a) => $(a).text().trim())
        .filter(Boolean);

      const rowText = (label: string) =>
        detailRows
          .find(`div:contains('${label}')`)
          .first()
          .find("span")
          .first()
          .text()
          .trim();

      info.status = rowText("Status");
      info.season = rowText("Premiered");
      info.duration = rowText("Duration");
      info.totalEpisodes = parseInt(rowText("Episodes")) || null;

      // External link IDs (MAL / AniList).
      detailRows
        .find("div")
        .filter((_, el) => $(el).text().includes("Links:"))
        .find("a")
        .each((_, el) => {
          const href = $(el).attr("href") ?? "";
          if (href.includes("myanimelist")) {
            info.malId = href.match(/anime\/(\d+)/)?.[1];
          }
          if (href.includes("anilist")) {
            info.anilistId = href.match(/anime\/(\d+)/)?.[1];
          }
        });

      const parseSidebarCard = (a: any) => {
        const card = $(a);
        const titleTag = card.find("h6.title, h5.title").first();
        const meta = card.find(".aniMeta");
        const href = card.attr("href") ?? "";
        return {
          id: href.replace("/watch/", ""),
          title: titleTag.text().trim(),
          japaneseTitle: jpTitle(titleTag),
          url: `${this.baseUrl}${href}`,
          image: card.find(".poster img").attr("src") || card.find("img").attr("data-src"),
          type: meta.find("span").first().text().trim().toUpperCase(),
          rating: meta.find(".rating").text().trim() || null,
          year: meta.find(".time").text().trim() || null,
        };
      };

      // Recommendations and Relations are sibling <section> blocks identified by their h2.
      // The RELATED section ships every dropdown tab panel (Summary/Character/Side Story/...)
      // pre-rendered in the HTML, so dedupe by id to avoid the same card appearing N times.
      info.recommendations = [];
      info.relations = [];
      const seenRecs = new Set<string>();
      const seenRels = new Set<string>();

      $("section").each((_, sec) => {
        const heading = $(sec).find("h2.sectionTitle").first().text().trim().toUpperCase();
        if (heading !== "RECOMMENDED" && heading !== "RELATED") return;
        const isRec = heading === "RECOMMENDED";
        const target = isRec ? info.recommendations : info.relations;
        const seen = isRec ? seenRecs : seenRels;
        $(sec)
          .find("a.unit")
          .each((_, a) => {
            const card = parseSidebarCard(a);
            if (!card.id || seen.has(card.id)) return;
            seen.add(card.id);
            target.push(card);
          });
      });

      // Episodes — anigo replaced the legacy /ajax/episodes/list with a JSON API at
      // /api/v1/titles/{aniId}/episodes. The response shape is:
      //   { result: { langs, episodeCount, rangedEpisodes: [{ label, episodes: [...] }] } }
      info.episodes = [];
      try {
        // The ani_id is embedded in `.rate-box[x-data="Rating('<id>')"]`.
        const rateXData = $(".rate-box").attr("x-data") ?? "";
        const aniId = /Rating\(\s*['"`]([^'"`]+)['"`]\s*\)/.exec(rateXData)?.[1];
        if (!aniId) return info;
        info.aniId = aniId;

        const episodesToken = await MegaUp.generateToken(aniId);
        const episodesRes = await fetch(
          `${this.baseUrl}/api/v1/titles/${aniId}/episodes?_=${episodesToken}`,
          {
            headers: {
              ...this.headers(),
              "X-Requested-With": "XMLHttpRequest",
              Referer: `${this.baseUrl}/watch/${animeSlug}`,
            },
          },
        );
        const epData = (await episodesRes.json()) as {
          status?: string;
          result?: {
            langs?: string[];
            episodeCount?: number;
            rangedEpisodes?: { label: string; episodes: any[] }[];
          };
        };
        const result = epData.result;
        if (!result || !Array.isArray(result.rangedEpisodes)) return info;

        info.totalEpisodes = result.episodeCount ?? null;

        for (const range of result.rangedEpisodes) {
          for (const ep of range.episodes ?? []) {
            const number = Number(ep.number);
            info.episodes.push({
              id: `${animeSlug}$ep=${ep.slug ?? number}$token=${ep.token}`,
              number,
              title: ep.detail_name ?? ep.name ?? `Episode ${number}`,
              isFiller: !!ep.is_filler,
              isSubbed: number <= subCount,
              isDubbed: number <= dubCount,
              releaseDate: ep.detail_release ?? null,
              url: `${this.baseUrl}/watch/${animeSlug}#ep=${ep.slug ?? number}`,
            });
          }
        }
      } catch (err) {
        Logger.warn(`Anigo info: episodes api unavailable for ${animeSlug}: ${String(err)}`);
      }

      return info;
    } catch (err) {
      Logger.error(`Anigo info error: ${String(err)}`);
      return null;
    }
  }

  // ─── Episode Servers ─────────────────────────────────────────────────────────

  static async fetchEpisodeServers(
    episodeId: string,
    subOrDub: "softsub" | "dub" | "hardsub" = "hardsub",
  ): Promise<AnigoServer[]> {
    try {
      const token = episodeId.split("$token=")[1];
      if (!token) return [];

      const ajaxToken = await MegaUp.generateToken(token);
      const url = `${this.baseUrl}/ajax/links/list?token=${token}&_=${ajaxToken}`;
      const res = await fetch(url, { headers: this.headers() });
      const data = await res.json();
      const serverHtml = data.result;

      if (typeof serverHtml !== "string") return [];

      const $ = cheerio.load(serverHtml);
      const servers: AnigoServer[] = [];

      const targetGroups =
        subOrDub === "dub"
          ? [{ id: "dub", type: "dub" as const }]
          : [
              { id: "sub", type: "hardsub" as const },
              { id: "softsub", type: "softsub" as const },
            ];

      for (const group of targetGroups) {
        const serverItems = $(`.server-items.lang-group[data-id="${group.id}"] .server`);

        await Promise.all(
          serverItems.toArray().map(async (server) => {
            const lid = $(server).attr("data-lid");
            if (!lid) return;

            const viewToken = await MegaUp.generateToken(lid);
            const viewRes = await fetch(
              `${this.baseUrl}/ajax/links/view?id=${lid}&_=${viewToken}`,
              {
                headers: this.headers(),
              },
            );
            const viewData = await viewRes.json();
            const decoded = await MegaUp.decodeIframeData(viewData.result);

            const suffix =
              group.type === "hardsub"
                ? " (HardSub)"
                : group.type === "softsub"
                  ? " (SoftSub)"
                  : "";

            servers.push({
              name: `megaup ${$(server).text().trim()}${suffix}`.toLowerCase(),
              url: decoded.url,
              isDub: group.type === "dub",
              intro: {
                start: decoded.skip.intro[0],
                end: decoded.skip.intro[1],
              },
              outro: {
                start: decoded.skip.outro[0],
                end: decoded.skip.outro[1],
              },
            });
          }),
        );
      }

      return servers;
    } catch (err) {
      Logger.error(`Anigo fetchEpisodeServers error: ${String(err)}`);
      return [];
    }
  }

  // ─── Streams ─────────────────────────────────────────────────────────────────

  static async streams(
    animeId: string,
    episodeId: string,
    type?: "softsub" | "dub" | "hardsub",
  ): Promise<any> {
    try {
      const token = episodeId.split("$token=")[1];
      if (!token) return { isDub: false, results: [] };

      const ajaxToken = await MegaUp.generateToken(token);
      const serversUrl = `${this.baseUrl}/ajax/links/list?token=${token}&_=${ajaxToken}`;
      const res = await fetch(serversUrl, { headers: this.headers() });
      const data = await res.json();
      const serverHtml = data.result;

      if (typeof serverHtml !== "string") return { isDub: false, results: [] };

      const $ = cheerio.load(serverHtml);
      const results: any[] = [];
      const seen = new Set<string>();

      const isDubRequest = type === "dub";
      const targetGroups = isDubRequest
        ? [{ id: "dub", label: "dub", subType: null }]
        : [
            { id: "sub", label: "hardsub", subType: "hard" },
            { id: "softsub", label: "softsub", subType: "soft" },
          ];

      // Track intro and outro globally so they only appear once
      let globalIntro: [number, number] | null = null;
      let globalOutro: [number, number] | null = null;

      for (const group of targetGroups) {
        const serverItems = $(`.server-items.lang-group[data-id='${group.id}'] .server`);

        for (const item of serverItems.toArray()) {
          const lid = $(item).attr("data-lid");
          if (!lid || seen.has(lid)) continue;
          seen.add(lid);

          const viewToken = await MegaUp.generateToken(lid);
          const viewData = await (
            await fetch(`${this.baseUrl}/ajax/links/view?id=${lid}&_=${viewToken}`, {
              headers: this.headers(),
            })
          ).json();

          const decoded = await MegaUp.decodeIframeData(viewData.result);
          console.log(JSON.stringify(decoded) + " decoded");
          const videoSources = await MegaUp.extract(decoded.url);

          // Set skip times from the first parsed server
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
            name: `MegaUp ${$(item).text().trim()}${suffix}`,
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
      Logger.error(`Anigo streams error: ${String(err)}`);
      return { isDub: false, results: [] };
    }
  }

  // ─── Resolve / Mapping Helpers ───────────────────────────────────────────────

  static async resolveByExternalId(_params: {
    mal_id?: number;
    anilist_id?: number;
  }): Promise<string | null> {
    return null; // Removing AniZip means we can't easily resolve by external ID without a search title
  }

  static async getEpisodeSession(animeId: string, episodeNumber: number): Promise<string | null> {
    try {
      const info = await this.info(animeId);
      if (!info) return null;

      const episode = info.episodes.find((ep: AnigoEpisode) => ep.number === episodeNumber);
      return episode ? episode.id : null;
    } catch (err) {
      Logger.error(`Anigo getEpisodeSession error: ${String(err)}`);
      return null;
    }
  }

  static async getMappingsAndName(
    id: string,
  ): Promise<{ mappings: any | null; name: string } | null> {
    try {
      const info = await this.info(id);
      if (!info) return null;

      const malId = info.malId ? parseInt(info.malId) : null;
      const anilistId = info.anilistId ? parseInt(info.anilistId) : null;

      const mappings =
        malId || anilistId
          ? {
              mal_id: malId,
              anilist_id: anilistId,
              themoviedb_id: null,
              imdb_id: null,
              thetvdb_id: null,
              kitsu_id: null,
              anidb_id: null,
              anisearch_id: null,
              livechart_id: null,
              animeplanet_id: null,
              notifymoe_id: null,
            }
          : null;

      return {
        mappings,
        name: info.title,
      };
    } catch (err) {
      Logger.error(`Anigo getMappingsAndName error: ${String(err)}`);
      return null;
    }
  }
}
