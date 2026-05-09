import { Logger } from "../../../core/logger.js";
import { anizen as anizenOrigin, anizen_api as anizenApi } from "../../origins.js";
import { USER_AGENT } from "../animepahe/scraper/index.js";
import type {
  AnizenEpisode,
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

  private static mapPaged(
    raw: any,
    page: number,
  ): AnizenPagedResult<AnizenSearchItem> {
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
      .map((it) => this.mapCard(it))
      .filter((it): it is AnizenSearchItem => it !== null);
    return {
      currentPage,
      hasNextPage,
      totalPages: results.length === 0 ? 0 : totalPages,
      results,
    };
  }

  // ─── Search ─────────────────────────────────────────────────────────────────

  static async search(query: string, page = 1): Promise<AnizenPagedResult<AnizenSearchItem>> {
    if (!query) return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    const p = page > 0 ? page : 1;
    const raw = await this.getJson(
      `/api/search?keyword=${encodeURIComponent(query)}&page=${p}`,
    );
    return this.mapPaged(raw, p);
  }

  static async suggestions(query: string): Promise<AnizenSuggestionItem[]> {
    if (!query) return [];
    const out = await this.search(query, 1);
    // Animekai's suggestion shape adds `year` (and is otherwise card-shaped).
    // Anizen search items don't expose year separately, so we leave it null.
    return out.results.slice(0, 10).map((r) => ({ ...r, year: null }));
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
    return this.mapPaged(raw, p);
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
    return this.filter({ status: "Currently Airing", sort: "new" }, page);
  }
  static latestCompleted(page = 1) {
    return this.filter({ status: "Finished Airing" }, page);
  }
  static genreSearch(genre: string, page = 1) {
    if (!genre) return Promise.resolve({ currentPage: 0, hasNextPage: false, totalPages: 0, results: [] });
    return this.filter({ genres: genre }, page);
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

  // /api/home returns empty arrays for latestEpisode / recentlyAdded; fall back
  // to /api/filter sorted appropriately so these endpoints actually return data.
  static recentlyUpdated(page = 1) {
    return this.filter({ sort: "recently_updated" }, page);
  }
  static recentlyAdded(page = 1) {
    return this.filter({ sort: "new" }, page);
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
      .map((s: any): AnizenRelatedItem => ({
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
      }));

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

  private static normalizeType(type?: string): "sub" | "dub" {
    return type === "dub" ? "dub" : "sub";
  }

  private static async fetchStream(slug: string, ep: string, type: "sub" | "dub"): Promise<any | null> {
    // slug?ep=N must be passed unencoded for the upstream router to parse it.
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
    const link = raw?.results?.streamingLink;
    const intro = Array.isArray(link?.intro) ? link.intro : [0, 0];
    const outro = Array.isArray(link?.outro) ? link.outro : [0, 0];
    const suffix = type === "dub" ? " (Dub)" : " (HardSub)";
    return servers
      .map((s: any): AnizenServer | null => {
        if (!s?.embed) return null;
        const baseName = s.serverName ?? s.server_name ?? "unknown";
        return {
          name: `anizen ${baseName}${suffix}`.toLowerCase(),
          url: s.embed,
          isDub: type === "dub",
          intro: { start: this.toInt(intro[0]), end: this.toInt(intro[1]) },
          outro: { start: this.toInt(outro[0]), end: this.toInt(outro[1]) },
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

    const suffix = t === "dub" ? " (Dub)" : " (HardSub)";
    const results: AnizenStreamSource[] = [];
    const seen = new Set<string>();

    if (link?.link?.file) {
      const name = `Anizen ${link.server ?? "primary"}${suffix}`;
      seen.add(link.server ?? "");
      const tracks = Array.isArray(link.tracks) ? link.tracks : [];
      const subtitles = tracks
        .filter((tr: any) => tr?.kind !== "thumbnails")
        .map((tr: any) => ({
          url: tr.file ?? tr.url ?? undefined,
          lang: tr.label ?? tr.kind ?? undefined,
          type: t === "dub" ? "none" : "soft",
        }));
      results.push({
        name,
        iframe: link.link.file,
        sources: [{ file: link.link.file, type: link.link.type ?? "hls" }],
        subtitles,
        download: null,
      });
    }

    for (const s of servers) {
      if (!s?.embed) continue;
      const sName = s.serverName ?? s.server_name ?? "unknown";
      if (seen.has(sName)) continue;
      seen.add(sName);
      results.push({
        name: `Anizen ${sName}${suffix}`,
        iframe: s.embed,
        sources: [{ file: s.embed, type: "iframe" }],
        subtitles: [],
        download: null,
      });
    }

    const introArr = Array.isArray(link?.intro) ? link.intro : null;
    const outroArr = Array.isArray(link?.outro) ? link.outro : null;
    return {
      isDub: t === "dub",
      results,
      ...(introArr ? { intro: [this.toInt(introArr[0]), this.toInt(introArr[1])] as [number, number] } : {}),
      ...(outroArr ? { outro: [this.toInt(outroArr[0]), this.toInt(outroArr[1])] as [number, number] } : {}),
    };
  }
}
