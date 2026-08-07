import * as cheerio from "cheerio";
import { Logger } from "../../../core/logger.js";
import { animekai as animekaiOrigin } from "../../origins.js";
import { USER_AGENT } from "../animepahe/scraper/index.js";
// The HLS variant parser is provider-agnostic; keep one copy rather than
// duplicating it per provider.
import { fetchVariants } from "../anizen/scraper/hls.js";
import { getEarnvidsQualities, isEarnvidsUrl } from "./scraper/earnvids.js";
import { getVivibebeSource, isVivibebeUrl } from "./scraper/vivibebe.js";
import type {
  AnimeKaiEpisode,
  AnimeKaiInfo,
  AnimeKaiPagedResult,
  AnimeKaiSearchItem,
  AnimeKaiServer,
} from "./types.js";

export class AnimeKai {
  private static baseUrl = animekaiOrigin;

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

  // The watch page is ~270 KB (it inlines every episode plus every server) and
  // the origin serves it in ~6.5s. info() and fetchEpisodePlayers() both need
  // it, so share one fetch between them rather than paying that twice.
  private static htmlCache = new Map<string, { at: number; html: string }>();
  private static HTML_TTL_MS = 5 * 60_000;

  private static async fetchWatchHtml(url: string, referer?: string): Promise<string | null> {
    const hit = this.htmlCache.get(url);
    if (hit && Date.now() - hit.at < this.HTML_TTL_MS) return hit.html;

    const res = await fetch(url, {
      headers: { ...this.headers(), ...(referer ? { Referer: referer } : {}) },
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Bound the cache — these entries are large.
    if (this.htmlCache.size > 40) {
      for (const [k, v] of this.htmlCache) {
        if (Date.now() - v.at > this.HTML_TTL_MS) this.htmlCache.delete(k);
      }
      if (this.htmlCache.size > 40) this.htmlCache.clear();
    }
    this.htmlCache.set(url, { at: Date.now(), html });
    return html;
  }

  // ─── Paginated Card Scraper ──────────────────────────────────────────────────

  private static async scrapeCardPage(
    url: string,
  ): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
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

      const results: AnimeKaiSearchItem[] = [];
      $(".aitem").each((_, ele) => {
        const card = $(ele);
        const atag = card.find("div.inner > a");
        const id = atag.attr("href")?.replace("/watch/", "") || "";
        const type = card.find(".info").children().last().text().trim();

        results.push({
          id,
          title: atag.text().trim(),
          url: `${this.baseUrl}${atag.attr("href")}`,
          image: card.find("img").attr("data-src") || card.find("img").attr("src"),
          japaneseTitle: card.find("a.title").attr("data-jp")?.trim(),
          type,
          sub: parseInt(card.find(".info span.sub").text()) || 0,
          dub: parseInt(card.find(".info span.dub").text()) || 0,
          episodes:
            parseInt(card.find(".info").children().eq(-2).text().trim()) ||
            parseInt(card.find(".info span.sub").text()) ||
            0,
        });
      });

      return {
        currentPage: results.length === 0 ? 0 : currentPage,
        hasNextPage: results.length === 0 ? false : hasNextPage,
        totalPages: results.length === 0 ? 0 : totalPages,
        results,
      };
    } catch (err) {
      Logger.error(`AnimeKai scrapeCardPage error for ${url}: ${String(err)}`);
      return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    }
  }

  // ─── Browsing Endpoints ──────────────────────────────────────────────────────

  static async search(
    query: string,
    page: number = 1,
  ): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    // anikai.cc decodes %2B as a literal plus (the old domain treated it as a
    // space), so encode the raw query and let spaces become %20.
    return this.scrapeCardPage(
      `${this.baseUrl}/browser?keyword=${encodeURIComponent(query)}&page=${page}`,
    );
  }

  static async latest(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    return this.recentlyUpdated(page);
  }

  static async recentlyUpdated(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/updates?page=${page}`);
  }

  static async latestCompleted(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/completed?page=${page}`);
  }

  static async newReleases(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/new-releases?page=${page}`);
  }

  static async recentlyAdded(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/recent?page=${page}`);
  }

  static async movies(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/browser?type[]=2&page=${page}`);
  }

  static async tv(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/browser?type[]=1&page=${page}`);
  }

  static async ova(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/browser?type[]=3&page=${page}`);
  }

  static async ona(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/browser?type[]=4&page=${page}`);
  }

  static async specials(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/browser?type[]=5&page=${page}`);
  }

  static async genreSearch(
    genre: string,
    page: number = 1,
  ): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
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
      // The "#menu ul.c4" mega-menu is gone; genres are plain /genres/<slug>
      // anchors now. Dedupe — the same links appear in nav and footer.
      const seenGenres = new Set<string>();
      $('a[href*="/genres/"]').each((_, ele) => {
        const slug = ($(ele).attr("href") ?? "").split("/genres/")[1]?.split(/[?#]/)[0];
        if (!slug || seenGenres.has(slug)) return;
        seenGenres.add(slug);
        results.push(slug.toLowerCase());
      });
      return results;
    } catch (err) {
      Logger.error(`AnimeKai genres error: ${String(err)}`);
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
          japaneseTitle: titleElement.attr("data-jp"),
          airingTime: card.find("span.time").text().trim(),
          airingEpisode: card.find("span").last().text().trim().replace("EP ", ""),
        });
      });
      return results;
    } catch (err) {
      Logger.error(`AnimeKai schedule error: ${String(err)}`);
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
      $("div.swiper-wrapper > div.swiper-slide").each((_, el) => {
        const card = $(el);
        const titleElement = card.find("div.detail > p.title");
        const id = card.find("div.swiper-ctrl > a.btn").attr("href")?.replace("/watch/", "");
        const style = card.attr("style") || "";
        const banner = style.match(/background-image:\s*url\(["']?(.+?)["']?\)/)?.[1] || null;

        results.push({
          id,
          title: titleElement.text().trim(),
          japaneseTitle: titleElement.attr("data-jp"),
          banner,
          url: `${this.baseUrl}/watch/${id}`,
          type: card.find("div.detail > div.info").children().eq(-2).text().trim(),
          genres: card
            .find("div.detail > div.info")
            .children()
            .last()
            .text()
            .trim()
            .split(",")
            .map((g) => g.trim()),
          releaseDate: card
            .find('div.detail > div.mics > div:contains("Release")')
            .children("span")
            .text()
            .trim(),
          quality: card
            .find('div.detail > div.mics > div:contains("Quality")')
            .children("span")
            .text()
            .trim(),
          sub: parseInt(card.find("div.detail > div.info > span.sub").text().trim()) || 0,
          dub: parseInt(card.find("div.detail > div.info > span.dub").text().trim()) || 0,
          description: card.find("div.detail > p.desc").text().trim(),
        });
      });
      return results;
    } catch (err) {
      Logger.error(`AnimeKai spotlight error: ${String(err)}`);
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
      $("a.aitem").each((_, el) => {
        const card = $(el);
        const titleElement = card.find(".title");
        const id = card.attr("href")?.split("/")[2];
        results.push({
          id,
          title: titleElement.text().trim(),
          url: `${this.baseUrl}/watch/${id}`,
          japaneseTitle: titleElement.attr("data-jp") || null,
          image: card.find(".poster img").attr("src"),
          type: card.find(".info").children().eq(-3).text().trim(),
          year: card.find(".info").children().eq(-2).text().trim(),
          sub: parseInt(card.find(".info span.sub").text()) || 0,
          dub: parseInt(card.find(".info span.dub").text()) || 0,
          episodes: parseInt(card.find(".info").children().eq(-4).text().trim()) || 0,
        });
      });
      return results;
    } catch (err) {
      Logger.error(`AnimeKai suggestions error: ${String(err)}`);
      return [];
    }
  }

  // ─── Anime Info ──────────────────────────────────────────────────────────────

  static async info(id: string): Promise<AnimeKaiInfo | null> {
    try {
      const animeSlug = id.split("$")[0]!;
      const html = await this.fetchWatchHtml(`${this.baseUrl}/watch/${animeSlug}`);
      if (!html) return null;
      const $ = cheerio.load(html);

      const info: any = {
        id: animeSlug,
        title: $(".entity-scroll > .title").text().trim(),
        japaneseTitle: $(".entity-scroll > .title").attr("data-jp")?.trim(),
        image: $("div.poster > div > img").attr("src"),
        description: $(".entity-scroll > .desc").text().trim(),
        type: $(".entity-scroll > .info").children().last().text().toUpperCase(),
        url: `${this.baseUrl}/watch/${animeSlug}`,
      };

      // Sub / dub availability
      const hasSub = $(".entity-scroll > .info > span.sub").length > 0;
      const hasDub = $(".entity-scroll > .info > span.dub").length > 0;
      info.hasSub = hasSub;
      info.hasDub = hasDub;
      info.subOrDub = hasSub && hasDub ? "both" : hasDub ? "dub" : "sub";

      // Genres
      $(".entity-scroll > .detail div").each(function () {
        const text = $(this).text().trim();
        if (text.startsWith("Genres:")) {
          info.genres = text
            .replace("Genres:", "")
            .split(",")
            .map((g: string) => g.trim());
        }
      });

      // Status
      const statusText = $(".entity-scroll > .detail")
        .find("div:contains('Status') > span")
        .text()
        .trim();
      info.status = statusText;

      info.season = $(".entity-scroll > .detail")
        .find("div:contains('Premiered') > span")
        .text()
        .trim();
      info.duration = $(".entity-scroll > .detail")
        .find("div:contains('Duration') > span")
        .text()
        .trim();

      // External links (MAL / AniList)
      $(".entity-scroll > .detail div")
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

      // Recommendations
      info.recommendations = [];
      $("section.sidebar-section:not(#related-anime) .aitem-col .aitem").each((_, ele) => {
        const aTag = $(ele);
        const recId = aTag.attr("href")?.replace("/watch/", "");
        info.recommendations!.push({
          id: recId,
          title: aTag.find(".title").text().trim(),
          url: `${this.baseUrl}${aTag.attr("href")}`,
          image:
            aTag.attr("style")?.match(/background-image:\s*url\('(.+?)'\)/)?.[1] ??
            aTag.find("img").attr("src"),
          japaneseTitle: aTag.find(".title").attr("data-jp")?.trim(),
          type: aTag.find(".info").children().last().text().trim(),
          sub: parseInt(aTag.find(".info span.sub").text()) || 0,
          dub: parseInt(aTag.find(".info span.dub").text()) || 0,
          episodes:
            parseInt(aTag.find(".info").children().eq(-2).text().trim()) ||
            parseInt(aTag.find(".info span.sub").text()) ||
            0,
        });
      });

      // Relations
      info.relations = [];
      $("section#related-anime .aitem-col a.aitem").each((_, el) => {
        const aTag = $(el);
        const infoBox = aTag.find(".info");
        const relId = aTag.attr("href")?.replace("/watch/", "") ?? "";
        const bolds = infoBox.find("span > b");
        let episodes = 0;
        let type = "";
        let relationType = "";
        bolds.each((_, b) => {
          const text = $(b).text().trim();
          if ($(b).hasClass("text-muted")) {
            relationType = text;
          } else if (/^\d+$/.test(text)) {
            episodes = parseInt(text);
          } else {
            type = text;
          }
        });
        info.relations!.push({
          id: relId,
          title: aTag.find(".title").text().trim(),
          url: `${this.baseUrl}${aTag.attr("href")}`,
          image: aTag.attr("style")?.match(/background-image:\s*url\('(.+?)'\)/)?.[1],
          japaneseTitle: aTag.find(".title").attr("data-jp")?.trim(),
          type: type.toUpperCase(),
          sub: parseInt(infoBox.find(".sub").text()) || 0,
          dub: parseInt(infoBox.find(".dub").text()) || 0,
          relationType,
          episodes,
        });
      });

      // Episodes.
      //
      // The site used to hand these out via /ajax/episodes/list?ani_id=…&_=<token>,
      // keyed off #anime-rating[data-id] and a MegaUp-generated token. Both are
      // gone: the element no longer exists and that endpoint now answers "404"
      // for every id. Episodes are server-rendered into the watch page instead,
      // and each anchor carries its own availability flags — so no token, no
      // second request, and per-episode sub/dub accuracy rather than inferring
      // it from a total count.
      info.episodes = [];
      $("div.eplist a[data-num]").each((_, el) => {
        const el$ = $(el);
        const numAttr = el$.attr("data-num");
        const number = parseInt(numAttr ?? "", 10);
        if (!Number.isFinite(number)) return;
        if (info.episodes.some((e: AnimeKaiEpisode) => e.number === number)) return;

        const href = el$.attr("href") ?? `/watch/${animeSlug}/ep-${number}`;
        info.episodes.push({
          id: `${animeSlug}$ep=${number}`,
          number,
          title: el$.children("span").first().text().trim() || `Episode ${number}`,
          isFiller: el$.hasClass("filler"),
          isSubbed: el$.attr("data-sub") === "1" || el$.attr("data-hsub") === "1",
          isDubbed: el$.attr("data-dub") === "1",
          url: href.startsWith("http") ? href : `${this.baseUrl}${href}`,
        });
      });
      info.episodes.sort((a: AnimeKaiEpisode, b: AnimeKaiEpisode) => a.number - b.number);
      info.totalEpisodes = info.episodes.length;

      return info;
    } catch (err) {
      Logger.error(`AnimeKai info error: ${String(err)}`);
      return null;
    }
  }

  // ─── Episode Servers ─────────────────────────────────────────────────────────

  // Reads the player list off an episode page.
  //
  // Replaces the old three-request MegaUp chain (/ajax/links/list → /ajax/links/view
  // → decodeIframeData, each needing a generated token). The site now renders every
  // player straight into the page:
  //   <span class="server-video" data-video="<embed url>" data-tab="tab_N">Name</span>
  // with a language tab bar mapping tab_N to hsub / sub / dub:
  //   <span class="tab tab_N" data-id="sub">
  // Tab order varies per title (not every anime has all three), so the mapping is
  // built from the bar rather than assumed.
  // The watch page is ~270 KB and the origin serves it slowly (measured ~6.5s),
  // so cache the parsed player list briefly. /watch and /servers are usually
  // called back-to-back for the same episode, and every audio type is read off
  // the one page — without this each of those repeats the whole download.
  private static playersCache = new Map<
    string,
    { at: number; players: { name: string; url: string; lang: string }[] }
  >();
  private static PLAYERS_TTL_MS = 5 * 60_000;

  private static async fetchEpisodePlayers(
    episodeId: string,
  ): Promise<{ name: string; url: string; lang: string }[]> {
    const animeSlug = episodeId.split("$")[0]!;
    const epNum = /\$ep=([^$]+)/.exec(episodeId)?.[1] ?? "1";
    const pageUrl = `${this.baseUrl}/watch/${animeSlug}/ep-${epNum}`;

    const cached = this.playersCache.get(pageUrl);
    if (cached && Date.now() - cached.at < this.PLAYERS_TTL_MS) return cached.players;

    const html = await this.fetchWatchHtml(pageUrl, `${this.baseUrl}/watch/${animeSlug}`);
    if (!html) return [];
    const $ = cheerio.load(html);

    const tabLang = new Map<string, string>();
    $(".server-type .tab, .server-tab .tab").each((i, el) => {
      const cls = ($(el).attr("class") ?? "").match(/tab_\d+/)?.[0];
      const lang = $(el).attr("data-id");
      if (cls && lang) tabLang.set(cls, lang);
    });

    const players: { name: string; url: string; lang: string }[] = [];
    $(".server-video[data-video]").each((_, el) => {
      const url = $(el).attr("data-video");
      if (!url) return;
      const tab = $(el).attr("data-tab") ?? "";
      players.push({
        name: $(el).text().trim() || "unknown",
        url,
        lang: tabLang.get(tab) ?? tab,
      });
    });

    if (players.length > 0) this.playersCache.set(pageUrl, { at: Date.now(), players });
    return players;
  }

  // anikai keeps listing servers whose video has since been removed — the
  // Doodstream (playmogo) entry commonly answers with its own "Video not
  // found" page. Those are HTTP 200 (or a transient 403 under rate limiting),
  // so status alone can't be trusted; the body has to be inspected.
  private static readonly DEAD_PLAYER_MARKERS =
    /video not found|file not found|we can't find the file|no longer available|has been deleted|Error Code:\s*410/i;

  private static deadCache = new Map<string, { at: number; dead: boolean }>();
  private static DEAD_TTL_MS = 10 * 60_000;

  private static async isDeadPlayer(url: string): Promise<boolean> {
    const hit = this.deadCache.get(url);
    if (hit && Date.now() - hit.at < this.DEAD_TTL_MS) return hit.dead;

    let dead: boolean;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: `${this.baseUrl}/`,
        },
        // Never let a slow embed host dominate the watch response.
        signal: AbortSignal.timeout(3000),
      });
      const body = await res.text();
      // Only a served page that *says* the video is gone counts. Some hosts
      // (playmogo/Doodstream) sit behind a Cloudflare challenge and answer 403
      // "Just a moment…" to any server-side fetch while still playing fine in
      // a real WebView, which solves the challenge — dropping those would
      // remove working servers.
      dead = res.ok && this.DEAD_PLAYER_MARKERS.test(body);
    } catch {
      // Timeout or network failure is not proof the video is gone.
      dead = false;
    }

    this.deadCache.set(url, { at: Date.now(), dead });
    return dead;
  }

  /** upstream lang token (hsub/sub/dub) → the API's subOrDub vocabulary */
  private static langMatches(lang: string, want: "softsub" | "dub" | "hardsub"): boolean {
    const l = lang.toLowerCase();
    if (want === "dub") return l === "dub";
    if (want === "hardsub") return l === "hsub";
    return l === "sub" || l === "softsub";
  }

  private static langSuffix(lang: string): string {
    const l = lang.toLowerCase();
    if (l === "dub") return " (Dub)";
    if (l === "hsub") return " (HardSub)";
    return " (SoftSub)";
  }

  static async fetchEpisodeServers(
    episodeId: string,
    subOrDub: "softsub" | "dub" | "hardsub" = "hardsub",
  ): Promise<AnimeKaiServer[]> {
    try {
      const players = await this.fetchEpisodePlayers(episodeId);
      return players
        .filter((p) => this.langMatches(p.lang, subOrDub))
        .map((p) => ({
          name: `anikai ${p.name}${this.langSuffix(p.lang)}`.toLowerCase(),
          url: p.url,
          isDub: p.lang.toLowerCase() === "dub",
          // The page no longer ships skip markers; they came from the decoded
          // MegaUp payload that this endpoint no longer uses.
          intro: { start: 0, end: 0 },
          outro: { start: 0, end: 0 },
        }));
    } catch (err) {
      Logger.error(`AnimeKai fetchEpisodeServers error: ${String(err)}`);
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
      const want = type ?? "hardsub";
      const players = await this.fetchEpisodePlayers(episodeId);
      const matching = players.filter((p) => this.langMatches(p.lang, want));

      // Players are third-party embeds rather than the old MegaUp links. Only
      // vivibebe (the default HD-1 host) reduces to a direct stream; otakuhg /
      // otakuvid / playmogo hide theirs behind packed scripts and stay iframes.
      // Some carry their subtitle track as a `sub`/`caption_1` query param.
      const results = await Promise.all(
        matching.map(async (p) => {
          let subtitles: any[] = [];
          try {
            const q = new URL(p.url).searchParams;
            const subUrl = q.get("sub") ?? q.get("caption_1");
            if (subUrl) {
              subtitles = [
                {
                  url: subUrl,
                  lang: q.get("sub_1") ?? "English",
                  type: want === "dub" ? "none" : "soft",
                },
              ];
            }
          } catch {
            /* leave subtitles empty */
          }

          const base = {
            name: `Anikai ${p.name}${this.langSuffix(p.lang)}`,
            iframe: p.url,
            subtitles,
            download: null,
          };

          if (isVivibebeUrl(p.url)) {
            const m3u8 = await getVivibebeSource(p.url);
            if (m3u8) {
              // Plays with no Referer, and ships a real 360p/720p/1080p ladder.
              const qualities = await fetchVariants(m3u8);
              return {
                ...base,
                sources: [{ file: m3u8, type: "hls" }],
                ...(qualities.length > 0 ? { qualities } : {}),
              };
            }
          }

          // Not resolvable to a stream — check the embed actually still has a
          // video before offering it. (HLS entries above skip this: extracting
          // a playlist already proves the server is alive.)
          const dead = await this.isDeadPlayer(p.url);
          return { ...base, sources: [{ file: p.url, type: "iframe" }], dead };
        }),
      );

      // Direct streams first so clients default to a playable source.
      results.sort((a: any, b: any) => {
        const rank = (r: any) => (r.sources[0]?.type === "hls" ? 0 : 1);
        return rank(a) - rank(b);
      });

      const live = results.filter((r: any) => !r.dead);
      // If every server looked dead, the check is more likely wrong than the
      // whole episode being gone — fall back to the unfiltered list.
      const chosen = live.length > 0 ? live : results;
      for (const r of chosen) delete (r as any).dead;

      return { isDub: want === "dub", results: chosen };
    } catch (err) {
      Logger.error(`AnimeKai streams error: ${String(err)}`);
      return { isDub: false, results: [] };
    }
  }

  // ─── Downloads ───────────────────────────────────────────────────────────────

  // /download/<slug>/ep-<n> lists direct download links per host, grouped by
  // audio type, plus the episode's subtitle files in every available language
  // (the watch page only ever exposes one). Markup:
  //   <article class="ak-download-row" data-type="sub">
  //     <div class="ak-download-row-meta"><span class="ak-download-quality">Original</span>
  //       <span>SUB</span><span>MP4</span><span>178.16 MB</span></div>
  //     <div class="ak-download-servers">
  //       <div class="ak-download-server"><div><strong>StreamHG</strong><small>178.16 MB</small></div>
  //         <a class="ak-download-button" href="…/d/<id>">
  // Subtitles reuse .ak-download-server but sit outside any row, which is how
  // the two are told apart below.
  static async downloads(episodeId: string): Promise<{
    id: string;
    episode: number;
    url: string;
    rows: {
      type: string;
      quality: string;
      format: string;
      size: string;
      servers: { name: string; size: string; url: string }[];
    }[];
    subtitles: { lang: string; format: string; url: string }[];
  } | null> {
    try {
      const animeSlug = episodeId.split("$")[0]!;
      const epNum = /\$ep=([^$]+)/.exec(episodeId)?.[1] ?? "1";
      const pageUrl = `${this.baseUrl}/download/${animeSlug}/ep-${epNum}`;

      const res = await fetch(pageUrl, {
        headers: { ...this.headers(), Referer: `${this.baseUrl}/watch/${animeSlug}/ep-${epNum}` },
      });
      if (!res.ok) return null;
      const $ = cheerio.load(await res.text());

      const parseServer = (el: any) => {
        const s$ = $(el);
        const url = s$.find("a.ak-download-button, a[href]").attr("href") ?? "";
        return {
          name: s$.find("strong").first().text().trim() || "unknown",
          size: s$.find("small").first().text().trim(),
          url,
        };
      };

      const rows = $(".ak-download-row")
        .toArray()
        .map((row) => {
          const r$ = $(row);
          const meta = r$
            .find(".ak-download-row-meta span")
            .toArray()
            .map((s) => $(s).text().trim());
          const quality = r$.find(".ak-download-quality").text().trim() || meta[0] || "";
          // meta reads [quality, SUB/DUB, container, size]; take the last two
          // positionally rather than by index so an extra badge doesn't shift it.
          const size = meta.length > 0 ? meta[meta.length - 1]! : "";
          const format = meta.length > 1 ? meta[meta.length - 2]! : "";
          return {
            type: (r$.attr("data-type") ?? "").toLowerCase(),
            quality,
            format,
            size,
            servers: r$
              .find(".ak-download-server")
              .toArray()
              .map(parseServer)
              .filter((s) => s.url),
          };
        })
        .filter((r) => r.servers.length > 0);

      // EarnVids is the one host that breaks its file into quality tiers, so
      // enrich those entries with resolution + size per tier. One fetch per
      // EarnVids server; the route caches the whole response for a day.
      await Promise.all(
        rows.flatMap((row) =>
          row.servers
            .filter((s) => isEarnvidsUrl(s.url))
            .map(async (s) => {
              const q = await getEarnvidsQualities(s.url);
              if (!q) return;
              (s as any).filename = q.filename;
              (s as any).qualities = q.qualities;
            }),
        ),
      );

      const subtitles = $(".ak-download-server")
        .toArray()
        .filter((el) => $(el).closest(".ak-download-row").length === 0)
        .map((el) => {
          const s = parseServer(el);
          return { lang: s.name, format: s.size, url: s.url };
        })
        .filter((s) => s.url);

      return {
        id: animeSlug,
        episode: parseInt(epNum, 10) || 1,
        url: pageUrl,
        rows,
        subtitles,
      };
    } catch (err) {
      Logger.error(`AnimeKai downloads error: ${String(err)}`);
      return null;
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

      const episode = info.episodes.find((ep: AnimeKaiEpisode) => ep.number === episodeNumber);
      return episode ? episode.id : null;
    } catch (err) {
      Logger.error(`AnimeKai getEpisodeSession error: ${String(err)}`);
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
      Logger.error(`AnimeKai getMappingsAndName error: ${String(err)}`);
      return null;
    }
  }
}
