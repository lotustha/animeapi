import * as cheerio from "cheerio";
import { getFillerEpisodes, resolveMalId } from "../../../core/fillers.js";
import { Logger } from "../../../core/logger.js";
import { proxifyFetch, proxifySource } from "../../../core/proxy.js";
import { hianime as hianimeOrigin } from "../../origins.js";
import { USER_AGENT } from "../animepahe/scraper/utils.js";
import { MegaPlay } from "./scraper/megaplay.js";
import type {
  HiAnimeAudioType,
  HiAnimeCard,
  HiAnimeEpisode,
  HiAnimeHome,
  HiAnimeInfo,
  HiAnimePagedResult,
  HiAnimeServer,
  HiAnimeSpotlight,
} from "./types.js";

// hianime.at is a Zoro-family site: server-rendered listing/detail pages plus a
// small JSON-over-HTML API at /api/theme/ for episodes and servers. It hosts no
// video and encrypts nothing of its own — every server is a base64 `data-hash`
// that decodes to a third-party embed URL (see scraper/megaplay.ts).
//
// Two conventions matter throughout:
//   * Every href in the markup is absolute (https://hianime.at/...), so slugs
//     are derived by stripping the origin, never by trimming a leading "/".
//   * A title's slug always ends in its numeric id ("bleach-1369" → 1369), and
//     that same id is the `data-id` on the poster anchor. The episode-list API
//     is keyed on it, so no extra lookup request is needed to resolve it.
export class HiAnime {
  private static baseUrl = hianimeOrigin;
  private static apiBase = `${hianimeOrigin}/api/theme`;

  private static headers(): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      Accept: "text/html, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.5",
      Connection: "keep-alive",
      Referer: `${this.baseUrl}/`,
    };
  }

  private static ajaxHeaders(referer?: string): Record<string, string> {
    return {
      ...this.headers(),
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      ...(referer ? { Referer: referer } : {}),
    };
  }

  private static parseInt(text: string | undefined | null): number {
    if (!text) return 0;
    const n = parseInt(String(text).trim().replace(/,/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }

  /** Absolute href → site-relative slug. Drops the origin, any /watch/ prefix and the query. */
  private static toSlug(href: string | undefined | null): string {
    if (!href) return "";
    let path = href.trim();
    try {
      path = new URL(path, this.baseUrl).pathname;
    } catch {
      /* already a bare path */
    }
    return path
      .replace(/^\/+/, "")
      .replace(/^watch\//, "")
      .replace(/\/+$/, "");
  }

  /** A slug always ends in the title's numeric id — the key the /api/theme endpoints use. */
  private static aniIdFromSlug(slug: string): string | null {
    return /-(\d+)$/.exec(slug)?.[1] ?? (/^\d+$/.test(slug) ? slug : null);
  }

  private static absolute(slugOrHref: string | undefined | null): string {
    const slug = this.toSlug(slugOrHref);
    return slug ? `${this.baseUrl}/${slug}` : this.baseUrl;
  }

  // ─── Card scraper for /home, /search, /genres/*, /movie, /tv etc. ──────────

  private static scrapeFlwCard($: cheerio.CheerioAPI, el: any): HiAnimeCard | null {
    const card = $(el);
    // The detail anchor (a.dynamic-name) points at /<slug>; the poster anchor
    // points at /watch/<slug>?ep=latest. Prefer the detail one — the poster
    // href carries a query that would otherwise end up inside the id.
    const detailEl = card.find("a.dynamic-name, .film-name a").first();
    const posterEl = card.find("a.film-poster-ahref").first();
    const id = this.toSlug(detailEl.attr("href") ?? posterEl.attr("href"));
    if (!id) return null;

    const img = card.find("img.film-poster-img").first();
    const tick = card.find(".film-poster .tick, .film-stats .tick, .fd-infor .tick").first();
    const fdInfo = card.find(".fd-infor .fdi-item, .film-stats .item");

    const sub = this.parseInt(tick.find(".tick-sub").text());
    const dub = this.parseInt(tick.find(".tick-dub").text());

    return {
      id,
      // data-id on the poster anchor and the slug's trailing number agree;
      // fall back to the slug so cards without the attribute still resolve.
      aniId: posterEl.attr("data-id")?.trim() || this.aniIdFromSlug(id),
      title: detailEl.text().trim() || card.find(".film-name").first().text().trim(),
      japaneseTitle: detailEl.attr("data-jname")?.trim() || null,
      url: this.absolute(id),
      image: img.attr("src") || img.attr("data-src") || null,
      type: fdInfo.first().text().trim(),
      duration: fdInfo.eq(1).text().trim() || null,
      rating: tick.find(".tick-pg").text().trim() || null,
      quality: tick.find(".tick-quality").text().trim() || null,
      sub,
      dub,
      episodes: this.parseInt(tick.find(".tick-eps").text()) || Math.max(sub, dub),
    };
  }

  // Trending is a swiper of compact .item cards (number + title + poster link)
  // rather than the standard .flw-item layout, so it gets its own parser.
  private static scrapeTrendingItem($: cheerio.CheerioAPI, el: any): HiAnimeCard | null {
    const card = $(el);
    const posterLink = card.find("a.film-poster").first();
    const id = this.toSlug(posterLink.attr("href"));
    if (!id) return null;
    const titleEl = card.find(".film-title").first();
    const img = posterLink.find("img").first();
    return {
      id,
      aniId: this.aniIdFromSlug(id),
      title: titleEl.text().trim(),
      japaneseTitle: titleEl.attr("data-jname")?.trim() || null,
      url: this.absolute(id),
      image: img.attr("src") || img.attr("data-src") || null,
      type: "",
      duration: null,
      rating: null,
      quality: null,
      sub: 0,
      dub: 0,
      episodes: 0,
    };
  }

  private static async scrapeCardPage(url: string): Promise<HiAnimePagedResult<HiAnimeCard>> {
    try {
      const res = await fetch(url, { headers: this.headers() });
      const html = await res.text();
      const $ = cheerio.load(html);

      const pagination = $("ul.pagination");
      const currentPage = this.parseInt(pagination.find(".page-item.active .page-link").text());

      // The active page's <a> has no href, so "next" is the following item —
      // either the next number or the ">" control; both carry ?page=N.
      const nextHref = pagination.find(".page-item.active").next().find("a.page-link").attr("href");
      const hasNextPage = !!nextHref && /page=\d+/.test(nextHref);

      const lastHref = pagination.find(".page-item:last-child a.page-link").attr("href");
      const totalPages = this.parseInt(lastHref?.split("page=")[1]) || currentPage || 1;

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
    // /browser was the old site's path; hianime.at serves search at /search.
    // encodeURIComponent handles the spacing on its own — pre-substituting "+"
    // would be re-encoded to %2B and searched for literally.
    const q = encodeURIComponent(query.trim());
    return this.scrapeCardPage(`${this.baseUrl}/search?keyword=${q}&page=${Math.max(page, 1)}`);
  }

  private static category(path: string, page: number) {
    return this.scrapeCardPage(`${this.baseUrl}/${path}?page=${Math.max(page, 1)}`);
  }

  static movies(page: number = 1) {
    return this.category("movie", page);
  }
  static tv(page: number = 1) {
    return this.category("tv", page);
  }
  static ova(page: number = 1) {
    return this.category("ova", page);
  }
  static ona(page: number = 1) {
    return this.category("ona", page);
  }
  static specials(page: number = 1) {
    return this.category("special", page);
  }
  static completed(page: number = 1) {
    return this.category("latest-completed", page);
  }
  static newReleases(page: number = 1) {
    return this.category("new-releases", page);
  }
  static recentlyUpdated(page: number = 1) {
    return this.category("recently-updated", page);
  }
  // /recent and /new-anime serve the same listing upstream; /new-anime is the
  // one the site's own nav links to.
  static recentlyAdded(page: number = 1) {
    return this.category("new-anime", page);
  }
  static async genreSearch(genre: string, page: number = 1) {
    if (!genre) throw new Error("genre is required");
    return this.category(`genres/${genre}`, page);
  }

  // ─── Genres list ────────────────────────────────────────────────────────────

  static async genres(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/home`, { headers: this.headers() });
      const $ = cheerio.load(await res.text());
      const slugs = new Set<string>();
      // hrefs are absolute now, so match on a contained path, not a prefix.
      $('a[href*="/genres/"]').each((_, el) => {
        const m = /\/genres\/([^/?#]+)/.exec($(el).attr("href") ?? "");
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
    const home: HiAnimeHome = { spotlight: [], trending: [], latestUpdates: [], mostViewed: [] };
    try {
      const res = await fetch(`${this.baseUrl}/home`, { headers: this.headers() });
      const $ = cheerio.load(await res.text());

      $(".swiper-slide .deslide-item").each((_, el) => {
        const slide = $(el);
        const titleEl = slide.find(".desi-head-title").first();
        const id = this.toSlug(slide.find(".desi-buttons a[href*='/watch/']").attr("href"));
        if (!id) return;
        const scd = slide.find(".sc-detail .scd-item");
        const tick = slide.find(".tick");
        const rankMatch = /#(\d+)/.exec(slide.find(".desi-sub-text").text().trim());
        const bannerImg = slide.find(".deslide-cover-img img").first();
        home.spotlight.push({
          id,
          aniId: this.aniIdFromSlug(id),
          rank: rankMatch ? parseInt(rankMatch[1]!, 10) : null,
          title: titleEl.text().trim(),
          japaneseTitle: titleEl.attr("data-jname")?.trim() || null,
          url: this.absolute(id),
          banner: bannerImg.attr("src") || bannerImg.attr("data-src") || null,
          description: slide.find(".desi-description").text().trim() || null,
          type: scd.eq(0).text().trim() || null,
          duration: scd.eq(1).text().trim() || null,
          releaseDate: scd.eq(2).text().trim() || null,
          quality: tick.find(".tick-quality").text().trim() || null,
          sub: this.parseInt(tick.find(".tick-sub").text()),
          dub: this.parseInt(tick.find(".tick-dub").text()),
        });
      });

      $("section.block_area_trending .swiper-slide .item").each((_, el) => {
        const parsed = this.scrapeTrendingItem($, el);
        if (parsed) home.trending.push(parsed);
      });

      // The sidebar renders day/week/month tabs; only the active pane is taken,
      // otherwise every title shows up three times.
      $(".cbox-realtime .tab-content .tab-pane.active li").each((_, el) => {
        const parsed = this.scrapeFlwCard($, el);
        if (parsed) home.mostViewed.push(parsed);
      });

      $("section.block_area_home .flw-item").each((_, el) => {
        const parsed = this.scrapeFlwCard($, el);
        if (parsed) home.latestUpdates.push(parsed);
      });

      return home;
    } catch (err) {
      Logger.error(`HiAnime home error: ${String(err)}`);
      return home;
    }
  }

  static async spotlight(): Promise<HiAnimeSpotlight[]> {
    return (await this.home()).spotlight;
  }

  // ─── Suggestions (search dropdown) ──────────────────────────────────────────

  static async suggestions(query: string): Promise<HiAnimeCard[]> {
    try {
      const url = `${this.apiBase}/search/suggestions?keyword=${encodeURIComponent(query.trim())}`;
      const res = await fetch(url, { headers: this.ajaxHeaders() });
      const data = (await res.json()) as { html?: string };
      if (typeof data.html !== "string") return [];
      const $ = cheerio.load(data.html);
      const out: HiAnimeCard[] = [];
      // Suggestion rows are bare <a class="nav-item"> — a flatter layout than
      // .flw-item, so they're read directly rather than via scrapeFlwCard.
      $("a.nav-item").each((_, el) => {
        const row = $(el);
        const id = this.toSlug(row.attr("href"));
        if (!id) return;
        const img = row.find("img").first();
        const nameEl = row.find(".film-name").first();
        // .film-infor is "<span>date</span> · TV · <span>duration</span>" — the
        // type is the bare text node between the separators, so it's read by
        // stripping the spans and dots rather than by index.
        const infor = row.find(".film-infor").first();
        const type = infor.clone().find("span, i").remove().end().text().trim();
        out.push({
          id,
          aniId: this.aniIdFromSlug(id),
          title: nameEl.text().trim() || row.attr("title")?.trim() || "",
          japaneseTitle: nameEl.attr("data-jname")?.trim() || null,
          url: this.absolute(id),
          image: img.attr("src") || img.attr("data-src") || null,
          type,
          duration: null,
          rating: null,
          quality: null,
          sub: 0,
          dub: 0,
          episodes: 0,
        });
      });
      return out;
    } catch (err) {
      Logger.warn(`HiAnime suggestions error: ${String(err)}`);
      return [];
    }
  }

  // ─── Info (detail page metadata + episodes) ─────────────────────────────────

  /**
   * Reads an `.anisc-info` label/value row, e.g. detailRow($, "Studios").
   * Two row shapes exist: `.item-title` holds its value in `.name` (or `.text`
   * for the overview), while `.item-list` (Genres) holds a list of `<a>`s.
   */
  private static detailRow($: cheerio.CheerioAPI, label: string): string | null {
    const row = $(".anisc-info .item")
      .filter((_, el) => $(el).find(".item-head").text().trim().replace(/:$/, "") === label)
      .first();
    if (!row.length) return null;

    const collect = (sel: string) =>
      row
        .find(sel)
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(Boolean)
        .join(", ");

    const value = row.hasClass("item-list")
      ? collect("a")
      : row.find(".name").length
        ? collect(".name")
        : row.find(".text").text().trim();
    return value.trim() || null;
  }

  static async info(idOrSlug: string): Promise<HiAnimeInfo | null> {
    try {
      const slug = this.toSlug(idOrSlug.split("$")[0]!);
      const aniId = this.aniIdFromSlug(slug);
      if (!slug || !aniId) return null;

      const detailRes = await fetch(`${this.baseUrl}/${slug}`, { headers: this.headers() });
      if (!detailRes.ok) return null;
      const $ = cheerio.load(await detailRes.text());

      const titleEl = $(".anisc-detail .film-name").first();
      const title = titleEl.text().trim();
      // A missing title means the slug fell through to the shell page rather
      // than a real entry — return null so the route answers 404 instead of an
      // empty record (the same failure mode fixed for animekai in 22674f6).
      if (!title) return null;

      const tick = $(".anisc-detail .film-stats .tick").first();
      const sub = this.parseInt(tick.find(".tick-sub").text());
      const dub = this.parseInt(tick.find(".tick-dub").text());
      const stats = $(".anisc-detail .film-stats .tick .item");

      const aired = this.detailRow($, "Aired");
      const [startDate, endDate] = (aired ?? "").split(" to ").map((s) => s.trim() || null);

      const splitRow = (label: string): string[] => {
        const v = this.detailRow($, label);
        return v
          ? v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      };

      const poster = $(".anisc-poster img.film-poster-img").first();
      const coverStyle = $(".anis-cover").first().attr("style") ?? "";

      const episodes = await this.episodes(slug, aniId, sub, dub);

      // "Recommended For You" — the only .flw-item grid on a detail page.
      const recommendations: HiAnimeCard[] = [];
      $("section.block_area_home .flw-item").each((_, el) => {
        const card = this.scrapeFlwCard($, el);
        if (card) recommendations.push(card);
      });

      // The site carries no filler data, so resolve the MAL id by exact title
      // match and overlay Jikan's filler list — same treatment animekai and
      // anizen get. A title that doesn't resolve just keeps isFiller: false.
      const malId = await resolveMalId(title, titleEl.attr("data-jname")?.trim());
      if (malId) {
        const fillers = await getFillerEpisodes(malId);
        for (const ep of episodes) {
          if (fillers.has(ep.number)) ep.isFiller = true;
        }
      }

      return {
        id: slug,
        aniId,
        title,
        japaneseTitle: titleEl.attr("data-jname")?.trim() || this.detailRow($, "Japanese"),
        altTitles: splitRow("Synonyms"),
        description: this.detailRow($, "Overview"),
        image: poster.attr("src") || poster.attr("data-src") || null,
        banner: /url\(([^)]+)\)/.exec(coverStyle)?.[1]?.replace(/['"]/g, "") ?? null,
        url: `${this.baseUrl}/${slug}`,
        type: stats.eq(0).text().trim() || null,
        status: this.detailRow($, "Status"),
        season: this.detailRow($, "Premiered"),
        duration: this.detailRow($, "Duration") || stats.eq(1).text().trim() || null,
        rating: tick.find(".tick-pg").text().trim() || null,
        quality: tick.find(".tick-quality").text().trim() || null,
        broadcast: this.detailRow($, "Broadcast"),
        startDate: startDate ?? null,
        endDate: endDate && endDate !== "?" ? endDate : null,
        year: this.parseInt(/(\d{4})/.exec(startDate ?? "")?.[1]) || null,
        // The site publishes no total-episode figure, so this is the number of
        // rows the episode list returned — i.e. episodes *aired* so far for a
        // currently-airing show, not the planned total.
        episodeCount: episodes.length || null,
        sub,
        dub,
        hasSub: sub > 0,
        hasDub: dub > 0,
        subOrDub: sub > 0 && dub > 0 ? "both" : dub > 0 ? "dub" : "sub",
        // The detail page carries a MAL score but no MAL/AniList ids. The keys
        // are kept so the response shape doesn't change for existing clients;
        // callers that need the ids should resolve them via /mappings.
        malId: null,
        anilistId: null,
        score: this.detailRow($, "MAL Score"),
        genres: splitRow("Genres"),
        studios: splitRow("Studios"),
        producers: splitRow("Producers"),
        episodes,
        recommendations,
      };
    } catch (err) {
      Logger.error(`HiAnime info error: ${String(err)}`);
      return null;
    }
  }

  // GET /api/theme/episode/list/{aniId} → { status, totalItems, html }, where
  // html is the full episode grid. Episode ids are the `data-id` on each
  // a.ep-item and are unrelated to the anime id (the two coincide only for id 1,
  // so never validate this parsing against One Piece alone).
  private static async episodes(
    slug: string,
    aniId: string,
    sub: number,
    dub: number,
  ): Promise<HiAnimeEpisode[]> {
    try {
      const res = await fetch(`${this.apiBase}/episode/list/${aniId}`, {
        headers: this.ajaxHeaders(`${this.baseUrl}/watch/${slug}`),
      });
      const data = (await res.json()) as { html?: string };
      if (typeof data.html !== "string") return [];
      const $ = cheerio.load(data.html);

      const episodes: HiAnimeEpisode[] = [];
      $("a.ep-item").each((_, el) => {
        const ep = $(el);
        const episodeId = ep.attr("data-id")?.trim();
        const number = this.parseInt(ep.attr("data-number"));
        if (!episodeId) return;
        const nameEl = ep.find(".ep-name").first();
        episodes.push({
          id: `${slug}$ep=${episodeId}`,
          episodeId,
          number,
          title: nameEl.text().trim() || ep.attr("title")?.trim() || `Episode ${number}`,
          japaneseTitle: nameEl.attr("data-jname")?.trim() || null,
          // hianime.at marks no fillers at all (no filler class anywhere in the
          // episode grid); info() overlays Jikan's list afterwards.
          isFiller: false,
          isSubbed: number <= sub,
          isDubbed: number <= dub,
          url: `${this.baseUrl}/watch/${slug}?ep=${episodeId}`,
        });
      });
      return episodes;
    } catch (err) {
      Logger.warn(`HiAnime episodes error for ${slug}: ${String(err)}`);
      return [];
    }
  }

  // ─── Episode servers ────────────────────────────────────────────────────────

  /**
   * The site offers only `sub` and `dub` groups now — the old site's separate
   * softsub tier is gone. "hardsub"/"softsub"/"sub" are all accepted and map to
   * `sub` so existing clients keep working.
   */
  private static normalizeType(type: string | undefined): HiAnimeAudioType {
    return String(type ?? "").toLowerCase() === "dub" ? "dub" : "sub";
  }

  /** Episode ids are `<slug>$ep=<episodeId>`; a bare numeric id is also accepted. */
  private static parseEpisodeId(episodeId: string): { slug: string; ep: string } | null {
    const ep = episodeId.split("$ep=")[1]?.split("$")[0]?.trim();
    const slug = this.toSlug(episodeId.split("$")[0]!);
    if (ep) return { slug, ep };
    return /^\d+$/.test(slug) ? { slug: "", ep: slug } : null;
  }

  /**
   * Raw server list for an episode. Each `data-hash` is base64 of the embed URL
   * — hianime applies no encryption of its own here.
   */
  private static async serverList(
    episodeId: string,
    type: HiAnimeAudioType,
  ): Promise<{ name: string; type: string; embed: string }[]> {
    const parsed = this.parseEpisodeId(episodeId);
    if (!parsed) return [];

    // A bare numeric id carries no slug, so fall back to the site root rather
    // than building a "/watch/?ep=" referer that points at nothing.
    const referer = parsed.slug
      ? `${this.baseUrl}/watch/${parsed.slug}?ep=${parsed.ep}`
      : `${this.baseUrl}/`;

    const res = await fetch(`${this.apiBase}/episode/servers?episodeId=${parsed.ep}`, {
      headers: this.ajaxHeaders(referer),
    });
    const data = (await res.json()) as { html?: string };
    if (typeof data.html !== "string") return [];

    const $ = cheerio.load(data.html);
    const out: { name: string; type: string; embed: string }[] = [];
    $(".server-item").each((_, el) => {
      const item = $(el);
      const itemType = (item.attr("data-type") ?? "").toLowerCase();
      if (itemType !== type) return;
      const hash = item.attr("data-hash");
      if (!hash) return;
      let embed: string;
      try {
        embed = Buffer.from(hash, "base64").toString("utf8");
      } catch {
        return;
      }
      if (!/^https?:\/\//.test(embed)) return;
      out.push({
        name: item.attr("data-server-name")?.trim() || item.find("a.btn").text().trim(),
        type: itemType,
        embed,
      });
    });
    return out;
  }

  static async fetchEpisodeServers(episodeId: string, subOrDub?: string): Promise<HiAnimeServer[]> {
    try {
      const type = this.normalizeType(subOrDub);
      const servers = await this.serverList(episodeId, type);
      return servers.map((s) => ({
        name: s.name.toLowerCase(),
        url: s.embed,
        type: s.type,
        isDub: type === "dub",
        // The embed hosts hard-check Referer, so surface the one they expect
        // rather than leaving clients to guess (cf. 0706934 for anikoto).
        headers: { Referer: `${this.baseUrl}/` },
      }));
    } catch (err) {
      Logger.error(`HiAnime fetchEpisodeServers error: ${String(err)}`);
      return [];
    }
  }

  // ─── Streams (server list + extracted sources) ──────────────────────────────

  static async streams(_animeId: string, episodeId: string, type?: string): Promise<any> {
    const audio = this.normalizeType(type);
    try {
      const servers = await this.serverList(episodeId, audio);
      if (!servers.length) return { isDub: audio === "dub", results: [] };

      const suffix = audio === "dub" ? " (Dub)" : " (Sub)";

      const extractions = await Promise.all(
        servers.map(async (server) => {
          // zokoanime (and anything else unrecognised) has no known source
          // chain, so it is surfaced as an iframe the client can embed directly
          // rather than dropped — those players work fine in a browser.
          const extracted = MegaPlay.isExtractable(server.embed)
            ? await MegaPlay.extract(server.embed, this.baseUrl)
            : null;
          const refHeaders = extracted?.referer ? { Referer: extracted.referer } : undefined;

          return {
            extracted,
            result: {
              name: `${server.name}${suffix}`,
              iframe: server.embed,
              headers: { Referer: `${this.baseUrl}/` },
              sources: (extracted?.sources ?? []).map((s) => ({
                url: proxifySource(s.url, refHeaders),
                isM3U8: s.isM3U8,
              })),
              subtitles: (extracted?.subtitles ?? []).map((sb) => ({
                ...sb,
                url: proxifyFetch(sb.url, refHeaders),
              })),
            },
          };
        }),
      );

      // Picked after the fan-out rather than inside it: assigning from within
      // concurrent callbacks would take whichever request happened to land
      // first. Servers that report a zero-length range are skipped so a real
      // one further down the list still wins.
      const firstRange = (pick: "intro" | "outro") =>
        extractions.map((e) => e.extracted?.[pick]).find((r) => r && r.end > r.start) ?? null;
      const intro = firstRange("intro");
      const outro = firstRange("outro");

      return {
        isDub: audio === "dub",
        results: extractions.map((e) => e.result),
        ...(intro && { intro }),
        ...(outro && { outro }),
      };
    } catch (err) {
      Logger.error(`HiAnime streams error: ${String(err)}`);
      return { isDub: audio === "dub", results: [] };
    }
  }
}
