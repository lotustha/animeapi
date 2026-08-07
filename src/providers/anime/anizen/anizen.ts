import * as cheerio from "cheerio";
import { SERVER_ORIGIN } from "../../../core/config.js";
import { Logger } from "../../../core/logger.js";
import { proxifyFetch, proxifySource } from "../../../core/proxy.js";
import { anizen as anizenOrigin, anizen_api as anizenApi } from "../../origins.js";
import { USER_AGENT } from "../animepahe/scraper/index.js";
import { fetchVariants } from "./scraper/hls.js";
import { getVidmolySource, isVidmolyUrl } from "./scraper/vidmoly.js";
import type {
  AnizenAudioType,
  AnizenEpisode,
  AnizenQuality,
  AnizenInfo,
  AnizenPagedResult,
  AnizenRelatedItem,
  AnizenScheduleItem,
  AnizenSearchItem,
  AnizenServer,
  AnizenSpotlightItem,
  AnizenStreamResponse,
  AnizenStreamSource,
  AnizenSuggestionItem,
  AnizenTypeParam,
} from "./types.js";

// Wraps the upstream JSON API at aniapi.anizen.tr. Endpoint set + response
// shapes intentionally mirror src/providers/anime/animekai so /anime/anizen/*
// is drop-in compatible with /anime/animekai/*.
export class Anizen {
  private static api = anizenApi;
  private static site = anizenOrigin;

  private static headers(): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.5",
      Referer: `${this.site}/`,
      Origin: this.site,
    };
  }

  private static toInt(v: unknown): number {
    if (v === null || v === undefined || v === "") return 0;
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : 0;
  }

  // Upstream is mid-migration and leaks several unreachable hosts in its JSON.
  // Rewrite them all to cdn.anizen.tr (verified reachable, path-compatible)
  // before parsing so every surfaced poster/player/embed URL works:
  //   - aniapi.anizen.tr   → old NXDOMAIN host still hardcoded in some URLs
  //   - cdn.slay-knight.xyz → dead poster CDN used by /api/home + /api/info
  //   - http://127.0.0.1:<port> / localhost → internal player host leaked in
  //     /api/stream link.file + server embeds (the iframe-not-loading bug)
  private static rewriteHosts(text: string): string {
    return text
      .replaceAll("aniapi.anizen.tr", "cdn.anizen.tr")
      .replaceAll("cdn.slay-knight.xyz", "cdn.anizen.tr")
      .replace(/https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/gi, "https://cdn.anizen.tr");
  }

  private static async getJson<T = any>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.api}${path}`, { headers: this.headers() });
      if (!res.ok) return null;
      const text = this.rewriteHosts(await res.text());
      return JSON.parse(text) as T;
    } catch (err) {
      Logger.error(`Anizen getJson error for ${path}: ${String(err)}`);
      return null;
    }
  }

  // Fetches an SSR HTML page off the public frontend (anizen.tr). Used for
  // search, whose JSON API (cdn.anizen.tr/api/search) is broken upstream and
  // returns empty `data` for every keyword — the only working surface is the
  // server-rendered /search page.
  private static async getHtml(path: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.site}${path}`, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: `${this.site}/`,
        },
      });
      if (!res.ok) return null;
      return await res.text();
    } catch (err) {
      Logger.error(`Anizen getHtml error for ${path}: ${String(err)}`);
      return null;
    }
  }

  // ─── Card / Search mapping ──────────────────────────────────────────────────

  private static mapCard(item: any): AnizenSearchItem | null {
    if (!item || !item.id) return null;
    const tv = item.tvInfo ?? {};
    const subEps = this.toInt(tv.sub ?? tv.episodeInfo?.sub);
    const dubEps = this.toInt(tv.dub ?? tv.episodeInfo?.dub);
    return {
      id: item.id,
      title: item.title ?? "",
      url: `${this.site}/details/${item.id}`,
      image: item.poster ?? undefined,
      japaneseTitle: item.jname ?? null,
      type: tv.showType ?? item.showType ?? "",
      sub: subEps,
      dub: dubEps,
      episodes: Math.max(subEps, dubEps, this.toInt(tv.eps)),
    };
  }

  // ─── Search ─────────────────────────────────────────────────────────────────

  // Parses the SSR /search result grid. Each card is an
  //   <a href="/watch/<slug>" data-anime-id="<slug>" data-data-id="<short>">
  // wrapping a poster <img>, sub/dub badges (span.inline-flex: CC = sub,
  // microphone = dub), an <h3 title="…"> and a <p> whose first <span> is the
  // show type. Pagination shows as "Page <n> / <total>".
  private static parseSearchHtml(html: string, page: number): AnizenPagedResult<AnizenSearchItem> {
    const $ = cheerio.load(html);
    const results: AnizenSearchItem[] = [];

    $("a[data-anime-id]").each((_, el) => {
      const a = $(el);
      const id = (a.attr("data-anime-id") ?? "").trim();
      if (!id) return;
      const h3 = a.find("h3").first();
      const title = (h3.attr("title") ?? h3.text() ?? "").trim();
      if (!title) return;

      let sub = 0;
      let dub = 0;
      a.find("span.inline-flex").each((__, s) => {
        const sp = $(s);
        const num = this.toInt(sp.find("span").last().text());
        if (sp.find("i.fa-microphone").length > 0) dub = num;
        else if (/CC/.test(sp.text())) sub = num;
      });

      results.push({
        id,
        title,
        url: `${this.site}/details/${id}`,
        image: a.find("img").first().attr("src") ?? undefined,
        japaneseTitle: null,
        type: a.find("p span").first().text().trim(),
        sub,
        dub,
        episodes: Math.max(sub, dub),
      });
    });

    let totalPages = 0;
    $("span").each((_, s) => {
      const m = /^Page\s+\d+\s*\/\s*(\d+)$/.exec($(s).text().replace(/\s+/g, " ").trim());
      if (m) totalPages = this.toInt(m[1]);
    });

    const currentPage = results.length === 0 ? 0 : page;
    const hasNextPage = currentPage > 0 && totalPages > 0 ? currentPage < totalPages : false;
    return {
      currentPage,
      hasNextPage,
      totalPages: results.length === 0 ? 0 : totalPages,
      results,
    };
  }

  static async search(query: string, page = 1): Promise<AnizenPagedResult<AnizenSearchItem>> {
    if (!query) return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    const p = page > 0 ? page : 1;
    const html = await this.getHtml(`/search?keyword=${encodeURIComponent(query)}&page=${p}`);
    if (!html) return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    return this.parseSearchHtml(html, p);
  }

  static async suggestions(query: string): Promise<AnizenSuggestionItem[]> {
    if (!query) return [];
    const out = await this.search(query, 1);
    // Animekai's suggestion shape adds `year` (and is otherwise card-shaped).
    // Anizen search items don't expose year separately, so we leave it null.
    return out.results.slice(0, 10).map((r) => ({ ...r, year: "" }));
  }

  // ─── Filter-backed browse endpoints ─────────────────────────────────────────

  // The JSON /api/filter is dead the same way /api/search is — it returns an
  // empty `data` array (with a non-zero totalPage) for every type/status/genre.
  // The SSR /genre/<slug> page is the only working browse surface; it renders
  // the same card grid search does, so reuse parseSearchHtml. The route accepts
  // genre slugs, the show-type tokens (movie/tv/ova/specials) and status tokens
  // (currently-airing/finished-airing/recently-added).
  private static async filterHtml(
    slug: string,
    page: number,
  ): Promise<AnizenPagedResult<AnizenSearchItem>> {
    const empty = { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    if (!slug) return empty;
    const p = page > 0 ? page : 1;
    const html = await this.getHtml(`/genre/${encodeURIComponent(slug)}?page=${p}`);
    if (!html) return empty;
    return this.parseSearchHtml(html, p);
  }

  static movies(page = 1) {
    return this.filterHtml("movie", page);
  }
  static tv(page = 1) {
    return this.filterHtml("tv", page);
  }
  static ova(page = 1) {
    return this.filterHtml("ova", page);
  }
  // Upstream has no working ONA browse: /genre/ona (and /genre/onas) fall back
  // to a fuzzy name match that returns mostly TV-typed shows, not ONAs. Return
  // empty rather than surface wrong-typed results under an "ona" label.
  static ona(_page = 1): Promise<AnizenPagedResult<AnizenSearchItem>> {
    return Promise.resolve({ currentPage: 0, hasNextPage: false, totalPages: 0, results: [] });
  }
  static specials(page = 1) {
    return this.filterHtml("specials", page);
  }
  static newReleases(page = 1) {
    return this.filterHtml("currently-airing", page);
  }
  static latestCompleted(page = 1) {
    return this.filterHtml("finished-airing", page);
  }
  static genreSearch(genre: string, page = 1) {
    return this.filterHtml(genre, page);
  }

  // ─── Home cache (shared by spotlight + recent endpoints) ────────────────────

  private static homeCache: { at: number; data: any } | null = null;
  private static HOME_TTL_MS = 60_000;

  private static async getHome(): Promise<any | null> {
    const now = Date.now();
    if (this.homeCache && now - this.homeCache.at < this.HOME_TTL_MS) {
      return this.homeCache.data;
    }
    const raw = await this.getJson("/api/home");
    if (raw) this.homeCache = { at: now, data: raw };
    return raw;
  }

  static async spotlight(): Promise<AnizenSpotlightItem[]> {
    const raw = await this.getHome();
    const arr = raw?.results?.spotlights ?? [];
    return (Array.isArray(arr) ? arr : [])
      .map((it: any): AnizenSpotlightItem | null => {
        if (!it?.id) return null;
        const tv = it.tvInfo ?? {};
        const ep = tv.episodeInfo ?? {};
        return {
          id: it.id,
          title: it.title ?? "",
          japaneseTitle: it.jname ?? null,
          banner: it.poster ?? null,
          url: `${this.site}/details/${it.id}`,
          type: tv.showType ?? "",
          genres: [],
          releaseDate: tv.releaseDate ?? "",
          quality: tv.quality ?? "",
          sub: this.toInt(ep.sub),
          dub: this.toInt(ep.dub),
          description: it.description ?? "",
        };
      })
      .filter((it: AnizenSpotlightItem | null): it is AnizenSpotlightItem => it !== null);
  }

  // /api/home returns empty arrays for latestEpisode / recentlyAdded, and
  // /api/filter ignores the `sort` param (returns alphabetical results no
  // matter what). The only upstream endpoint that actually yields recent
  // airings is /api/schedule, so build the "recently updated" feed by
  // fetching the last N days of schedules. Each page = 7 days, newest first.
  private static formatDate(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  static async recentlyUpdated(page = 1): Promise<AnizenPagedResult<AnizenSearchItem>> {
    const p = page > 0 ? page : 1;
    const DAYS_PER_PAGE = 7;
    const startOffset = (p - 1) * DAYS_PER_PAGE;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const dates: string[] = [];
    for (let i = 0; i < DAYS_PER_PAGE; i++) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - (startOffset + i));
      dates.push(this.formatDate(d));
    }

    const lists = await Promise.all(
      dates.map(async (date) => {
        const raw = await this.getJson(`/api/schedule?date=${date}`);
        const arr = Array.isArray(raw?.results) ? raw.results : [];
        // Each day's airings: newest time first.
        arr.sort((a: any, b: any) => String(b?.time ?? "").localeCompare(String(a?.time ?? "")));
        return arr;
      }),
    );

    const seen = new Set<string>();
    const results: AnizenSearchItem[] = [];
    for (const items of lists) {
      for (const it of items) {
        if (!it?.id || seen.has(it.id)) continue;
        seen.add(it.id);
        const ep = this.toInt(it.episode_no);
        results.push({
          id: it.id,
          title: it.title ?? "",
          url: `${this.site}/details/${it.id}`,
          image: it.poster ?? undefined,
          japaneseTitle: it.jname ?? null,
          type: "",
          sub: ep,
          dub: 0,
          episodes: ep,
        });
      }
    }

    return {
      currentPage: results.length === 0 ? 0 : p,
      // Upstream gives no totals; assume more if this page filled normally.
      hasNextPage: results.length > 0,
      totalPages: 0,
      results,
    };
  }

  static recentlyAdded(page = 1) {
    return this.filterHtml("recently-added", page);
  }

  // ─── Genres list ────────────────────────────────────────────────────────────

  static async genres(): Promise<string[]> {
    const raw = await this.getHome();
    const arr = raw?.results?.genres ?? [];
    return Array.isArray(arr) ? arr.filter((g: any) => typeof g === "string") : [];
  }

  // ─── Schedule ───────────────────────────────────────────────────────────────

  static async schedule(date: string): Promise<AnizenScheduleItem[]> {
    if (!date) return [];
    const raw = await this.getJson(`/api/schedule?date=${encodeURIComponent(date)}`);
    const list = Array.isArray(raw?.results) ? raw.results : [];
    return list
      .map((it: any): AnizenScheduleItem | null => {
        if (!it?.id) return null;
        return {
          id: it.id,
          title: it.title ?? "",
          japaneseTitle: it.jname ?? null,
          airingTime: it.time ?? "",
          airingEpisode: String(it.episode_no ?? ""),
        };
      })
      .filter((it: AnizenScheduleItem | null): it is AnizenScheduleItem => it !== null);
  }

  // ─── Info ───────────────────────────────────────────────────────────────────

  static async info(id: string): Promise<AnizenInfo | null> {
    if (!id) return null;
    const slug = id.split("$")[0]!;
    const raw = await this.getJson(`/api/info?id=${encodeURIComponent(slug)}`);
    const data = raw?.results?.data;
    if (!data || !data.id) return null;
    // Upstream /api/info fuzzy-matches ids it doesn't know to a *different*
    // anime instead of 404ing (a not-yet-indexed spotlight slug comes back as
    // a random show). Only trust responses that echo the requested id.
    if (data.id !== slug) {
      Logger.warn(`Anizen info id mismatch: requested "${slug}", upstream returned "${data.id}"`);
      return null;
    }

    const animeInfo = data.animeInfo ?? {};
    const tv = animeInfo.tvInfo ?? {};
    const sub = this.toInt(tv.sub);
    const dub = this.toInt(tv.dub);

    const episodesArr = Array.isArray(data.episodes?.episodes) ? data.episodes.episodes : [];
    const episodes: AnizenEpisode[] = episodesArr.map((ep: any): AnizenEpisode => {
      const num = this.toInt(ep.episode_no);
      return {
        id: `${data.id}$ep=${num}$token=${ep.id ?? ""}`,
        number: num,
        title: ep.title ?? `Episode ${num}`,
        isFiller: !!ep.filler,
        isSubbed: !!ep.hasSub,
        isDubbed: !!ep.hasDub,
        url: `${this.site}/watch/${data.id}?ep=${num}`,
      };
    });

    const recRaw = Array.isArray(data.recommended_data)
      ? data.recommended_data
      : Array.isArray(raw?.results?.recommended_data)
        ? raw.results.recommended_data
        : [];
    const seenRec = new Set<string>();
    const recommendations: AnizenRelatedItem[] = [];
    for (const it of recRaw) {
      if (!it?.id || seenRec.has(it.id)) continue;
      seenRec.add(it.id);
      const card = this.mapCard(it);
      if (card) recommendations.push(card);
    }

    // Anizen's /api/info exposes `seasons`. Map them as relations with
    // relationType="season" so they fit animekai's relations slot.
    const seasonsRaw = Array.isArray(raw?.results?.seasons) ? raw.results.seasons : [];
    const relations: AnizenRelatedItem[] = seasonsRaw
      .filter((s: any) => s?.id && s.id !== data.id)
      .map(
        (s: any): AnizenRelatedItem => ({
          id: s.id,
          title: s.title ?? s.id,
          url: `${this.site}/details/${s.id}`,
          image: s.season_poster ?? undefined,
          japaneseTitle: null,
          type: "",
          sub: 0,
          dub: 0,
          episodes: 0,
          relationType: s.season ?? "",
        }),
      );

    return {
      id: data.id,
      title: data.title ?? "",
      japaneseTitle: data.jname ?? animeInfo.Japanese ?? null,
      image: data.poster ?? undefined,
      description: animeInfo.Overview ?? undefined,
      type: data.showType ?? tv.showType ?? undefined,
      url: `${this.site}/details/${data.id}`,
      totalEpisodes: this.toInt(data.episodes?.totalEpisodes) || episodes.length,
      status: animeInfo.Status ?? undefined,
      season: animeInfo.Premiered ?? undefined,
      duration: animeInfo.Duration ?? tv.duration ?? undefined,
      malId: data.malId != null ? String(data.malId) : undefined,
      anilistId: data.anilistId != null ? String(data.anilistId) : undefined,
      hasSub: sub > 0,
      hasDub: dub > 0,
      subOrDub: sub > 0 && dub > 0 ? "both" : dub > 0 ? "dub" : "sub",
      genres: Array.isArray(animeInfo.Genres) ? animeInfo.Genres : [],
      recommendations,
      relations,
      episodes,
    };
  }

  // ─── Stream / servers ───────────────────────────────────────────────────────

  // Episode IDs minted by info() look like: ${slug}$ep=${num}$token=${...}.
  // The upstream /api/stream endpoint just needs id=${slug}?ep=${num}&type=${sub|dub}.
  private static parseEpisodeId(episodeId: string): { slug: string; ep: string } | null {
    if (!episodeId) return null;
    const slug = episodeId.split("$")[0]!;
    const epMatch = /\$ep=([^$]+)/.exec(episodeId);
    const ep = epMatch ? epMatch[1]! : "1";
    if (!slug) return null;
    return { slug, ep };
  }

  // Upstream audio types. "hindi" (Abyss/Default/Mirror/VMoly) and "hsub"
  // (hardsubbed VidPlay) were added when anizen started carrying Hindi dubs.
  // Route-level "softsub"/"hardsub" keep their historical meaning (both map
  // to upstream "sub") so existing clients don't change behavior; the new
  // audio tracks are opt-in via type=hindi / type=hsub.
  private static normalizeType(type?: string): AnizenAudioType {
    if (type === "dub") return "dub";
    if (type === "hindi") return "hindi";
    if (type === "hsub") return "hsub";
    return "sub";
  }

  private static async fetchStream(
    slug: string,
    ep: string,
    type: AnizenAudioType,
  ): Promise<any | null> {
    // slug?ep=N must be passed unencoded for the upstream router to parse it.
    return this.getJson(`/api/stream?id=${slug}?ep=${ep}&type=${type}`);
  }

  // ─── Player resolver ───────────────────────────────────────────────────────
  // Upstream's streamingLink.file is a /player/<token> page on api.anizen.tr
  // that wraps an inner embed. Resolve it down to the actual m3u8:
  //   1. GET /player/<token>/resolve with X-Requested-With: ZenPlayer AND
  //      Chrome-shaped sec-ch-ua + Sec-Fetch-* headers — upstream now 403s
  //      ("unsupported_browser") without them.
  //        → { url: "<inner embed>", servers: [{ name, url }, ...] }
  //      `servers` is the full mirror map for the requested audio type; its
  //      names match /api/stream's serverName values, so one resolve call
  //      covers the whole server list.
  //   2. GET the inner page, scrape data-id="<fileId>" (megaplay-family hosts:
  //      megaplay.buzz / vidwish.live / vidtube.site)
  //   3. GET <inner host>/stream/getSources?id=<fileId>
  //        → { sources:{file:<m3u8>}, tracks:[...], intro, outro }
  // Hindi servers resolve to external hosts (ryzex.top, gdmirrorbot.nl,
  // vidmoly.net) with no data-id chain — those are surfaced as iframes of the
  // *inner* embed, which browsers can load directly (the api.anizen.tr wrapper
  // page is the one that shows "Video not loading? Set your DNS…").
  // The CDN that serves the m3u8 hard-checks the Referer of whichever mirror
  // produced it (every other referer gets 403), so clients MUST send the
  // returned referer.

  private static readonly PLAYER_MIRROR_HOSTS = ["megaplay.buzz", "vidwish.live", "vidtube.site"];

  private static isPlayerUrl(url: string): boolean {
    return /^https?:\/\/[^/]*(?:aniapi|cdn|api)\.anizen\.[a-z]+\/player\//i.test(url);
  }

  // Clients embed these URLs directly. anizen's resolver emits `?autoplay=true`,
  // but the megaplay-family players honour `?autostart=true` — the autoplay
  // form is what was coming back 410 in the app. Normalise every embed URL we
  // hand out so it matches the form the players actually accept.
  private static normalizeEmbedUrl(url: string): string {
    try {
      const u = new URL(url);
      if (u.searchParams.has("autoplay")) u.searchParams.delete("autoplay");
      u.searchParams.set("autostart", "true");
      return u.toString();
    } catch {
      return url;
    }
  }

  // Browser-shaped headers for /player/<token>/resolve. The gate checks for
  // Chromium client hints + Sec-Fetch metadata, not just the User-Agent.
  private static resolveHeaders(referer: string): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: referer,
      "X-Requested-With": "ZenPlayer",
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not A(Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    };
  }

  private static async resolvePlayer(playerUrl: string): Promise<{
    m3u8: string | null;
    referer: string | null;
    innerUrl: string;
    mirrors: { name: string; url: string }[];
    subtitles: { file: string; label?: string; kind?: string; default?: boolean }[];
    intro?: { start: number; end: number };
    outro?: { start: number; end: number };
  } | null> {
    try {
      // 1. /resolve → inner iframe URL + mirror list
      const resolveRes = await fetch(`${playerUrl}/resolve`, {
        headers: this.resolveHeaders(playerUrl),
      });
      if (!resolveRes.ok) return null;
      const resolveJson = (await resolveRes.json()) as {
        url?: string;
        servers?: { name?: string; url?: string }[];
      };
      const innerUrl = resolveJson?.url;
      if (!innerUrl) return null;

      const mirrors = (Array.isArray(resolveJson.servers) ? resolveJson.servers : []).filter(
        (s): s is { name: string; url: string } => !!s?.name && !!s?.url,
      );

      // 2+3 on the given host, its upstream-listed mirrors, then legacy
      // host-swaps (resolve sometimes hands out a dead mirror).
      const candidates = [innerUrl];
      for (const m of mirrors) {
        if (!candidates.includes(m.url)) candidates.push(m.url);
      }
      try {
        const u = new URL(innerUrl);
        if (this.PLAYER_MIRROR_HOSTS.includes(u.host)) {
          for (const host of this.PLAYER_MIRROR_HOSTS) {
            if (host === u.host) continue;
            const alt = new URL(innerUrl);
            alt.host = host;
            if (!candidates.includes(alt.toString())) candidates.push(alt.toString());
          }
        }
      } catch {
        /* not a parseable URL — try it as-is */
      }

      for (const candidate of candidates) {
        const resolved = await this.resolveInnerPlayer(candidate);
        if (resolved) return { ...resolved, innerUrl, mirrors };
      }
      // No candidate yielded an m3u8 (external hosts like ryzex/vidmoly).
      // Still return the inner embed + mirrors so callers can iframe them.
      return { m3u8: null, referer: null, innerUrl, mirrors, subtitles: [] };
    } catch (err) {
      Logger.error(`Anizen resolvePlayer error for ${playerUrl}: ${String(err)}`);
      return null;
    }
  }

  // Steps 2+3 of the chain against one mirror: scrape data-id off the inner
  // player page, then call that same host's getSources.
  private static async resolveInnerPlayer(innerUrl: string): Promise<{
    m3u8: string;
    referer: string;
    subtitles: { file: string; label?: string; kind?: string; default?: boolean }[];
    intro?: { start: number; end: number };
    outro?: { start: number; end: number };
  } | null> {
    try {
      const pageRes = await fetch(innerUrl, {
        headers: { "User-Agent": USER_AGENT, Referer: `${this.site}/` },
      });
      if (!pageRes.ok) return null;
      const pageHtml = await pageRes.text();
      const idMatch =
        /data-id\s*=\s*"(\d+)"/i.exec(pageHtml) ||
        /id="megaplay-player"[^>]*data-id\s*=\s*"(\d+)"/i.exec(pageHtml);
      const fileId = idMatch?.[1];
      if (!fileId) return null;

      const origin = new URL(innerUrl).origin;
      const srcRes = await fetch(`${origin}/stream/getSources?id=${fileId}`, {
        headers: {
          "User-Agent": USER_AGENT,
          Referer: innerUrl,
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      if (!srcRes.ok) return null;
      const data = (await srcRes.json()) as any;
      const file: string | undefined = data?.sources?.file;
      if (!file) return null;

      const tracks = Array.isArray(data.tracks) ? data.tracks : [];
      const subtitles = tracks
        .filter((tr: any) => tr?.kind !== "thumbnails" && typeof tr?.file === "string")
        .map((tr: any) => ({
          file: tr.file as string,
          label: typeof tr.label === "string" ? tr.label : undefined,
          kind: typeof tr.kind === "string" ? tr.kind : undefined,
          default: !!tr.default,
        }));

      const intro =
        data?.intro && typeof data.intro.start === "number"
          ? { start: this.toInt(data.intro.start), end: this.toInt(data.intro.end) }
          : undefined;
      const outro =
        data?.outro && typeof data.outro.start === "number"
          ? { start: this.toInt(data.outro.start), end: this.toInt(data.outro.end) }
          : undefined;

      return { m3u8: file, referer: `${origin}/`, subtitles, intro, outro };
    } catch {
      return null;
    }
  }

  // Upstream historically mixed every audio variant (hsub/ssub/dub) in one
  // `servers` list no matter which `type` was requested; newer responses come
  // pre-filtered but keep the filter as a safety net — a sub request must not
  // surface dub/hindi embeds under a sub label.
  private static serverMatchesType(s: any, t: AnizenAudioType): boolean {
    const st = String(s?.type ?? "").toLowerCase();
    if (!st) return true;
    if (t === "dub") return st === "dub";
    if (t === "hindi") return st === "hindi";
    if (t === "hsub") return st === "hsub";
    return st !== "dub" && st !== "hindi";
  }

  // Label by the stream's *actual* upstream type: "sub"/"ssub" carry VTT
  // tracks (softsub), "hsub" has subs burned into the video, "hindi" is the
  // Hindi audio track. Labeling everything "(HardSub)" made softsub streams
  // look like they lost their subtitles and hardsub ones look like subs were
  // missing entirely.
  private static typeSuffix(st: unknown, fallback: AnizenAudioType): string {
    const v = String(st ?? "").toLowerCase();
    if (v === "dub") return " (Dub)";
    if (v === "hindi") return " (Hindi)";
    if (v === "hsub") return " (HardSub)";
    if (v === "sub" || v === "ssub") return " (SoftSub)";
    if (fallback === "dub") return " (Dub)";
    if (fallback === "hindi") return " (Hindi)";
    return " (HardSub)";
  }

  static async fetchEpisodeServers(
    episodeId: string,
    subOrDub: AnizenTypeParam = "hardsub",
  ): Promise<AnizenServer[]> {
    const parsed = this.parseEpisodeId(episodeId);
    if (!parsed) return [];
    const type = this.normalizeType(subOrDub);
    const raw = await this.fetchStream(parsed.slug, parsed.ep, type);
    const servers = (Array.isArray(raw?.results?.servers) ? raw.results.servers : []).filter(
      (s: any) => this.serverMatchesType(s, type),
    );
    const link = raw?.results?.streamingLink;
    const intro = Array.isArray(link?.intro) ? link.intro : [0, 0];
    const outro = Array.isArray(link?.outro) ? link.outro : [0, 0];

    // Hand out the *inner* embed rather than the api.anizen.tr/player/<token>
    // wrapper — the wrapper is the page that renders "Video not loading? Set
    // your DNS to 1.1.1.1". One /resolve call returns the whole name→embed
    // mirror map for this audio type, the same way streams() does it.
    const mirrorByName = new Map<string, string>();
    const seed = link?.link?.file ?? servers.find((s: any) => s?.embed)?.embed;
    if (typeof seed === "string" && this.isPlayerUrl(seed)) {
      const resolved = await this.resolvePlayer(seed);
      for (const m of resolved?.mirrors ?? []) mirrorByName.set(m.name, m.url);
    }

    return servers
      .map((s: any): AnizenServer | null => {
        if (!s?.embed) return null;
        const baseName = s.serverName ?? s.server_name ?? "unknown";
        return {
          name: `anizen ${baseName}${this.typeSuffix(s.type, type)}`.toLowerCase(),
          url: this.normalizeEmbedUrl(mirrorByName.get(baseName) ?? s.embed),
          isDub: type === "dub",
          intro: { start: this.toInt(intro[0]), end: this.toInt(intro[1]) },
          outro: { start: this.toInt(outro[0]), end: this.toInt(outro[1]) },
        };
      })
      .filter((s: AnizenServer | null): s is AnizenServer => s !== null);
  }

  // Subtitle sidecars sit on CDNs that hard-check Referer — every one of them
  // (megaplay's 1oe.lostproject.club, vidtube's vidtub.mikora.top) returns 403
  // to a bare request and 200 with the player's Referer. Players inject that
  // header when fetching the *video* but not when fetching a .vtt track, so a
  // raw URL here means the stream plays with no subtitles at all. Route them
  // through /proxy/fetch so the server re-requests them with the right headers.
  private static mapSubtitles(
    tracks: any[],
    t: AnizenAudioType,
    headers?: Record<string, string>,
  ): { url?: string; lang?: string; type: string }[] {
    const canProxy = Boolean(SERVER_ORIGIN) && Boolean(headers);
    return tracks
      .filter((tr: any) => tr?.kind !== "thumbnails")
      .map((tr: any) => {
        const raw: string | undefined = tr.file ?? tr.url ?? undefined;
        return {
          url: raw && canProxy ? proxifyFetch(raw, headers) : raw,
          lang: tr.label ?? tr.kind ?? undefined,
          type: t === "dub" ? "none" : "soft",
        };
      });
  }

  // Reads the variant ladder off a master playlist so clients can offer a
  // quality picker or download a specific rendition. Costs one extra fetch per
  // HLS source, so it's only called on the single source we actually resolved.
  //
  // `proxify` mirrors whatever was done to the parent source: vidmoly's URLs
  // are ASN-bound, so its per-rendition playlists must go back through our own
  // proxy too — handing a client a raw variant URL would 403 exactly the way
  // the master would. The megaplay/vidtube ladders are plain signed URLs the
  // client can fetch itself given the right Referer.
  private static async qualitiesFor(
    rawMasterUrl: string,
    headers: Record<string, string>,
    proxify: boolean,
  ): Promise<AnizenQuality[]> {
    const variants = await fetchVariants(rawMasterUrl, headers);
    if (!proxify) return variants;
    return variants.map((v) => ({ ...v, file: proxifySource(v.file, headers) }));
  }

  // Vidmoly's master.m3u8 is signed AND bound to the network that resolved it
  // (its `asn=` param encodes the requester's ASN) — a URL minted here 403s
  // when the client plays it from a different network. Verified: a URL resolved
  // on one host returns 403 Forbidden when fetched from another. So unlike the
  // megaplay path (where the client just needs the right Referer), the Hindi
  // stream MUST go back out through our own m3u8 proxy, so the same server that
  // resolved the URL is the one fetching the playlist and segments. Subtitles
  // ride /proxy/fetch for the same reason.
  private static async buildVidmolySource(
    serverName: string,
    upstreamType: unknown,
    t: AnizenAudioType,
    iframeUrl: string,
    vm: { m3u8: string; referer: string; subtitles: { file: string; label?: string }[] },
  ): Promise<AnizenStreamSource> {
    const headers = { Referer: vm.referer, "User-Agent": USER_AGENT };
    // Without SERVER_ORIGIN (tests) there's no proxy to route through; fall
    // back to the raw URL rather than emitting an "undefined/proxy/…" link.
    const proxied = Boolean(SERVER_ORIGIN);
    const file = proxied ? proxifySource(vm.m3u8, headers) : vm.m3u8;
    const qualities = await this.qualitiesFor(vm.m3u8, headers, proxied);
    return {
      name: `Anizen ${serverName}${this.typeSuffix(upstreamType, t)}`,
      iframe: iframeUrl,
      sources: [{ file, type: "hls" }],
      ...(qualities.length > 0 ? { qualities } : {}),
      subtitles: this.mapSubtitles(vm.subtitles, t, headers),
      download: null,
      // Already proxied — the client needs no special headers of its own.
      ...(proxied ? {} : { headers }),
    };
  }

  static async streams(episodeId: string, type?: AnizenTypeParam): Promise<AnizenStreamResponse> {
    const parsed = this.parseEpisodeId(episodeId);
    if (!parsed) return { isDub: false, results: [] };
    const t = this.normalizeType(type);
    const raw = await this.fetchStream(parsed.slug, parsed.ep, t);
    const link = raw?.results?.streamingLink;
    const servers = (Array.isArray(raw?.results?.servers) ? raw.results.servers : []).filter(
      (s: any) => this.serverMatchesType(s, t),
    );

    const results: AnizenStreamSource[] = [];
    const seen = new Set<string>();

    let resolvedIntro: [number, number] | null = null;
    let resolvedOutro: [number, number] | null = null;
    let haveHls = false;
    // /resolve's `servers` maps serverName → inner embed URL for the whole
    // audio type, so one resolve call covers every server below. When the
    // primary resolve already walked all mirrors without finding an m3u8
    // (hindi's external hosts), don't burn another resolve per server.
    const mirrorByName = new Map<string, string>();
    let primaryResolveExhausted = false;

    // Upstream falls back to a sub stream instead of 404ing when a show has no
    // track for the requested type (e.g. type=hindi on a show without a Hindi
    // dub returns Japanese audio). The `servers` array is already type-filtered
    // above, but streamingLink is not — check it too, or a Hindi request
    // silently plays the wrong audio.
    const primaryMatchesType = this.serverMatchesType(link, t);
    if (link?.link?.file && !primaryMatchesType) {
      Logger.warn(
        `Anizen: upstream returned type "${link.type}" for a "${t}" request on ${parsed.slug} ep${parsed.ep} — dropping mismatched primary stream`,
      );
    }

    if (link?.link?.file && primaryMatchesType) {
      const name = `Anizen ${link.server ?? "primary"}${this.typeSuffix(link.type, t)}`;
      seen.add(link.server ?? "");
      const upstreamTracks = Array.isArray(link.tracks) ? link.tracks : [];
      // No player referer known at this point; these are only used on the
      // fallback paths where the chain never resolved.
      const upstreamSubs = this.mapSubtitles(upstreamTracks, t);

      const file = link.link.file as string;
      const isAlreadyHls = /\.m3u8(\?|$)/i.test(file);

      // If the upstream "file" is really a /player/ iframe, resolve the chain
      // and serve the real m3u8. Client (Android/ExoPlayer) injects Referer
      // directly — no server-side proxying needed.
      if (!isAlreadyHls && this.isPlayerUrl(file)) {
        const resolved = await this.resolvePlayer(file);
        if (resolved) {
          for (const m of resolved.mirrors) mirrorByName.set(m.name, m.url);
        }
        if (resolved?.m3u8) {
          const primaryHeaders = { Referer: resolved.referer!, "User-Agent": USER_AGENT };
          const resolvedSubs = this.mapSubtitles(resolved.subtitles, t, primaryHeaders);
          const subtitles =
            resolvedSubs.length > 0
              ? resolvedSubs
              : this.mapSubtitles(upstreamTracks, t, primaryHeaders);
          // megaplay/vidtube ladders are plain signed URLs — no proxying, the
          // client fetches them directly with the same Referer.
          const qualities = await this.qualitiesFor(resolved.m3u8, primaryHeaders, false);
          results.push({
            name,
            iframe: this.normalizeEmbedUrl(resolved.innerUrl || file),
            sources: [{ file: resolved.m3u8, type: "hls" }],
            ...(qualities.length > 0 ? { qualities } : {}),
            subtitles,
            download: null,
            headers: primaryHeaders,
          });
          if (resolved.intro) resolvedIntro = [resolved.intro.start, resolved.intro.end];
          if (resolved.outro) resolvedOutro = [resolved.outro.start, resolved.outro.end];
          haveHls = true;
        } else if (resolved) {
          primaryResolveExhausted = true;
          // Upstream currently makes Abyss the Hindi primary and VMoly a
          // secondary, so VMoly is normally handled in the servers loop below.
          // If that ordering ever flips, `seen` would skip it there and Hindi
          // would silently drop back to iframes — so extract here too.
          const vm = isVidmolyUrl(resolved.innerUrl)
            ? await getVidmolySource(resolved.innerUrl)
            : null;
          if (vm) {
            results.push(
              await this.buildVidmolySource(
                link.server ?? "VMoly",
                link.type,
                t,
                resolved.innerUrl,
                vm,
              ),
            );
            haveHls = true;
          } else {
            // Resolve worked but no mirror yields an m3u8 (hindi's external
            // hosts) — surface the *inner* embed, which browsers can load,
            // instead of the api.anizen.tr wrapper page.
            const innerUrl = this.normalizeEmbedUrl(resolved.innerUrl);
            results.push({
              name,
              iframe: innerUrl,
              sources: [{ file: innerUrl, type: "iframe" }],
              subtitles: upstreamSubs,
              download: null,
            });
          }
        } else {
          // Resolver failed (network/upstream change); surface the wrapper so
          // the client at least has something to render.
          results.push({
            name,
            iframe: file,
            sources: [{ file, type: "iframe" }],
            subtitles: upstreamSubs,
            download: null,
          });
        }
      } else {
        results.push({
          name,
          iframe: file,
          sources: [{ file, type: isAlreadyHls ? (link.link.type ?? "hls") : "iframe" }],
          subtitles: upstreamSubs,
          download: null,
        });
        haveHls = isAlreadyHls;
      }
    }

    for (const s of servers) {
      if (!s?.embed) continue;
      const sName = s.serverName ?? s.server_name ?? "unknown";
      if (seen.has(sName)) continue;
      seen.add(sName);

      // Prefer the mirror map's inner embed (directly loadable) over the
      // api.anizen.tr wrapper page.
      const iframeUrl = this.normalizeEmbedUrl(mirrorByName.get(sName) ?? s.embed);

      // Vidmoly (the "VMoly" Hindi mirror) inlines a real HLS source. This is
      // deliberately NOT gated on primaryResolveExhausted: that flag only means
      // the *anizen* player chain yielded no m3u8 for this audio type, which
      // says nothing about a third-party host. Hindi's primary (Abyss) always
      // sets it, so gating here would leave the one extractable Hindi server
      // stuck on an iframe.
      if (!haveHls && isVidmolyUrl(iframeUrl)) {
        const vm = await getVidmolySource(iframeUrl);
        if (vm) {
          results.unshift(await this.buildVidmolySource(sName, s.type, t, iframeUrl, vm));
          haveHls = true;
          continue;
        }
      }

      // The primary chain came up iframe-only; these embeds are /player/
      // pages on the same resolver, so try to turn one of them into a real
      // m3u8 before settling for iframes — unless the primary resolve already
      // proved this type's mirrors have none.
      if (!haveHls && !primaryResolveExhausted && this.isPlayerUrl(s.embed)) {
        const resolved = await this.resolvePlayer(s.embed);
        if (resolved) {
          for (const m of resolved.mirrors) mirrorByName.set(m.name, m.url);
        }
        if (resolved?.m3u8) {
          const secondaryHeaders = { Referer: resolved.referer!, "User-Agent": USER_AGENT };
          const qualities = await this.qualitiesFor(resolved.m3u8, secondaryHeaders, false);
          results.unshift({
            name: `Anizen ${sName}${this.typeSuffix(s.type, t)}`,
            iframe: this.normalizeEmbedUrl(resolved.innerUrl || s.embed),
            sources: [{ file: resolved.m3u8, type: "hls" }],
            ...(qualities.length > 0 ? { qualities } : {}),
            subtitles: this.mapSubtitles(resolved.subtitles, t, secondaryHeaders),
            download: null,
            headers: secondaryHeaders,
          });
          if (resolved.intro && !resolvedIntro)
            resolvedIntro = [resolved.intro.start, resolved.intro.end];
          if (resolved.outro && !resolvedOutro)
            resolvedOutro = [resolved.outro.start, resolved.outro.end];
          haveHls = true;
          continue;
        }
        if (resolved) primaryResolveExhausted = true;
      }

      results.push({
        name: `Anizen ${sName}${this.typeSuffix(s.type, t)}`,
        iframe: iframeUrl,
        sources: [{ file: iframeUrl, type: "iframe" }],
        subtitles: [],
        download: null,
      });
    }

    // Prefer the upstream's intro/outro when present; fall back to whatever
    // the megaplay resolver returned (often the only source of skip markers).
    const introArr = Array.isArray(link?.intro) ? link.intro : null;
    const outroArr = Array.isArray(link?.outro) ? link.outro : null;
    let intro: [number, number] | null = introArr
      ? [this.toInt(introArr[0]), this.toInt(introArr[1])]
      : resolvedIntro;
    let outro: [number, number] | null = outroArr
      ? [this.toInt(outroArr[0]), this.toInt(outroArr[1])]
      : resolvedOutro;

    // Hindi comes off a different host (vidmoly) that ships no skip markers.
    // Borrow the dub track's — measured across episodes, the Hindi encode
    // matches the dub runtime to within 0.1s (1470.1s vs 1470.0s) while the
    // sub encode runs ~11s longer, and that 11s is exactly the sub↔dub intro
    // offset (ep1 145 vs 134, ep2 241 vs 230). So Hindi shares the dub
    // timeline; borrowing from sub instead would fire every skip ~11s early.
    if (t === "hindi" && !intro && !outro && results.length > 0) {
      const borrowed = await this.borrowSkipTimes(parsed.slug, parsed.ep);
      if (borrowed) {
        intro = borrowed.intro;
        outro = borrowed.outro;
      }
    }

    return {
      isDub: t === "dub",
      results,
      ...(intro ? { intro } : {}),
      ...(outro ? { outro } : {}),
    };
  }

  // Pulls intro/outro off the dub stream so the Hindi track can reuse them
  // (see the call site for why dub and not sub). Note the markers do NOT come
  // from anizen's own API — /api/stream returns intro/outro: null for dub —
  // they come from the inner megaplay getSources payload, so this has to walk
  // the player chain rather than just read the JSON. Returns null when the
  // show has no dub or the chain yields no markers; callers go without.
  private static async borrowSkipTimes(
    slug: string,
    ep: string,
  ): Promise<{ intro: [number, number] | null; outro: [number, number] | null } | null> {
    const raw = await this.fetchStream(slug, ep, "dub");
    const link = raw?.results?.streamingLink;
    // Only trust markers that came back on an actual dub stream — upstream
    // falls back to sub when no dub exists, and those timings are offset.
    if (!this.serverMatchesType(link, "dub")) return null;

    const asPair = (v: unknown): [number, number] | null =>
      Array.isArray(v) ? [this.toInt(v[0]), this.toInt(v[1])] : null;

    let intro = asPair(link?.intro);
    let outro = asPair(link?.outro);

    if (!intro && !outro) {
      const file = link?.link?.file;
      if (typeof file === "string" && this.isPlayerUrl(file)) {
        const resolved = await this.resolvePlayer(file);
        if (resolved?.intro) intro = [resolved.intro.start, resolved.intro.end];
        if (resolved?.outro) outro = [resolved.outro.start, resolved.outro.end];
      }
    }

    // [0,0] is upstream's "unknown", not a real marker.
    const usable = (v: [number, number] | null) => (v && (v[0] > 0 || v[1] > 0) ? v : null);
    const i = usable(intro);
    const o = usable(outro);
    return i || o ? { intro: i, outro: o } : null;
  }
}
