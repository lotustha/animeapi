import * as cheerio from "cheerio";
import { Logger } from "../../../core/logger.js";
import { anikoto as anikotoOrigin } from "../../origins.js";
import { USER_AGENT } from "../animepahe/scraper/index.js";
import { MegaUp } from "../animekai/scraper/megaup.js";
import type {
  AnikotoEpisode,
  AnikotoInfo,
  AnikotoPagedResult,
  AnikotoSearchItem,
  AnikotoServer,
  AnikotoStreamSource,
} from "./types.js";

// anikoto.cz is an anikai-family site (same enc-kai vrf token scheme served by
// enc-dec.app) wrapped in a custom theme. Browsing is plain HTML scraping;
// episodes/servers/sources come from the /ajax/* API:
//   • /ajax/episode/list/<aniId>?vrf=<encKai(aniId)>  → episode <a> list
//   • /ajax/server/list?servers=<episode data-ids>     → server <li> list
//   • /ajax/server?get=<server data-link-id>           → { url, skip_data }
// The returned url is a megaplay.buzz player page; resolve it to a real m3u8
// the same way the anizen provider does. The m3u8 CDN hard-checks
// Referer: https://megaplay.buzz/, so that header is returned for the client
// to inject (no server-side proxying).
export class Anikoto {
  private static baseUrl = anikotoOrigin;

  private static headers(): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      Connection: "keep-alive",
      Accept: "text/html, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.5",
      Referer: `${this.baseUrl}/`,
    };
  }

  private static ajaxHeaders(referer?: string): Record<string, string> {
    return {
      ...this.headers(),
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: referer ?? `${this.baseUrl}/`,
    };
  }

  private static toInt(text: string | number | undefined | null): number {
    if (typeof text === "number") return Number.isFinite(text) ? Math.trunc(text) : 0;
    if (!text) return 0;
    const n = parseInt(String(text).trim(), 10);
    return Number.isFinite(n) ? n : 0;
  }

  /** /watch/<slug>/ep-1 → slug (also handles a bare /watch/<slug>). */
  private static parseSlug(href: string | undefined): string {
    if (!href) return "";
    const after = href.split("/watch/")[1] ?? href;
    return after
      .replace(/^\//, "")
      .replace(/\/ep-\d+\/?$/i, "")
      .replace(/\/$/, "");
  }

  // ─── Card / Pagination Scraper ───────────────────────────────────────────────

  // Upstream badge text is inconsistently cased across cards ("Movie" on the
  // poster badge vs "MOVIE" in the info meta) — normalize to one casing so
  // clients can match on type.
  private static normalizeShowType(raw: string): string | undefined {
    const t = raw.trim();
    if (!t) return undefined;
    const canonical: Record<string, string> = {
      TV: "TV",
      MOVIE: "Movie",
      OVA: "OVA",
      ONA: "ONA",
      SPECIAL: "Special",
      MUSIC: "Music",
    };
    return canonical[t.toUpperCase()] ?? t;
  }

  private static scrapeCard($: cheerio.CheerioAPI, el: any): AnikotoSearchItem | null {
    const card = $(el);
    const poster = card.find(".ani.poster, .poster").first();
    const linkEl = poster.find("a[href]").first();
    const nameEl = card.find("a.name.d-title, .name.d-title, a.name").first();
    const href = linkEl.attr("href") || nameEl.attr("href") || "";
    const slug = this.parseSlug(href);
    if (!slug) return null;

    const img = poster.find("img").first();
    const sub = this.toInt(poster.find(".ep-status.sub span").text());
    const dub = this.toInt(poster.find(".ep-status.dub span").text());
    const total = this.toInt(poster.find(".ep-status.total span").text());

    return {
      id: slug,
      aniId: poster.attr("data-tip") || card.find("[data-tip]").first().attr("data-tip") || null,
      title: nameEl.text().trim() || img.attr("alt")?.trim() || "",
      url: `${this.baseUrl}/watch/${slug}`,
      image: img.attr("src") || img.attr("data-src") || null,
      japaneseTitle: nameEl.attr("data-jp")?.trim() || null,
      type: this.normalizeShowType(
        poster.find(".meta .right").first().text().trim() ||
          card.find(".info .meta .m-item").eq(1).find("label").text().trim(),
      ),
      rating: card.find(".m-item.rated span").first().text().trim() || null,
      sub,
      dub,
      episodes: total || Math.max(sub, dub),
    };
  }

  private static async scrapeCardPage(url: string): Promise<AnikotoPagedResult<AnikotoSearchItem>> {
    try {
      const res = await fetch(url, { headers: this.headers() });
      const html = await res.text();
      const $ = cheerio.load(html);

      const results: AnikotoSearchItem[] = [];
      $(".item")
        .filter((_, e) => !$(e).hasClass("swiper-slide"))
        .each((_, el) => {
          const card = this.scrapeCard($, el);
          if (card) results.push(card);
        });

      const pag = $("ul.pagination").first();
      const currentPage = this.toInt(pag.find(".page-item.active a.page-link").text()) || 1;
      const hasNextPage = pag.find("a.page-link[rel='next']").length > 0;
      let totalPages = currentPage;
      pag.find("a.page-link[href]").each((_, e) => {
        const n = this.toInt($(e).text());
        if (n > totalPages) totalPages = n;
      });

      return {
        currentPage: results.length === 0 ? 0 : currentPage,
        hasNextPage: results.length === 0 ? false : hasNextPage,
        totalPages: results.length === 0 ? 0 : totalPages,
        results,
      };
    } catch (err) {
      Logger.error(`Anikoto scrapeCardPage error for ${url}: ${String(err)}`);
      return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    }
  }

  // ─── Browsing Endpoints ──────────────────────────────────────────────────────

  static async search(query: string, page = 1): Promise<AnikotoPagedResult<AnikotoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(
      `${this.baseUrl}/filter?keyword=${encodeURIComponent(query)}&page=${page}`,
    );
  }

  static async recentlyUpdated(page = 1): Promise<AnikotoPagedResult<AnikotoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/latest-updated?page=${page}`);
  }

  static async latest(page = 1): Promise<AnikotoPagedResult<AnikotoSearchItem>> {
    return this.recentlyUpdated(page);
  }

  static async newReleases(page = 1): Promise<AnikotoPagedResult<AnikotoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/new-release?page=${page}`);
  }

  static async recentlyAdded(page = 1): Promise<AnikotoPagedResult<AnikotoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?sort=latest-added&page=${page}`);
  }

  static async mostViewed(page = 1): Promise<AnikotoPagedResult<AnikotoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/most-viewed?page=${page}`);
  }

  static async latestCompleted(page = 1): Promise<AnikotoPagedResult<AnikotoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/status/finished-airing?page=${page}`);
  }

  static async movies(page = 1): Promise<AnikotoPagedResult<AnikotoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/type/movie?page=${page}`);
  }

  static async tv(page = 1): Promise<AnikotoPagedResult<AnikotoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/type/tv?page=${page}`);
  }

  static async ova(page = 1): Promise<AnikotoPagedResult<AnikotoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/type/ova?page=${page}`);
  }

  static async ona(page = 1): Promise<AnikotoPagedResult<AnikotoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/type/ona?page=${page}`);
  }

  static async specials(page = 1): Promise<AnikotoPagedResult<AnikotoSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/type/special?page=${page}`);
  }

  static async genreSearch(
    genre: string,
    page = 1,
  ): Promise<AnikotoPagedResult<AnikotoSearchItem>> {
    if (!genre) throw new Error("genre is required");
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/genre/${genre}?page=${page}`);
  }

  // ─── Genres ─────────────────────────────────────────────────────────────────

  // The genre menu lives on /home — the bare / is a splash landing page with
  // no nav, no slider, and no genre links.
  static async genres(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/home`, { headers: this.headers() });
      const $ = cheerio.load(await res.text());
      const set = new Set<string>();
      $("a[href*='/genre/']").each((_, el) => {
        const slug = $(el).attr("href")?.split("/genre/")[1]?.replace(/\/$/, "");
        if (slug) set.add(slug.toLowerCase());
      });
      return [...set];
    } catch (err) {
      Logger.error(`Anikoto genres error: ${String(err)}`);
      return [];
    }
  }

  // ─── Spotlight (homepage swiper) ──────────────────────────────────────────────

  // The slider (#hotest) is only rendered on /home; the bare / is a splash
  // landing page. Output mirrors anizen's spotlight shape — the slider carries
  // no episode counts, so sub/dub are presence flags (1/0), and it exposes no
  // show type or genre list.
  static async spotlight(): Promise<any[]> {
    try {
      const res = await fetch(`${this.baseUrl}/home`, { headers: this.headers() });
      const $ = cheerio.load(await res.text());
      const results: any[] = [];
      $(".swiper-slide.item").each((_, el) => {
        const card = $(el);
        const titleEl = card.find(".info .title.d-title, h2.title.d-title").first();
        const href = card.find(".actions a.play, .actions a").first().attr("href") || "";
        const slug = this.parseSlug(href);
        if (!slug) return;
        const bg = card.find(".image div[style]").attr("style") || "";
        results.push({
          id: slug,
          title: titleEl.text().trim(),
          japaneseTitle: titleEl.attr("data-jp")?.trim() || null,
          banner: bg.match(/url\(['"]?(.+?)['"]?\)/)?.[1] || null,
          url: `${this.baseUrl}/watch/${slug}`,
          type: "",
          genres: [],
          releaseDate: card.find(".meta.icons i.date").text().trim() || "",
          quality: card.find(".meta.icons i.quality").text().trim() || "",
          sub: card.find(".meta.icons i.sub").length > 0 ? 1 : 0,
          dub: card.find(".meta.icons i.dub").length > 0 ? 1 : 0,
          description: card.find(".synopsis").text().trim(),
        });
      });
      return results;
    } catch (err) {
      Logger.error(`Anikoto spotlight error: ${String(err)}`);
      return [];
    }
  }

  // ─── Search Suggestions ──────────────────────────────────────────────────────

  static async suggestions(query: string): Promise<any[]> {
    try {
      const url = `${this.baseUrl}/ajax/anime/search?keyword=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: this.ajaxHeaders() });
      const data = await res.json();
      const html = data?.result?.html ?? data?.result ?? "";
      const $ = cheerio.load(typeof html === "string" ? html : "");
      const results: any[] = [];
      $("a.item").each((_, el) => {
        const card = $(el);
        const nameEl = card.find(".name.d-title, .name").first();
        const slug = this.parseSlug(card.attr("href"));
        if (!slug) return;
        const img = card.find(".poster img").first();
        // .meta dots: [rating, score, type, year] — rating/score carry marker
        // classes, the bare dots are type then year.
        const plain = card
          .find(".meta .dot")
          .filter((_, d) => !$(d).hasClass("rating") && !$(d).hasClass("text-gray2"))
          .map((_, d) => $(d).text().trim())
          .get();
        results.push({
          id: slug,
          title: nameEl.text().trim() || img.attr("alt")?.trim() || "",
          url: `${this.baseUrl}/watch/${slug}`,
          image: img.attr("src") || img.attr("data-src") || null,
          japaneseTitle: nameEl.attr("data-jp")?.trim() || null,
          type: plain[0] ?? "",
          year: plain[1] && plain[1] !== "?" ? plain[1] : "",
        });
      });
      return results;
    } catch (err) {
      Logger.error(`Anikoto suggestions error: ${String(err)}`);
      return [];
    }
  }

  // ─── Schedule ────────────────────────────────────────────────────────────────

  static async schedule(date: string = new Date().toISOString().split("T")[0]!): Promise<any[]> {
    try {
      // Upstream takes the day as a unix timestamp (`time`), not a date string —
      // a `date=` param is silently ignored and always yields today's airings.
      const ts = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
      if (!Number.isFinite(ts)) return [];
      const url = `${this.baseUrl}/ajax/schedule/date?tz=0&time=${ts}`;
      const res = await fetch(url, { headers: this.ajaxHeaders() });
      const data = await res.json();
      const html = typeof data?.result === "string" ? data.result : "";
      const $ = cheerio.load(html);
      const results: any[] = [];
      $("a.item").each((_, el) => {
        const card = $(el);
        const titleEl = card.find(".title.d-title, .title").first();
        const slug = this.parseSlug(card.attr("href"));
        if (!slug) return;
        results.push({
          id: slug,
          aniId: card.find(".time").attr("data-tip") || null,
          title: titleEl.text().trim(),
          japaneseTitle: titleEl.attr("data-jp")?.trim() || null,
          airingTime: card.find(".time").text().trim(),
          airingEpisode: card
            .find(".ep span")
            .text()
            .trim()
            .replace(/Episode\s*/i, ""),
          url: `${this.baseUrl}/watch/${slug}`,
        });
      });
      return results;
    } catch (err) {
      Logger.error(`Anikoto schedule error: ${String(err)}`);
      return [];
    }
  }

  // ─── Anime Info + Episodes ─────────────────────────────────────────────────────

  static async info(id: string): Promise<AnikotoInfo | null> {
    try {
      const slug = id.split("$")[0]!;
      const res = await fetch(`${this.baseUrl}/watch/${slug}`, { headers: this.headers() });
      const $ = cheerio.load(await res.text());

      const aniId = $("#watch-main").attr("data-id") || null;
      const titleEl = $("h1.title.d-title").first();

      // anikoto serves a 200 soft-404 page for unknown slugs; treat a page with
      // neither an aniId nor a title as "not found".
      if (!aniId && !titleEl.text().trim()) return null;

      const info: AnikotoInfo = {
        id: slug,
        aniId,
        title: titleEl.text().trim(),
        japaneseTitle: titleEl.attr("data-jp")?.trim() || null,
        image: $("#watch-main .poster img").first().attr("src") || null,
        description: $(".synopsis .content").first().text().trim(),
        url: `${this.baseUrl}/watch/${slug}`,
        hasSub: $(".info .meta.icons i.sub").length > 0,
        hasDub: $(".info .meta.icons i.dub").length > 0,
        episodes: [],
      };

      const synonyms = $(".names").first().text().trim();
      if (synonyms) {
        info.synonyms = synonyms
          .split(/[;,]/)
          .map((s) => s.trim())
          .filter((s, i, arr) => s && arr.indexOf(s) === i);
      }
      info.subOrDub = info.hasSub && info.hasDub ? "both" : info.hasDub ? "dub" : "sub";

      // bmeta rows: "Type: TV", "Genres: a, b", "Studios: ...", etc.
      $(".bmeta .meta > div").each((_, el) => {
        const row = $(el);
        const label = row.clone().children().remove().end().text().replace(":", "").trim();
        const value = row.find("span").first().text().replace(/\s+/g, " ").trim();
        const links = row
          .find("span a")
          .map((_, a) => $(a).text().trim())
          .get()
          .filter(Boolean);
        switch (label.toLowerCase()) {
          case "type":
            info.type = value;
            break;
          case "premiered":
            info.season = value;
            break;
          case "aired":
            info.aired = value;
            break;
          case "status":
            info.status = value;
            break;
          case "duration":
            info.duration = value;
            break;
          case "mal":
            info.score = value;
            break;
          case "genres":
            info.genres = links;
            break;
          case "studios":
            info.studios = links.length ? links : value ? [value] : [];
            break;
          case "producers":
            info.producers = links.length ? links : value ? [value] : [];
            break;
        }
      });

      // Recommendations (sidebar "Recommended" block — a.item cards, not grid).
      info.recommendations = [];
      $(".w-side-section").each((_, sec) => {
        const section = $(sec);
        if (!/recommend/i.test(section.find(".head, h2, h3").first().text())) return;
        section.find("a.item").each((_, el) => {
          const a = $(el);
          const recSlug = this.parseSlug(a.attr("href"));
          if (!recSlug || recSlug === slug) return;
          const nameEl = a.find(".name.d-title, .name").first();
          const img = a.find(".poster img").first();
          info.recommendations!.push({
            id: recSlug,
            aniId: a.find(".poster").attr("data-tip") || null,
            title: nameEl.text().trim() || img.attr("alt")?.trim() || "",
            url: `${this.baseUrl}/watch/${recSlug}`,
            image: img.attr("src") || img.attr("data-src") || null,
            japaneseTitle: nameEl.attr("data-jp")?.trim() || null,
            type: a.find(".meta .dot").first().text().trim() || undefined,
          });
        });
      });

      // Episodes via ajax + enc-kai vrf
      if (aniId) {
        const eps = await this.fetchEpisodeList(aniId, slug);
        info.episodes = eps.episodes;
        info.totalEpisodes = eps.episodes.length;
        if (eps.malId) info.malId = eps.malId;
      }

      return info;
    } catch (err) {
      Logger.error(`Anikoto info error: ${String(err)}`);
      return null;
    }
  }

  private static async fetchEpisodeList(
    aniId: string,
    slug: string,
  ): Promise<{ episodes: AnikotoEpisode[]; malId?: string }> {
    const vrf = await MegaUp.generateToken(aniId);
    const url = `${this.baseUrl}/ajax/episode/list/${aniId}?vrf=${encodeURIComponent(vrf)}`;
    const res = await fetch(url, {
      headers: this.ajaxHeaders(`${this.baseUrl}/watch/${slug}`),
    });
    const data = await res.json();
    const html = typeof data?.result === "string" ? data.result : "";
    const $ = cheerio.load(html);

    const episodes: AnikotoEpisode[] = [];
    let malId: string | undefined;
    $("a[data-num]").each((_, el) => {
      const a = $(el);
      const num = this.toInt(a.attr("data-num"));
      if (!malId && a.attr("data-mal")) malId = a.attr("data-mal")!;
      const titleText = a.find(".d-title, span.name").text().trim();
      episodes.push({
        id: `${slug}$ep=${num}$id=${aniId}`,
        number: num,
        title: titleText || `Episode ${num}`,
        isFiller: a.hasClass("filler"),
        isSubbed: this.toInt(a.attr("data-sub")) > 0,
        isDubbed: this.toInt(a.attr("data-dub")) > 0,
        url: `${this.baseUrl}/watch/${slug}/ep-${num}`,
      });
    });

    return { episodes, malId };
  }

  // ─── Episode → server data-ids resolution ──────────────────────────────────────

  private static parseEpisodeId(
    episodeId: string,
  ): { slug: string; ep: number; aniId: string } | null {
    const slug = episodeId.split("$")[0] || "";
    const ep = this.toInt(episodeId.match(/\$ep=([^$]+)/)?.[1]);
    const aniId = episodeId.match(/\$id=([^$]+)/)?.[1] || "";
    if (!slug || !aniId || !ep) return null;
    return { slug, ep, aniId };
  }

  /** Re-fetch the episode list (fresh vrf) and return the episode's data-ids token. */
  private static async getEpisodeServersToken(
    slug: string,
    aniId: string,
    ep: number,
  ): Promise<string | null> {
    try {
      const vrf = await MegaUp.generateToken(aniId);
      const url = `${this.baseUrl}/ajax/episode/list/${aniId}?vrf=${encodeURIComponent(vrf)}`;
      const res = await fetch(url, {
        headers: this.ajaxHeaders(`${this.baseUrl}/watch/${slug}`),
      });
      const data = await res.json();
      const $ = cheerio.load(typeof data?.result === "string" ? data.result : "");
      const a = $(`a[data-num="${ep}"]`).first();
      return a.attr("data-ids") || null;
    } catch (err) {
      Logger.error(`Anikoto getEpisodeServersToken error: ${String(err)}`);
      return null;
    }
  }

  // Upstream groups servers into three blocks: data-type="sub" (soft sub),
  // "hsub" (subs burned into the video) and "dub".
  private static async fetchServerList(
    serversToken: string,
    referer: string,
  ): Promise<{ type: string; name: string; linkId: string }[]> {
    const url = `${this.baseUrl}/ajax/server/list?servers=${encodeURIComponent(serversToken)}`;
    const res = await fetch(url, { headers: this.ajaxHeaders(referer) });
    const data = await res.json();
    const $ = cheerio.load(typeof data?.result === "string" ? data.result : "");
    const servers: { type: string; name: string; linkId: string }[] = [];
    $(".servers .type[data-type]").each((_, block) => {
      const type = ($(block).attr("data-type") ?? "").toLowerCase();
      $(block)
        .find("li[data-link-id]")
        .each((_, el) => {
          const li = $(el);
          const linkId = li.attr("data-link-id");
          if (linkId) servers.push({ type, name: li.text().trim() || "server", linkId });
        });
    });
    return servers;
  }

  // Requested type → upstream block, in preference order. hardsub falls back
  // to the softsub block because many titles have no hsub encode at all.
  private static selectServers(
    servers: { type: string; name: string; linkId: string }[],
    requested: "softsub" | "dub" | "hardsub",
  ): { type: string; name: string; linkId: string }[] {
    const order =
      requested === "dub" ? ["dub"] : requested === "hardsub" ? ["hsub", "sub"] : ["sub", "hsub"];
    for (const t of order) {
      const picked = servers.filter((s) => s.type === t);
      if (picked.length > 0) return picked;
    }
    return [];
  }

  // Same labeling convention as the anizen provider so both providers'
  // stream names are interchangeable for clients.
  private static typeSuffix(t: string): string {
    if (t === "dub") return " (Dub)";
    if (t === "hsub") return " (HardSub)";
    return " (SoftSub)";
  }

  // The vidtube.site player (VidPlay-*) ignores the /sub|/hsub|/dub suffix in
  // its embed URL: all three resolve to the same data-id and the same
  // single-audio master.m3u8 with soft English subs (verified on multiple
  // titles). So a vidtube stream is always softsub — drop it from dub results
  // instead of surfacing Japanese audio labeled "(Dub)", and relabel it
  // "(SoftSub)" when the upstream hsub block leaks it.
  private static isTypeAgnosticPlayer(url: string): boolean {
    return /vidtube\.site/i.test(url);
  }

  private static async getSource(
    linkId: string,
    referer: string,
  ): Promise<{ url: string; intro: [number, number]; outro: [number, number] } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/ajax/server?get=${encodeURIComponent(linkId)}`, {
        headers: this.ajaxHeaders(referer),
      });
      const data = await res.json();
      const url = data?.result?.url;
      if (!url) return null;
      const skip = data?.result?.skip_data ?? {};
      const intro: [number, number] = Array.isArray(skip.intro) ? skip.intro : [0, 0];
      const outro: [number, number] = Array.isArray(skip.outro) ? skip.outro : [0, 0];
      return {
        url,
        intro: [this.toInt(intro[0]), this.toInt(intro[1])],
        outro: [this.toInt(outro[0]), this.toInt(outro[1])],
      };
    } catch (err) {
      Logger.error(`Anikoto getSource error: ${String(err)}`);
      return null;
    }
  }

  // ─── megaplay.buzz player → m3u8 resolver ───────────────────────────────────────

  private static async resolvePlayer(playerUrl: string): Promise<{
    m3u8: string;
    referer: string;
    subtitles: { url?: string; lang?: string; type?: string }[];
    intro?: [number, number];
    outro?: [number, number];
  } | null> {
    try {
      // megaplay.buzz and vidwish.live are mirror players. Scrape the data-id
      // off the player page, then call getSources on that SAME host (the id is
      // host-specific). The serving CDN checks Referer against the player host.
      const origin = new URL(playerUrl).origin;
      const pageRes = await fetch(playerUrl, {
        headers: { "User-Agent": USER_AGENT, Referer: `${this.baseUrl}/` },
      });
      if (!pageRes.ok) return null;
      const pageHtml = await pageRes.text();
      const fileId =
        /data-id\s*=\s*"(\d+)"/i.exec(pageHtml)?.[1] ||
        /id="megaplay-player"[^>]*data-id\s*=\s*"(\d+)"/i.exec(pageHtml)?.[1];
      if (!fileId) return null;

      const srcRes = await fetch(`${origin}/stream/getSources?id=${fileId}`, {
        headers: {
          "User-Agent": USER_AGENT,
          Referer: playerUrl,
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      if (!srcRes.ok) return null;
      const data = (await srcRes.json()) as any;
      const file: string | undefined = data?.sources?.file;
      if (!file) return null;

      const subtitles = (Array.isArray(data.tracks) ? data.tracks : [])
        .filter((tr: any) => tr?.kind !== "thumbnails" && typeof tr?.file === "string")
        .map((tr: any) => ({ url: tr.file, lang: tr.label ?? tr.kind, type: "soft" }));

      const intro: [number, number] | undefined =
        data?.intro && typeof data.intro.start === "number"
          ? [this.toInt(data.intro.start), this.toInt(data.intro.end)]
          : undefined;
      const outro: [number, number] | undefined =
        data?.outro && typeof data.outro.start === "number"
          ? [this.toInt(data.outro.start), this.toInt(data.outro.end)]
          : undefined;

      return { m3u8: file, referer: `${origin}/`, subtitles, intro, outro };
    } catch (err) {
      Logger.error(`Anikoto resolvePlayer error for ${playerUrl}: ${String(err)}`);
      return null;
    }
  }

  // ─── Public: Episode Servers ────────────────────────────────────────────────────

  static async fetchEpisodeServers(
    episodeId: string,
    subOrDub: "softsub" | "dub" | "hardsub" = "hardsub",
  ): Promise<AnikotoServer[]> {
    try {
      const parsed = this.parseEpisodeId(episodeId);
      if (!parsed) return [];
      const referer = `${this.baseUrl}/watch/${parsed.slug}/ep-${parsed.ep}`;

      const token = await this.getEpisodeServersToken(parsed.slug, parsed.aniId, parsed.ep);
      if (!token) return [];

      const serverList = this.selectServers(await this.fetchServerList(token, referer), subOrDub);

      const servers = await Promise.all(
        serverList.map(async (s): Promise<AnikotoServer | null> => {
          const src = await this.getSource(s.linkId, referer);
          if (!src) return null;
          const typeAgnostic = this.isTypeAgnosticPlayer(src.url);
          if (typeAgnostic && s.type === "dub") return null;
          return {
            name: `anikoto ${s.name}${typeAgnostic ? " (SoftSub)" : this.typeSuffix(s.type)}`.toLowerCase(),
            url: src.url,
            isDub: s.type === "dub",
            intro: { start: src.intro[0], end: src.intro[1] },
            outro: { start: src.outro[0], end: src.outro[1] },
          };
        }),
      );

      return servers.filter((s): s is AnikotoServer => s !== null);
    } catch (err) {
      Logger.error(`Anikoto fetchEpisodeServers error: ${String(err)}`);
      return [];
    }
  }

  // ─── Public: Streams ─────────────────────────────────────────────────────────────

  static async streams(episodeId: string, type?: "softsub" | "dub" | "hardsub"): Promise<any> {
    try {
      const parsed = this.parseEpisodeId(episodeId);
      if (!parsed) return { isDub: false, results: [] };
      const requested = type ?? "softsub";
      const isDub = requested === "dub";
      const referer = `${this.baseUrl}/watch/${parsed.slug}/ep-${parsed.ep}`;

      const token = await this.getEpisodeServersToken(parsed.slug, parsed.aniId, parsed.ep);
      if (!token) return { isDub, results: [] };

      const serverList = this.selectServers(await this.fetchServerList(token, referer), requested);

      let globalIntro: [number, number] | null = null;
      let globalOutro: [number, number] | null = null;
      const results: AnikotoStreamSource[] = [];

      for (const s of serverList) {
        const src = await this.getSource(s.linkId, referer);
        if (!src) continue;

        const typeAgnostic = this.isTypeAgnosticPlayer(src.url);
        if (typeAgnostic && s.type === "dub") continue;
        const name = `Anikoto ${s.name}${typeAgnostic ? " (SoftSub)" : this.typeSuffix(s.type)}`;
        const isAlreadyHls = /\.m3u8(\?|$)/i.test(src.url);
        if (!isAlreadyHls && /(megaplay\.buzz|vidwish\.live|vidtube\.site)/i.test(src.url)) {
          const resolved = await this.resolvePlayer(src.url);
          if (resolved) {
            results.push({
              name,
              iframe: src.url,
              sources: [{ file: resolved.m3u8, type: "hls" }],
              subtitles: resolved.subtitles.map((tr) => ({
                ...tr,
                type: isDub ? "none" : "soft",
              })),
              download: null,
              headers: { Referer: resolved.referer },
            });
            if (!globalIntro && resolved.intro) globalIntro = resolved.intro;
            if (!globalOutro && resolved.outro) globalOutro = resolved.outro;
          } else {
            results.push({
              name,
              iframe: src.url,
              sources: [{ file: src.url, type: "iframe" }],
              subtitles: [],
              download: null,
            });
          }
        } else {
          results.push({
            name,
            iframe: src.url,
            sources: [{ file: src.url, type: isAlreadyHls ? "hls" : "iframe" }],
            subtitles: [],
            download: null,
          });
        }

        // skip markers from the server payload as a fallback
        if (!globalIntro && (src.intro[0] || src.intro[1])) globalIntro = src.intro;
        if (!globalOutro && (src.outro[0] || src.outro[1])) globalOutro = src.outro;
      }

      return {
        isDub,
        results,
        ...(globalIntro ? { intro: globalIntro } : {}),
        ...(globalOutro ? { outro: globalOutro } : {}),
      };
    } catch (err) {
      Logger.error(`Anikoto streams error: ${String(err)}`);
      return { isDub: false, results: [] };
    }
  }

  // ─── Mapping Helpers ────────────────────────────────────────────────────────────

  static async getEpisodeSession(animeId: string, episodeNumber: number): Promise<string | null> {
    try {
      const info = await this.info(animeId);
      const episode = info?.episodes.find((ep: AnikotoEpisode) => ep.number === episodeNumber);
      return episode ? episode.id : null;
    } catch (err) {
      Logger.error(`Anikoto getEpisodeSession error: ${String(err)}`);
      return null;
    }
  }
}
