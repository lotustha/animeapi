import * as cheerio from "cheerio";
import { Logger } from "../../../core/logger.js";
import { aniwaves as aniwavesSite } from "../../origins.js";
import type {
  AniwavesEpisode,
  AniwavesInfo,
  AniwavesPagedResult,
  AniwavesRelatedItem,
  AniwavesSearchItem,
  AniwavesServer,
  AniwavesStreamResponse,
  AniwavesStreamSource,
  AniwavesSuggestionItem,
} from "./types.js";

// aniwaves.ru is a self-contained hianime/zoro-style clone. The full chain is
// public (no auth):
//   search   GET /filter?keyword=&page=        → cards → /watch/{slug}-{id}
//   episodes GET /ajax/episode/list/{id}        → episode list
//   servers  GET /ajax/server/list?servers={id}&eps={n} → sub/ssub/dub + link-id
//   sources  GET /ajax/sources?id={link-id}&asi=0&autoPlay=0 → embed url + skip
// The embed (weneverbeenfree / megacloud-family) is framable, so /watch returns
// it as the iframe; raw m3u8 extraction from the embed is a follow-up.
export class Aniwaves {
  private static base = aniwavesSite;
  private static UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  // ─── HTTP helpers ─────────────────────────────────────────────────────────────

  private static headers(ajax = false): Record<string, string> {
    const h: Record<string, string> = {
      "User-Agent": this.UA,
      "Accept-Language": "en-US,en;q=0.9",
      Referer: `${this.base}/`,
    };
    if (ajax) {
      h["X-Requested-With"] = "XMLHttpRequest";
      h["Accept"] = "*/*";
    }
    return h;
  }

  // aniwaves rate-limits/bot-challenges its dynamic pages (non-200) under bursts,
  // recovering within ~1s. One short retry absorbs that; route-level caching
  // handles the rest.
  private static async fetchWithRetry(
    url: string,
    headers: Record<string, string>,
    label: string,
  ): Promise<Response | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { headers });
        if (res.ok) return res;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        Logger.warn(`Aniwaves ${label} HTTP ${res.status}: ${url}`);
      } catch (err) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        Logger.error(`Aniwaves ${label} error: ${String(err)}`);
      }
    }
    return null;
  }

  private static async getHtml(path: string): Promise<string | null> {
    const res = await this.fetchWithRetry(`${this.base}${path}`, this.headers(), "getHtml");
    return res ? await res.text() : null;
  }

  private static async getAjax<T = any>(path: string): Promise<T | null> {
    const res = await this.fetchWithRetry(`${this.base}${path}`, this.headers(true), "getAjax");
    if (!res) return null;
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  private static toInt(v: unknown): number {
    const n = parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }

  // "naruto-76396" → "76396"
  private static numericId(id: string): string {
    const m = /(\d+)$/.exec(String(id).trim());
    return m ? m[1]! : "";
  }

  // ─── Card parsing (search + browse share the same markup) ─────────────────────

  private static parseCard($: cheerio.CheerioAPI, el: any): AniwavesSearchItem | null {
    const $el = $(el);
    const $a = $el.find("a.name.d-title").first();
    const href = ($a.attr("href") || $el.find(".ani.poster a").attr("href") || "").trim();
    if (!href) return null;
    const id = href.replace(/^\/watch\//, "").replace(/^\//, "");
    if (!id) return null;
    const title = ($a.text() || $el.find(".ani.poster img").attr("alt") || "").trim();
    const jp = $a.attr("data-jp") || null;
    const image = $el.find(".ani.poster img").attr("src") || undefined;
    const type = $el.find(".ani.poster .meta .right").first().text().trim() || undefined;
    const sub = this.toInt($el.find(".ep-status.sub span").first().text());
    const dub = this.toInt($el.find(".ep-status.dub span").first().text());
    const total = this.toInt($el.find(".ep-status.total span").first().text());
    return {
      id,
      title,
      url: `${this.base}/watch/${id}`,
      image,
      japaneseTitle: jp,
      type,
      sub,
      dub,
      episodes: total || Math.max(sub, dub),
    };
  }

  private static parseListPage(
    html: string,
    page: number,
  ): AniwavesPagedResult<AniwavesSearchItem> {
    const $ = cheerio.load(html);
    const results: AniwavesSearchItem[] = [];
    $("#list-items .item, .ani.items .item").each((_, el) => {
      const card = this.parseCard($, el);
      if (card) results.push(card);
    });

    // Pagination: hasNext if there's a page after the active one.
    let hasNextPage = false;
    let totalPages = page;
    const $pag = $(".pagination");
    if ($pag.length) {
      const nums = $pag
        .find("a.page-link, li a")
        .map((_, a) => this.toInt($(a).text()))
        .get()
        .filter((n) => n > 0);
      if (nums.length) totalPages = Math.max(totalPages, ...nums);
      hasNextPage =
        $pag.find("a[rel='next'], .page-item.active + .page-item, li.active + li").length > 0 ||
        page < totalPages;
    }
    return {
      currentPage: results.length ? page : 0,
      hasNextPage,
      totalPages: results.length ? totalPages : 0,
      results,
    };
  }

  // ─── Search & browse ──────────────────────────────────────────────────────────

  static async search(query: string, page = 1): Promise<AniwavesPagedResult<AniwavesSearchItem>> {
    if (!query) return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    const p = page > 0 ? page : 1;
    const html = await this.getHtml(`/filter?keyword=${encodeURIComponent(query)}&page=${p}`);
    if (!html) return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    return this.parseListPage(html, p);
  }

  private static async browse(
    path: string,
    page = 1,
  ): Promise<AniwavesPagedResult<AniwavesSearchItem>> {
    const p = page > 0 ? page : 1;
    // aniwaves paginates by path (/{path}/page/{n}); ?page= just 301-redirects
    // there, so hit it directly to avoid the extra round-trip.
    const url = p > 1 ? `${path}/page/${p}` : path;
    const html = await this.getHtml(url);
    if (!html) return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    return this.parseListPage(html, p);
  }

  static recentEpisodes(page = 1) {
    return this.browse("/updated", page);
  }
  static recentlyAdded(page = 1) {
    return this.browse("/added", page);
  }
  static newest(page = 1) {
    return this.browse("/newest", page);
  }
  static ongoing(page = 1) {
    return this.browse("/ongoing", page);
  }
  static mostPopular(page = 1) {
    return this.browse("/most-popular", page);
  }
  static topAiring(page = 1) {
    return this.browse("/top-airing", page);
  }
  static latestCompleted(page = 1) {
    return this.browse("/completed", page);
  }
  static movies(page = 1) {
    return this.browse("/type/movies", page);
  }
  static tv(page = 1) {
    return this.browse("/type/tv-series", page);
  }
  static ova(page = 1) {
    return this.browse("/type/ova", page);
  }
  static ona(page = 1) {
    return this.browse("/type/ona", page);
  }
  static specials(page = 1) {
    return this.browse("/type/special", page);
  }
  static music(page = 1) {
    return this.browse("/type/music", page);
  }
  static genreSearch(genre: string, page = 1) {
    if (!genre)
      return Promise.resolve({ currentPage: 0, hasNextPage: false, totalPages: 0, results: [] });
    return this.browse(`/genre/${encodeURIComponent(genre)}`, page);
  }

  static async suggestions(query: string): Promise<AniwavesSuggestionItem[]> {
    if (!query) return [];
    const out = await this.search(query, 1);
    return out.results.slice(0, 10).map((r) => ({ ...r, year: "" }));
  }

  // ─── Spotlight (home page featured carousel) ──────────────────────────────────
  // Slides live in the home swiper: each `.swiper-slide.item` has a title,
  // synopsis, banner background-image, and a "Play now" link to /watch/{slug-id}.
  static async spotlight(): Promise<any[]> {
    const html = await this.getHtml("/home");
    if (!html) return [];
    const $ = cheerio.load(html);
    const out: any[] = [];
    const seen = new Set<string>();
    $(".swiper-slide.item").each((_, el) => {
      const $el = $(el);
      const href = (
        $el.find(".actions a[href^='/watch/'], a.btn.play[href^='/watch/']").first().attr("href") ||
        ""
      ).trim();
      if (!href) return; // skip non-spotlight carousels (cards have no Play link)
      const id = href.replace(/^\/watch\//, "").replace(/^\//, "");
      const $title = $el.find("h2.title.d-title, .title.d-title").first();
      const title = $title.text().trim();
      if (!id || !title || seen.has(id)) return;
      seen.add(id);
      const style =
        $el
          .find(".image [style*='background-image'], [style*='background-image']")
          .first()
          .attr("style") || "";
      const bm = /url\(['"]?([^'")]+)['"]?\)/.exec(style);
      const banner = bm ? bm[1]! : null;
      out.push({
        id,
        title,
        japaneseTitle: $title.attr("data-jp") || null,
        banner,
        image: banner || undefined,
        url: `${this.base}/watch/${id}`,
        type: $el.find(".meta .quality").first().text().trim() || "",
        rating: $el.find(".meta .rating").first().text().trim() || undefined,
        genres: [] as string[],
        releaseDate: "",
        sub: 0,
        dub: 0,
        description: $el.find(".synopsis").first().text().trim(),
      });
    });
    return out;
  }

  // ─── Info + episodes ──────────────────────────────────────────────────────────

  private static cleanTitle(raw: string): string {
    // og:title looks like "Naruto (2002) – Watch TV Anime Online in HD"
    return raw
      .replace(/\s*[–-]\s*Watch.*$/i, "")
      .replace(/\s*\(\d{4}\)\s*$/, "")
      .trim();
  }

  static async info(id: string): Promise<AniwavesInfo | null> {
    if (!id) return null;
    const path = id.startsWith("/watch/") ? id : `/watch/${id}`;
    const html = await this.getHtml(path);
    if (!html) return null;
    const $ = cheerio.load(html);

    const ogTitle = $('meta[property="og:title"]').attr("content") || $("title").text() || "";
    const onPageTitle = $(".title.d-title, .film-name, h1.title, h2.title").first();
    const title = (onPageTitle.text().trim() || this.cleanTitle(ogTitle)).trim();
    const jp = onPageTitle.attr("data-jp") || null;
    const image =
      $('meta[property="og:image"]').attr("content") ||
      $(".ani.poster img, .film-poster img").attr("src") ||
      undefined;
    const description = (
      $('meta[property="og:description"]').attr("content") ||
      $(".description, .synopsis").first().text() ||
      ""
    ).trim();
    const genres = $(".genre a, a[href^='/genre/']")
      .map((_, a) => $(a).text().trim())
      .get()
      .filter((g, i, arr) => g && arr.indexOf(g) === i);

    const numId = this.numericId(id);
    const episodes = await this.fetchEpisodes(numId);
    const hasDub = episodes.some((e) => e.isDubbed);
    const hasSub = episodes.some((e) => e.isSubbed);

    return {
      id,
      title,
      japaneseTitle: jp,
      image,
      cover: image ?? null,
      description: description || undefined,
      type: undefined,
      url: `${this.base}${path}`,
      totalEpisodes: episodes.length,
      hasSub: hasSub || true,
      hasDub,
      subOrDub: hasDub ? "both" : "sub",
      genres,
      recommendations: [] as AniwavesRelatedItem[],
      relations: [] as AniwavesRelatedItem[],
      episodes,
    };
  }

  private static async fetchEpisodes(numId: string): Promise<AniwavesEpisode[]> {
    if (!numId) return [];
    const data = await this.getAjax<{ status: number; result: string }>(
      `/ajax/episode/list/${numId}`,
    );
    if (!data?.result) return [];
    const $ = cheerio.load(data.result);
    const eps: AniwavesEpisode[] = [];
    $("a[data-num]").each((_, a) => {
      const $a = $(a);
      const number = this.toInt($a.attr("data-num"));
      if (!number) return;
      const $li = $a.closest("li");
      const title = ($li.attr("title") || $a.attr("title") || `Episode ${number}`).trim();
      eps.push({
        id: `${numId}$ep=${number}`,
        number,
        title,
        isFiller: ($li.attr("class") || $a.attr("class") || "").includes("filler"),
        isSubbed: this.toInt($a.attr("data-sub")) > 0 || true,
        isDubbed: this.toInt($a.attr("data-dub")) > 0,
        url: `${this.base}/watch/${numId}?ep=${number}`,
      });
    });
    return eps;
  }

  // ─── Servers + streams ──────────────────────────────────────────────────────────

  private static parseEpisodeId(episodeId: string): { numId: string; ep: number } | null {
    if (!episodeId) return null;
    const numId = episodeId.split("$")[0]!;
    if (!/^\d+$/.test(numId)) return null;
    const m = /\$ep=(\d+)/.exec(episodeId);
    const ep = m ? parseInt(m[1]!, 10) : 1;
    if (!ep) return null;
    return { numId, ep };
  }

  // Public `type` → aniwaves data-type. sub/hardsub → "sub", softsub/ssub →
  // "ssub", dub → "dub".
  private static normalizeType(type?: string): "sub" | "ssub" | "dub" {
    switch ((type || "").toLowerCase()) {
      case "dub":
        return "dub";
      case "softsub":
      case "ssub":
        return "ssub";
      default:
        return "sub";
    }
  }

  // Parse /ajax/server/list into [{type, svId, name, linkId}].
  private static parseServers(
    resultHtml: string,
  ): { type: string; svId: string; name: string; linkId: string }[] {
    const $ = cheerio.load(resultHtml);
    const out: { type: string; svId: string; name: string; linkId: string }[] = [];
    $(".type").each((_, group) => {
      const $g = $(group);
      const type = ($g.attr("data-type") || "sub").toLowerCase();
      $g.find("li[data-link-id]").each((_, li) => {
        const $li = $(li);
        const linkId = $li.attr("data-link-id") || "";
        if (!linkId) return;
        const svId = $li.attr("data-sv-id") || "";
        const name = ($li.find("a, span").first().text() || $li.text() || `Server ${svId}`).trim();
        out.push({ type, svId, name: name || `Server ${svId}`, linkId });
      });
    });
    return out;
  }

  // Resolve a single link-id to its embed URL + skip data.
  private static async resolveSource(
    linkId: string,
  ): Promise<{ url: string; intro?: [number, number]; outro?: [number, number] } | null> {
    const data = await this.getAjax<{ status: number; result: any }>(
      `/ajax/sources?id=${encodeURIComponent(linkId)}&asi=0&autoPlay=0`,
    );
    const r = data?.result;
    const url: string | undefined = r?.url;
    if (!url) return null;
    const intro =
      Array.isArray(r?.skip_data?.intro) && (r.skip_data.intro[0] || r.skip_data.intro[1])
        ? ([this.toInt(r.skip_data.intro[0]), this.toInt(r.skip_data.intro[1])] as [number, number])
        : undefined;
    const outro =
      Array.isArray(r?.skip_data?.outro) && (r.skip_data.outro[0] || r.skip_data.outro[1])
        ? ([this.toInt(r.skip_data.outro[0]), this.toInt(r.skip_data.outro[1])] as [number, number])
        : undefined;
    return { url, intro, outro };
  }

  static async fetchEpisodeServers(episodeId: string, type?: string): Promise<AniwavesServer[]> {
    const parsed = this.parseEpisodeId(episodeId);
    if (!parsed) return [];
    const want = this.normalizeType(type);
    const data = await this.getAjax<{ status: number; result: string }>(
      `/ajax/server/list?servers=${parsed.numId}&eps=${parsed.ep}`,
    );
    if (!data?.result) return [];
    const servers = this.parseServers(data.result).filter((s) => s.type === want);

    const out: AniwavesServer[] = [];
    for (const s of servers) {
      const src = await this.resolveSource(s.linkId);
      if (!src) continue;
      out.push({
        name: `aniwaves ${s.name} (${want})`.toLowerCase(),
        url: src.url,
        isDub: want === "dub",
        type: want,
        intro: { start: src.intro?.[0] ?? 0, end: src.intro?.[1] ?? 0 },
        outro: { start: src.outro?.[0] ?? 0, end: src.outro?.[1] ?? 0 },
      });
    }
    return out;
  }

  static async streams(episodeId: string, type?: string): Promise<AniwavesStreamResponse> {
    const parsed = this.parseEpisodeId(episodeId);
    if (!parsed) return { isDub: false, results: [] };
    const want = this.normalizeType(type);
    const isDub = want === "dub";

    const data = await this.getAjax<{ status: number; result: string }>(
      `/ajax/server/list?servers=${parsed.numId}&eps=${parsed.ep}`,
    );
    if (!data?.result) return { isDub, results: [] };
    const servers = this.parseServers(data.result).filter((s) => s.type === want);

    const results: AniwavesStreamSource[] = [];
    let intro: [number, number] | undefined;
    let outro: [number, number] | undefined;
    for (const s of servers) {
      const src = await this.resolveSource(s.linkId);
      if (!src) continue;
      if (!intro && src.intro) intro = src.intro;
      if (!outro && src.outro) outro = src.outro;
      results.push({
        name: `Aniwaves ${s.name} (${want.toUpperCase()})`,
        iframe: src.url,
        type: want,
        sources: [],
        subtitles: [],
        download: null,
      });
    }

    return {
      isDub,
      results,
      ...(intro ? { intro } : {}),
      ...(outro ? { outro } : {}),
    };
  }
}
