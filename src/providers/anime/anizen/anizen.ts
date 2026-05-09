import { Logger } from "../../../core/logger.js";
import { anizen as anizenOrigin, anizen_api as anizenApi } from "../../origins.js";
import { USER_AGENT } from "../animepahe/scraper/index.js";
import type {
  AnizenEpisode,
  AnizenInfo,
  AnizenPagedResult,
  AnizenScheduleItem,
  AnizenSearchItem,
  AnizenSeasonItem,
  AnizenServer,
  AnizenSpotlightItem,
  AnizenStreamResponse,
  AnizenStreamSource,
} from "./types.js";

// anizen.tr ships a clean JSON API at aniapi.anizen.tr — no scraping required.
// Endpoints: /api/home, /api/info?id=, /api/search?keyword=&page=, /api/stream?id=&type=,
// /api/schedule?date=, /api/filter?type=&genres=&page=, /api/random, /api/qtip/:id
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

  private static async getJson<T = any>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.api}${path}`, { headers: this.headers() });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch (err) {
      Logger.error(`Anizen getJson error for ${path}: ${String(err)}`);
      return null;
    }
  }

  // ─── Mappers ────────────────────────────────────────────────────────────────

  private static mapCard(item: any): AnizenSearchItem | null {
    if (!item || !item.id) return null;
    const tv = item.tvInfo ?? {};
    const subEps = this.toInt(tv.sub ?? tv.episodeInfo?.sub);
    const dubEps = this.toInt(tv.dub ?? tv.episodeInfo?.dub);
    return {
      id: item.id,
      dataId: item.data_id ?? null,
      title: item.title ?? "",
      japaneseTitle: item.jname ?? null,
      image: item.poster ?? null,
      url: `${this.site}/details/${item.id}`,
      type: tv.showType ?? item.showType ?? null,
      duration: tv.duration ?? item.duration ?? null,
      sub: subEps,
      dub: dubEps,
      episodes: Math.max(subEps, dubEps, this.toInt(tv.eps)),
    };
  }

  private static mapSpotlight(item: any, idx: number): AnizenSpotlightItem | null {
    if (!item || !item.id) return null;
    const tv = item.tvInfo ?? {};
    const ep = tv.episodeInfo ?? {};
    return {
      id: item.id,
      dataId: item.data_id ?? null,
      rank: idx + 1,
      title: item.title ?? "",
      japaneseTitle: item.jname ?? null,
      description: item.description ?? null,
      banner: item.poster ?? null,
      url: `${this.site}/details/${item.id}`,
      type: tv.showType ?? null,
      duration: tv.duration ?? null,
      releaseDate: tv.releaseDate ?? null,
      quality: tv.quality ?? null,
      sub: this.toInt(ep.sub),
      dub: this.toInt(ep.dub),
    };
  }

  private static mapPaged<T>(
    raw: any,
    page: number,
    mapper: (item: any) => T | null,
  ): AnizenPagedResult<T> {
    const data = raw?.results?.data ?? [];
    const list = Array.isArray(data) ? data : [];
    const totalPages =
      this.toInt(raw?.results?.totalPage) ||
      this.toInt(raw?.results?.totalPages) ||
      (list.length ? page : 0);
    const currentPage = list.length === 0 ? 0 : page;
    const hasNextPage =
      typeof raw?.results?.hasNextPage === "boolean"
        ? raw.results.hasNextPage
        : currentPage > 0 && currentPage < totalPages;
    const results = list
      .map((it) => mapper(it))
      .filter((it): it is T => it !== null);
    return {
      currentPage,
      hasNextPage,
      totalPages: results.length === 0 ? 0 : totalPages,
      results,
    };
  }

  // ─── Home (used by spotlight and several browse endpoints) ──────────────────

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
      .map((it: any, i: number) => this.mapSpotlight(it, i))
      .filter((it): it is AnizenSpotlightItem => it !== null);
  }

  // ─── Search ─────────────────────────────────────────────────────────────────

  static async search(query: string, page = 1): Promise<AnizenPagedResult<AnizenSearchItem>> {
    if (!query) return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    const p = page > 0 ? page : 1;
    const raw = await this.getJson(
      `/api/search?keyword=${encodeURIComponent(query)}&page=${p}`,
    );
    return this.mapPaged(raw, p, (it) => this.mapCard(it));
  }

  static async suggestions(query: string): Promise<AnizenSearchItem[]> {
    const out = await this.search(query, 1);
    return out.results.slice(0, 10);
  }

  // ─── Filter-backed browse endpoints ─────────────────────────────────────────

  private static async filter(
    params: Record<string, string | number>,
    page: number,
  ): Promise<AnizenPagedResult<AnizenSearchItem>> {
    const p = page > 0 ? page : 1;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    qs.set("page", String(p));
    const raw = await this.getJson(`/api/filter?${qs.toString()}`);
    return this.mapPaged(raw, p, (it) => this.mapCard(it));
  }

  static movies(page = 1) {
    return this.filter({ type: "movie" }, page);
  }
  static tv(page = 1) {
    return this.filter({ type: "tv" }, page);
  }
  static ova(page = 1) {
    return this.filter({ type: "ova" }, page);
  }
  static ona(page = 1) {
    return this.filter({ type: "ona" }, page);
  }
  static specials(page = 1) {
    return this.filter({ type: "special" }, page);
  }
  static newReleases(page = 1) {
    return this.filter({ sort: "recently_added" }, page);
  }
  static latestCompleted(page = 1) {
    return this.filter({ status: "Finished+Airing", sort: "recently_added" }, page);
  }
  static genreSearch(genre: string, page = 1) {
    if (!genre) return Promise.resolve({ currentPage: 0, hasNextPage: false, totalPages: 0, results: [] });
    return this.filter({ genres: genre }, page);
  }

  // ─── Home-derived browse endpoints (recent episodes / recent added) ─────────

  private static async homeSection(key: string, page: number): Promise<AnizenPagedResult<AnizenSearchItem>> {
    const raw = await this.getHome();
    const arr = raw?.results?.[key] ?? [];
    const list = Array.isArray(arr) ? arr : [];
    const results = list
      .map((it: any) => this.mapCard(it))
      .filter((it): it is AnizenSearchItem => it !== null);
    return {
      currentPage: results.length ? page : 0,
      hasNextPage: false,
      totalPages: results.length ? 1 : 0,
      results,
    };
  }

  static recentlyUpdated(page = 1) {
    return this.homeSection("latestEpisode", page);
  }
  static recentlyAdded(page = 1) {
    return this.homeSection("recentlyAdded", page);
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
          dataId: it.data_id ?? null,
          title: it.title ?? "",
          japaneseTitle: it.jname ?? null,
          airingTime: it.time ?? "",
          airingEpisode: String(it.episode_no ?? ""),
          releaseDate: it.releaseDate ?? null,
          poster: it.poster ?? null,
        };
      })
      .filter((it: AnizenScheduleItem | null): it is AnizenScheduleItem => it !== null);
  }

  // ─── Info ───────────────────────────────────────────────────────────────────

  static async info(id: string): Promise<AnizenInfo | null> {
    if (!id) return null;
    // Strip any episode suffix the caller may have included
    const slug = id.split("$")[0]!;
    const raw = await this.getJson(`/api/info?id=${encodeURIComponent(slug)}`);
    const data = raw?.results?.data;
    if (!data || !data.id) return null;

    const info = data.animeInfo ?? {};
    const tv = info.tvInfo ?? {};
    const sub = this.toInt(tv.sub ?? data.episode_sub_latest);
    const dub = this.toInt(tv.dub ?? data.episode_dub_latest);

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

    const recommendedRaw = Array.isArray(raw?.results?.recommended_data)
      ? raw.results.recommended_data
      : [];
    // Anizen returns duplicates in recommended_data — dedupe by id.
    const seenRec = new Set<string>();
    const recommendations: AnizenSearchItem[] = [];
    for (const it of recommendedRaw) {
      if (!it?.id || seenRec.has(it.id)) continue;
      seenRec.add(it.id);
      const card = this.mapCard(it);
      if (card) recommendations.push(card);
    }

    const seasonsRaw = Array.isArray(raw?.results?.seasons) ? raw.results.seasons : [];
    const seasons: AnizenSeasonItem[] = seasonsRaw.map((s: any) => ({
      id: s.id,
      dataId: s.data_id ?? null,
      number: typeof s.data_number === "number" ? s.data_number : null,
      season: s.season ?? "",
      title: s.title ?? s.id ?? "",
      poster: s.season_poster ?? null,
    }));

    return {
      id: data.id,
      dataId: data.data_id ?? null,
      malId: data.malId != null ? String(data.malId) : null,
      anilistId: data.anilistId != null ? String(data.anilistId) : null,
      title: data.title ?? "",
      japaneseTitle: data.jname ?? info.Japanese ?? null,
      synonyms: data.synonyms ?? info.Synonyms ?? null,
      image: data.poster ?? null,
      description: info.Overview ?? null,
      type: data.showType ?? tv.showType ?? null,
      url: `${this.site}/details/${data.id}`,
      status: info.Status ?? null,
      season: info.Premiered ?? null,
      duration: info.Duration ?? tv.duration ?? null,
      quality: tv.quality ?? null,
      rating: tv.rating ?? null,
      airedDate: info.Aired ?? null,
      totalEpisodes: this.toInt(data.episodes?.totalEpisodes) || episodes.length,
      sub,
      dub,
      hasSub: sub > 0,
      hasDub: dub > 0,
      subOrDub: sub > 0 && dub > 0 ? "both" : dub > 0 ? "dub" : "sub",
      genres: Array.isArray(info.Genres) ? info.Genres : [],
      studios: Array.isArray(info.Studios) ? info.Studios : [],
      producers: Array.isArray(info.Producers) ? info.Producers : [],
      recommendations,
      seasons,
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

  private static normalizeType(type?: string): "sub" | "dub" {
    return type === "dub" ? "dub" : "sub";
  }

  private static async fetchStream(slug: string, ep: string, type: "sub" | "dub"): Promise<any | null> {
    // slug?ep=N must be passed unencoded for the server to parse it correctly.
    return this.getJson(`/api/stream?id=${slug}?ep=${ep}&type=${type}`);
  }

  static async fetchEpisodeServers(
    episodeId: string,
    subOrDub: "softsub" | "dub" | "hardsub" = "hardsub",
  ): Promise<AnizenServer[]> {
    const parsed = this.parseEpisodeId(episodeId);
    if (!parsed) return [];
    const type = this.normalizeType(subOrDub);
    const raw = await this.fetchStream(parsed.slug, parsed.ep, type);
    const servers = Array.isArray(raw?.results?.servers) ? raw.results.servers : [];
    return servers
      .map((s: any): AnizenServer | null => {
        if (!s?.embed) return null;
        return {
          name: s.serverName ?? s.server_name ?? "unknown",
          url: s.embed,
          isDub: type === "dub",
          type,
        };
      })
      .filter((s: AnizenServer | null): s is AnizenServer => s !== null);
  }

  static async streams(
    episodeId: string,
    type?: "softsub" | "dub" | "hardsub",
  ): Promise<AnizenStreamResponse> {
    const parsed = this.parseEpisodeId(episodeId);
    if (!parsed) return { isDub: false, results: [] };
    const t = this.normalizeType(type);
    const raw = await this.fetchStream(parsed.slug, parsed.ep, t);
    const link = raw?.results?.streamingLink;
    const servers = Array.isArray(raw?.results?.servers) ? raw.results.servers : [];

    const results: AnizenStreamSource[] = [];
    if (link?.link?.file) {
      results.push({
        name: link.server ?? "primary",
        iframe: link.link.file,
        file: link.link.file,
        type: link.link.type ?? null,
        isDub: t === "dub",
      });
    }
    for (const s of servers) {
      if (!s?.embed) continue;
      // Skip the primary server when it duplicates the streamingLink entry
      if (link?.server && s.serverName === link.server && results.length === 1) continue;
      results.push({
        name: s.serverName ?? s.server_name ?? "unknown",
        iframe: s.embed,
        file: null,
        type: null,
        isDub: t === "dub",
      });
    }

    const intro = link?.intro ?? null;
    const outro = link?.outro ?? null;
    return {
      isDub: t === "dub",
      results,
      ...(intro ? { intro } : {}),
      ...(outro ? { outro } : {}),
    };
  }
}
