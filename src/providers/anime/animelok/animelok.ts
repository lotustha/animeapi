import { Logger } from "../../../core/logger.js";
import { proxifySource } from "../../../core/proxy.js";
import {
  anilist as anilistSite,
  anilist_graphql,
  jikan_api,
  animelok as animelokSite,
} from "../../origins.js";
import { USER_AGENT } from "../animepahe/scraper/index.js";
import { buildFullSlug } from "./scraper/slug.js";
import { scrapeStreamAllLangs, type AllLangsResult } from "./scraper/stream.js";
import type {
  AnimelokEpisode,
  AnimelokInfo,
  AnimelokPagedResult,
  AnimelokRelatedItem,
  AnimelokScheduleItem,
  AnimelokSearchItem,
  AnimelokServer,
  AnimelokStreamResponse,
  AnimelokStreamSource,
  AnimelokSuggestionItem,
} from "./types.js";

// Metadata is sourced from AniList's public GraphQL API (animelok.online is
// itself AniList-keyed). Streaming is delegated to animelok.online's private
// API, reached via a cookie-warming flow (see ./scraper). animelok serves SIX
// audio languages — Japanese, English, Hindi, Tamil, Telugu, Malayalam — so
// /watch and /servers expose true multi-audio, going beyond animekai's
// sub/dub-only `type` param.
//
// Episode IDs minted here are `${anilistId}$ep=${num}`. /watch and /servers
// resolve the animelok slug server-side from the AniList English title (with
// romaji/native fallback), so clients never need to pass a title.
//
// Response shapes mirror src/providers/anime/anivid/types.ts so /anime/animelok
// is drop-in compatible with /anime/anivid and /anime/animekai.
export class Animelok {
  private static api = anilist_graphql;
  private static site = anilistSite;
  private static embed = animelokSite;
  private static jikan = jikan_api;
  private static PER_PAGE = 20;

  // Capability list — what animelok can serve. Real per-episode languages are
  // confirmed at /watch and /servers.
  private static SUPPORTED_AUDIO = ["japanese", "english", "hindi", "tamil", "telugu", "malayalam"];

  // anilistId → the AniList title that produced a non-empty animelok slug.
  // Memoised because the slug is series-level (stable across episodes).
  private static workingTitle = new Map<string, string>();

  // Referer each direct-stream CDN hard-checks. `pahe` (uwucdn/owocdn — the same
  // kwik storage animepahe uses) returns 403 without Referer: https://kwik.cx/
  // (verified). Servers absent here ship the raw file with no proxy/headers.
  private static SERVER_REFERER: Record<string, string> = {
    pahe: "https://kwik.cx/",
  };

  private static refererFor(server: string): string | undefined {
    return this.SERVER_REFERER[server.toLowerCase()];
  }

  private static headers(): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private static toInt(v: unknown): number {
    if (v === null || v === undefined || v === "") return 0;
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : 0;
  }

  private static stripHtml(html: unknown): string {
    if (typeof html !== "string") return "";
    return html
      .replace(/<br\s*\/?>(\s*)/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .trim();
  }

  private static pickTitle(t: any): { title: string; jp: string | null } {
    const title = t?.english || t?.romaji || t?.native || "";
    const jp = t?.native || null;
    return { title, jp };
  }

  private static async gql<T = any>(
    query: string,
    variables: Record<string, any>,
  ): Promise<T | null> {
    try {
      const res = await fetch(this.api, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) {
        Logger.error(`Animelok gql ${res.status}: ${await res.text().catch(() => "")}`);
        return null;
      }
      const json: any = await res.json();
      if (json?.errors) {
        Logger.error(`Animelok gql errors: ${JSON.stringify(json.errors)}`);
      }
      return (json?.data as T) ?? null;
    } catch (err) {
      Logger.error(`Animelok gql error: ${String(err)}`);
      return null;
    }
  }

  // ─── Mappers ────────────────────────────────────────────────────────────────

  private static mapMedia(m: any): AnimelokSearchItem | null {
    if (!m?.id) return null;
    const { title, jp } = this.pickTitle(m.title);
    const aired = this.toInt(m.nextAiringEpisode?.episode) - 1;
    const total = this.toInt(m.episodes) || (aired > 0 ? aired : 0);
    return {
      id: String(m.id),
      title,
      url: `${this.site}/anime/${m.id}`,
      image: m.coverImage?.extraLarge || m.coverImage?.large || undefined,
      japaneseTitle: jp,
      type: m.format ?? "",
      sub: total,
      dub: 0,
      episodes: total,
    };
  }

  private static mapPaged(
    page: any,
    fallbackPage: number,
  ): AnimelokPagedResult<AnimelokSearchItem> {
    const list: any[] = Array.isArray(page?.media) ? page.media : [];
    const info = page?.pageInfo ?? {};
    const totalPages = this.toInt(info.lastPage) || (list.length ? fallbackPage : 0);
    const currentPage = this.toInt(info.currentPage) || (list.length ? fallbackPage : 0);
    const hasNextPage =
      typeof info.hasNextPage === "boolean"
        ? info.hasNextPage
        : currentPage > 0 && currentPage < totalPages;
    const results = list
      .map((m) => this.mapMedia(m))
      .filter((x): x is AnimelokSearchItem => x !== null);
    return {
      currentPage: results.length === 0 ? 0 : currentPage,
      hasNextPage,
      totalPages: results.length === 0 ? 0 : totalPages,
      results,
    };
  }

  // ─── Reusable GraphQL fragments ─────────────────────────────────────────────

  private static MEDIA_FIELDS = `
    id
    idMal
    title { romaji english native }
    format
    episodes
    duration
    status
    season
    seasonYear
    startDate { year month day }
    coverImage { large extraLarge }
    bannerImage
    averageScore
    genres
    nextAiringEpisode { episode airingAt }
  `;

  private static BROWSE_QUERY = `
    query (
      $page: Int, $perPage: Int,
      $sort: [MediaSort], $type: MediaType, $format: MediaFormat,
      $status_in: [MediaStatus], $season: MediaSeason, $seasonYear: Int,
      $genre_in: [String], $search: String
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage hasNextPage lastPage perPage }
        media(
          sort: $sort, type: $type, format: $format,
          status_in: $status_in, season: $season, seasonYear: $seasonYear,
          genre_in: $genre_in, search: $search, isAdult: false
        ) {
          ${Animelok.MEDIA_FIELDS}
        }
      }
    }
  `;

  private static async browse(
    variables: Record<string, any>,
    page: number,
  ): Promise<AnimelokPagedResult<AnimelokSearchItem>> {
    const p = page > 0 ? page : 1;
    const data = await this.gql<{ Page: any }>(this.BROWSE_QUERY, {
      page: p,
      perPage: this.PER_PAGE,
      type: "ANIME",
      ...variables,
    });
    if (!data?.Page) {
      return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    }
    return this.mapPaged(data.Page, p);
  }

  // ─── Search & Suggestions ───────────────────────────────────────────────────
  //
  // AniList's `Page.media(search:)` is currently silently ignored, so we
  // delegate search to Jikan v4, then batch re-hydrate the matched MAL IDs
  // through AniList's `idMal_in` (everything downstream is keyed on AniList ID).

  private static async jikanSearch(
    query: string,
    page: number,
  ): Promise<{
    malIds: number[];
    pagination: { lastPage: number; hasNext: boolean; current: number };
    fallback: Map<number, { title: string; image?: string; type?: string; episodes?: number }>;
  }> {
    try {
      const url = `${this.jikan}/anime?q=${encodeURIComponent(query)}&page=${page}&sfw=true`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok)
        return {
          malIds: [],
          pagination: { lastPage: 0, hasNext: false, current: 0 },
          fallback: new Map(),
        };
      const json: any = await res.json();
      const data: any[] = Array.isArray(json?.data) ? json.data : [];
      const seen = new Set<number>();
      const malIds: number[] = [];
      const fallback = new Map<
        number,
        { title: string; image?: string; type?: string; episodes?: number }
      >();
      for (const m of data) {
        const id = this.toInt(m?.mal_id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        malIds.push(id);
        fallback.set(id, {
          title: m?.title_english || m?.title || m?.title_japanese || "",
          image: m?.images?.webp?.large_image_url || m?.images?.jpg?.large_image_url || undefined,
          type: m?.type || undefined,
          episodes: this.toInt(m?.episodes),
        });
      }
      return {
        malIds,
        pagination: {
          lastPage: this.toInt(json?.pagination?.last_visible_page),
          hasNext: !!json?.pagination?.has_next_page,
          current: this.toInt(json?.pagination?.current_page) || page,
        },
        fallback,
      };
    } catch (err) {
      Logger.error(`Animelok jikan error: ${String(err)}`);
      return {
        malIds: [],
        pagination: { lastPage: 0, hasNext: false, current: 0 },
        fallback: new Map(),
      };
    }
  }

  private static async enrichByMal(malIds: number[]): Promise<Map<number, any>> {
    if (malIds.length === 0) return new Map();
    const data = await this.gql<{ Page: any }>(
      `query ($ids: [Int]) {
        Page(perPage: 50) {
          media(idMal_in: $ids, type: ANIME) {
            ${Animelok.MEDIA_FIELDS}
          }
        }
      }`,
      { ids: malIds },
    );
    const list: any[] = Array.isArray(data?.Page?.media) ? data.Page.media : [];
    const byMal = new Map<number, any>();
    for (const m of list) {
      const mal = this.toInt(m?.idMal);
      if (mal) byMal.set(mal, m);
    }
    return byMal;
  }

  static async search(query: string, page = 1): Promise<AnimelokPagedResult<AnimelokSearchItem>> {
    if (!query) return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    const p = page > 0 ? page : 1;
    const { malIds, pagination, fallback } = await this.jikanSearch(query, p);
    if (malIds.length === 0) {
      return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    }
    const byMal = await this.enrichByMal(malIds);
    const results: AnimelokSearchItem[] = [];
    for (const mal of malIds) {
      const m = byMal.get(mal);
      if (m) {
        const card = this.mapMedia(m);
        if (card) results.push(card);
        continue;
      }
      const fb = fallback.get(mal);
      if (!fb) continue;
      results.push({
        id: `mal:${mal}`,
        title: fb.title,
        url: `https://myanimelist.net/anime/${mal}`,
        image: fb.image,
        japaneseTitle: null,
        type: fb.type,
        sub: fb.episodes ?? 0,
        dub: 0,
        episodes: fb.episodes ?? 0,
      });
    }
    const total = pagination.lastPage || (results.length ? p : 0);
    return {
      currentPage: results.length === 0 ? 0 : pagination.current || p,
      hasNextPage: pagination.hasNext,
      totalPages: results.length === 0 ? 0 : total,
      results,
    };
  }

  static async suggestions(query: string): Promise<AnimelokSuggestionItem[]> {
    if (!query) return [];
    const out = await this.search(query, 1);
    return out.results.slice(0, 10).map((r) => ({ ...r, year: "" }));
  }

  // ─── Browse routes ──────────────────────────────────────────────────────────

  static trending(page = 1) {
    return this.browse({ sort: ["TRENDING_DESC", "POPULARITY_DESC"] }, page);
  }
  static popular(page = 1) {
    return this.browse({ sort: ["POPULARITY_DESC"] }, page);
  }
  static topRated(page = 1) {
    return this.browse({ sort: ["SCORE_DESC"] }, page);
  }
  static upcoming(page = 1) {
    return this.browse({ sort: ["POPULARITY_DESC"], status_in: ["NOT_YET_RELEASED"] }, page);
  }
  static seasonal(page = 1) {
    const { season, seasonYear } = this.currentSeason();
    return this.browse({ sort: ["POPULARITY_DESC"], season, seasonYear }, page);
  }
  static genreSearch(genre: string, page = 1) {
    if (!genre)
      return Promise.resolve({ currentPage: 0, hasNextPage: false, totalPages: 0, results: [] });
    return this.browse({ sort: ["POPULARITY_DESC"], genre_in: [genre] }, page);
  }

  static movies(page = 1) {
    return this.browse({ sort: ["POPULARITY_DESC"], format: "MOVIE" }, page);
  }
  static tv(page = 1) {
    return this.browse({ sort: ["POPULARITY_DESC"], format: "TV" }, page);
  }
  static ova(page = 1) {
    return this.browse({ sort: ["POPULARITY_DESC"], format: "OVA" }, page);
  }
  static ona(page = 1) {
    return this.browse({ sort: ["POPULARITY_DESC"], format: "ONA" }, page);
  }
  static specials(page = 1) {
    return this.browse({ sort: ["POPULARITY_DESC"], format: "SPECIAL" }, page);
  }
  static latestCompleted(page = 1) {
    return this.browse({ sort: ["END_DATE_DESC"], status_in: ["FINISHED"] }, page);
  }
  static newReleases(page = 1) {
    return this.browse({ sort: ["START_DATE_DESC"], status_in: ["RELEASING", "FINISHED"] }, page);
  }
  static recentlyAdded(page = 1) {
    return this.browse({ sort: ["ID_DESC"] }, page);
  }

  static async recentEpisodes(page = 1): Promise<AnimelokPagedResult<AnimelokSearchItem>> {
    const p = page > 0 ? page : 1;
    const now = Math.floor(Date.now() / 1000);
    const data = await this.gql<{ Page: any }>(
      `query ($page: Int, $perPage: Int, $now: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage hasNextPage lastPage perPage }
          airingSchedules(airingAt_lesser: $now, sort: TIME_DESC) {
            episode
            media { ${Animelok.MEDIA_FIELDS} isAdult }
          }
        }
      }`,
      { page: p, perPage: this.PER_PAGE, now },
    );
    const pageData = data?.Page;
    if (!pageData) return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    const scheds: any[] = Array.isArray(pageData.airingSchedules) ? pageData.airingSchedules : [];
    const info = pageData.pageInfo ?? {};

    const seen = new Set<string>();
    const results: AnimelokSearchItem[] = [];
    for (const s of scheds) {
      const m = s?.media;
      if (!m?.id || m.isAdult) continue;
      const key = String(m.id);
      if (seen.has(key)) continue;
      seen.add(key);
      const card = this.mapMedia(m);
      if (!card) continue;
      const epNum = this.toInt(s.episode);
      if (epNum > 0) {
        card.episodes = epNum;
        card.sub = epNum;
      }
      results.push(card);
    }

    const currentPage = this.toInt(info.currentPage) || (results.length ? p : 0);
    const totalPages = this.toInt(info.lastPage) || (results.length ? p : 0);
    const hasNextPage = typeof info.hasNextPage === "boolean" ? info.hasNextPage : false;
    return {
      currentPage: results.length === 0 ? 0 : currentPage,
      hasNextPage,
      totalPages: results.length === 0 ? 0 : totalPages,
      results,
    };
  }

  static async spotlight(): Promise<any[]> {
    const data = await this.gql<{ Page: any }>(
      `query {
        Page(perPage: 10) {
          media(sort: [TRENDING_DESC, POPULARITY_DESC], type: ANIME, isAdult: false) {
            id
            title { romaji english native }
            format
            genres
            averageScore
            season
            seasonYear
            startDate { year }
            bannerImage
            coverImage { large extraLarge }
            description(asHtml: false)
            episodes
            nextAiringEpisode { episode }
          }
        }
      }`,
      {},
    );
    const list: any[] = Array.isArray(data?.Page?.media) ? data.Page.media : [];
    return list
      .map((m) => {
        if (!m?.id) return null;
        const { title, jp } = this.pickTitle(m.title);
        const total =
          this.toInt(m.episodes) || Math.max(0, this.toInt(m.nextAiringEpisode?.episode) - 1);
        const releaseDate =
          m.season && m.seasonYear
            ? `${String(m.season).charAt(0) + String(m.season).slice(1).toLowerCase()} ${m.seasonYear}`
            : m.startDate?.year
              ? String(m.startDate.year)
              : "";
        return {
          id: String(m.id),
          title,
          japaneseTitle: jp,
          banner: m.bannerImage || m.coverImage?.extraLarge || null,
          image: m.coverImage?.extraLarge || m.coverImage?.large || undefined,
          url: `${this.site}/anime/${m.id}`,
          type: m.format ?? "",
          genres: Array.isArray(m.genres) ? m.genres : [],
          releaseDate,
          sub: total,
          dub: 0,
          description: this.stripHtml(m.description),
        };
      })
      .filter((x) => x !== null);
  }

  private static currentSeason(): { season: string; seasonYear: number } {
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const seasonYear = now.getUTCFullYear();
    let season: string;
    if (month <= 3) season = "WINTER";
    else if (month <= 6) season = "SPRING";
    else if (month <= 9) season = "SUMMER";
    else season = "FALL";
    return { season, seasonYear };
  }

  // ─── Genres ─────────────────────────────────────────────────────────────────

  static async genres(): Promise<string[]> {
    const data = await this.gql<{ GenreCollection: string[] }>(`{ GenreCollection }`, {});
    const arr = data?.GenreCollection ?? [];
    return Array.isArray(arr) ? arr.filter((g): g is string => typeof g === "string") : [];
  }

  // ─── Schedule ───────────────────────────────────────────────────────────────

  static async schedule(date: string): Promise<AnimelokScheduleItem[]> {
    if (!date) return [];
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m) return [];
    const start = Math.floor(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) / 1000);
    const end = start + 86400;

    const data = await this.gql<{ Page: any }>(
      `query ($start: Int, $end: Int) {
        Page(perPage: 100) {
          airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
            airingAt
            episode
            media { id title { romaji english native } }
          }
        }
      }`,
      { start, end },
    );
    const list: any[] = Array.isArray(data?.Page?.airingSchedules) ? data.Page.airingSchedules : [];
    return list
      .map((it: any): AnimelokScheduleItem | null => {
        if (!it?.media?.id) return null;
        const { title, jp } = this.pickTitle(it.media.title);
        const dt = new Date(this.toInt(it.airingAt) * 1000);
        const hh = String(dt.getUTCHours()).padStart(2, "0");
        const mm = String(dt.getUTCMinutes()).padStart(2, "0");
        return {
          id: String(it.media.id),
          title,
          japaneseTitle: jp,
          airingTime: `${hh}:${mm}`,
          airingEpisode: String(it.episode ?? ""),
        };
      })
      .filter((x): x is AnimelokScheduleItem => x !== null);
  }

  // ─── Info ───────────────────────────────────────────────────────────────────

  private static airedEpisodeCount(m: any): number {
    const total = this.toInt(m.episodes);
    const aired = this.toInt(m.nextAiringEpisode?.episode) - 1;
    if (total > 0 && aired > 0) return Math.min(total, aired);
    if (total > 0) return total;
    if (aired > 0) return aired;
    return 0;
  }

  private static buildEpisodes(anilistId: string, count: number, title: string): AnimelokEpisode[] {
    if (count <= 0) return [];
    const slug = buildFullSlug(title, anilistId);
    const eps: AnimelokEpisode[] = [];
    for (let i = 1; i <= count; i++) {
      eps.push({
        id: `${anilistId}$ep=${i}`,
        number: i,
        title: `Episode ${i}`,
        isFiller: false,
        isSubbed: true,
        isDubbed: true,
        url: `${this.embed}/anime/${slug}`,
      });
    }
    return eps;
  }

  static async info(id: string): Promise<AnimelokInfo | null> {
    if (!id) return null;
    const head = String(id).split("$")[0]!;
    const malMatch = /^mal:(\d+)$/i.exec(head);
    const isMal = !!malMatch;
    const numId = isMal ? parseInt(malMatch![1]!, 10) : parseInt(head, 10);
    if (!Number.isFinite(numId) || numId <= 0) return null;

    const idArg = isMal ? "idMal" : "id";
    const query = `
      query ($id: Int) {
        Media(${idArg}: $id, type: ANIME) {
          ${Animelok.MEDIA_FIELDS}
          description(asHtml: false)
          relations {
            edges {
              relationType
              node {
                id type format episodes
                title { romaji english native }
                coverImage { large extraLarge }
              }
            }
          }
          recommendations(perPage: 12, sort: RATING_DESC) {
            edges {
              node {
                mediaRecommendation {
                  id format episodes
                  title { romaji english native }
                  coverImage { large extraLarge }
                }
              }
            }
          }
        }
      }
    `;
    const data = await this.gql<{ Media: any }>(query, { id: numId });
    const media = data?.Media;
    if (!media?.id) return null;

    const aId = String(media.id);
    const { title, jp } = this.pickTitle(media.title);

    const epCount = this.airedEpisodeCount(media);
    const episodes = this.buildEpisodes(aId, epCount, title);

    const seasonStr =
      media.season && media.seasonYear
        ? `${String(media.season).charAt(0) + String(media.season).slice(1).toLowerCase()} ${media.seasonYear}`
        : undefined;

    const duration = media.duration ? `${media.duration} min` : undefined;

    const relEdges: any[] = Array.isArray(media.relations?.edges) ? media.relations.edges : [];
    const seenRel = new Set<string>();
    const relations: AnimelokRelatedItem[] = [];
    for (const e of relEdges) {
      const node = e?.node;
      if (!node?.id || node.type !== "ANIME") continue;
      const key = String(node.id);
      if (key === aId || seenRel.has(key)) continue;
      seenRel.add(key);
      const { title: rt, jp: rjp } = this.pickTitle(node.title);
      const eps = this.toInt(node.episodes);
      relations.push({
        id: key,
        title: rt,
        url: `${this.site}/anime/${node.id}`,
        image: node.coverImage?.extraLarge || node.coverImage?.large || undefined,
        japaneseTitle: rjp,
        type: node.format ?? "",
        sub: eps,
        dub: 0,
        episodes: eps,
        relationType: e.relationType ?? "",
      });
    }

    const recEdges: any[] = Array.isArray(media.recommendations?.edges)
      ? media.recommendations.edges
      : [];
    const seenRec = new Set<string>();
    const recommendations: AnimelokRelatedItem[] = [];
    for (const e of recEdges) {
      const node = e?.node?.mediaRecommendation;
      if (!node?.id) continue;
      const key = String(node.id);
      if (seenRec.has(key)) continue;
      seenRec.add(key);
      const { title: rt, jp: rjp } = this.pickTitle(node.title);
      const eps = this.toInt(node.episodes);
      recommendations.push({
        id: key,
        title: rt,
        url: `${this.site}/anime/${node.id}`,
        image: node.coverImage?.extraLarge || node.coverImage?.large || undefined,
        japaneseTitle: rjp,
        type: node.format ?? "",
        sub: eps,
        dub: 0,
        episodes: eps,
      });
    }

    return {
      id: aId,
      title,
      japaneseTitle: jp,
      image: media.coverImage?.extraLarge || media.coverImage?.large || undefined,
      cover: media.bannerImage ?? null,
      description: this.stripHtml(media.description) || undefined,
      type: media.format ?? undefined,
      url: `${this.embed}/anime/${buildFullSlug(title, aId)}`,
      totalEpisodes: this.toInt(media.episodes) || epCount,
      status: media.status ?? undefined,
      season: seasonStr,
      duration,
      malId: media.idMal != null ? String(media.idMal) : undefined,
      anilistId: aId,
      hasSub: true,
      hasDub: true,
      subOrDub: "both",
      audioLanguages: [...this.SUPPORTED_AUDIO],
      genres: Array.isArray(media.genres) ? media.genres : [],
      recommendations,
      relations,
      episodes,
    };
  }

  // ─── Stream / servers ───────────────────────────────────────────────────────

  private static parseEpisodeId(episodeId: string): { anilistId: string; ep: number } | null {
    if (!episodeId) return null;
    const slug = episodeId.split("$")[0]!;
    const id = parseInt(slug, 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    const epMatch = /\$ep=([^$]+)/.exec(episodeId);
    const ep = epMatch ? parseInt(epMatch[1]!, 10) : 1;
    if (!Number.isFinite(ep) || ep <= 0) return null;
    return { anilistId: String(id), ep };
  }

  // Map the public `type` param onto an animelok audio language. animekai-style
  // sub/dub aliases collapse to Japanese/English; the Indian languages pass
  // through directly.
  private static langForType(type?: string): string {
    switch ((type || "").toLowerCase()) {
      case "dub":
      case "english":
        return "ENGLISH";
      case "hindi":
        return "HINDI";
      case "tamil":
        return "TAMIL";
      case "telugu":
        return "TELUGU";
      case "malayalam":
        return "MALAYALAM";
      default:
        return "JAPANESE"; // sub / softsub / hardsub / japanese
    }
  }

  private static titleCase(lang: string): string {
    return lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase();
  }

  // animelok's episode player page: /watch/{slug}-{anilistId}-{ep}. Requires the
  // slug resolved by resolveStreams() (memoised in workingTitle); returns "" if
  // unknown so callers can fall back.
  private static watchUrl(anilistId: string, ep: number): string {
    const title = this.workingTitle.get(anilistId);
    if (!title) return "";
    return `${this.embed}/watch/${buildFullSlug(title, anilistId)}-${ep}`;
  }

  // Candidate AniList titles, English-first (verified canonical for animelok's
  // slug), then romaji, then native.
  private static async titleCandidates(anilistId: string): Promise<string[]> {
    const data = await this.gql<{ Media: any }>(
      `query ($id: Int) { Media(id: $id, type: ANIME) { title { english romaji native } } }`,
      { id: this.toInt(anilistId) },
    );
    const t = data?.Media?.title;
    const cands = [t?.english, t?.romaji, t?.native].filter(
      (x): x is string => typeof x === "string" && x.trim() !== "",
    );
    return Array.from(new Set(cands));
  }

  // Resolve the animelok stream payload (all languages) for an episode, deriving
  // the slug from AniList titles. Memoises the title that worked.
  private static async resolveStreams(
    anilistId: string,
    ep: number,
  ): Promise<AllLangsResult | null> {
    const cached = this.workingTitle.get(anilistId);
    const candidates = cached ? [cached] : await this.titleCandidates(anilistId);

    for (const title of candidates) {
      try {
        const res = await scrapeStreamAllLangs(anilistId, ep, title);
        if (res.languages.length > 0) {
          this.workingTitle.set(anilistId, title);
          return res;
        }
      } catch (err) {
        Logger.warn(`Animelok stream resolve (${title}) failed: ${String(err)}`);
      }
    }

    // A memoised title that suddenly yields nothing is stale — drop it and
    // re-derive from the full candidate list once.
    if (cached) {
      this.workingTitle.delete(anilistId);
      return this.resolveStreams(anilistId, ep);
    }
    return null;
  }

  static async streams(episodeId: string, type?: string): Promise<AnimelokStreamResponse> {
    const parsed = this.parseEpisodeId(episodeId);
    if (!parsed) return { isDub: false, results: [] };

    const lang = this.langForType(type);
    const isDub = lang !== "JAPANESE";
    const payload = await this.resolveStreams(parsed.anilistId, parsed.ep);
    if (!payload) return { isDub, results: [], languages: [] };

    const languages = payload.languages.map((l) => l.toLowerCase());
    const track = payload.tracks[lang];
    if (!track) return { isDub, results: [], languages };

    const langLower = lang.toLowerCase();
    const display = this.titleCase(lang);
    // animelok's own SPA player page for this episode — used as the iframe for
    // direct-HLS results (which carry no embed of their own) so the field is
    // always populated. Falls back to the first embed if the slug is unknown.
    const watchPage = this.watchUrl(parsed.anilistId, parsed.ep);
    const directIframe = watchPage || track.embeds[0]?.url || "";
    const subtitles = payload.subtitles.map((s) => ({
      url: s.url,
      lang: s.lang ?? "English",
      type: "soft",
    }));
    const results: AnimelokStreamSource[] = [];

    for (const g of track.servers) {
      // The CDN hard-checks Referer (pahe → kwik.cx). `file` is the raw m3u8 the
      // client plays directly with headers.Referer; `proxy` injects that Referer
      // server-side so a header-less client still works.
      const referer = this.refererFor(g.server);
      results.push({
        name: `Animelok ${g.server} (${display})`,
        iframe: directIframe,
        sources: g.streams.map((s) => {
          const isMp4 = s.url.toLowerCase().includes(".mp4");
          return {
            file: s.url,
            type: isMp4 ? "mp4" : "hls",
            quality: s.quality,
            ...(referer && !isMp4 ? { proxy: proxifySource(s.url, { Referer: referer }) } : {}),
          };
        }),
        subtitles,
        download: null,
        lang: langLower,
        ...(referer ? { headers: { Referer: referer } } : {}),
      });
    }

    for (const e of track.embeds) {
      results.push({
        name: `Animelok ${e.server} (${display})`,
        iframe: e.url,
        sources: [{ file: e.url, type: "iframe" }],
        subtitles,
        download: null,
        lang: langLower,
      });
    }

    return {
      isDub,
      results,
      languages,
      ...(payload.intro ? { intro: payload.intro } : {}),
      ...(payload.outro ? { outro: payload.outro } : {}),
    };
  }

  static async fetchEpisodeServers(episodeId: string, _type?: string): Promise<AnimelokServer[]> {
    const parsed = this.parseEpisodeId(episodeId);
    if (!parsed) return [];

    const payload = await this.resolveStreams(parsed.anilistId, parsed.ep);
    if (!payload) return [];

    const servers: AnimelokServer[] = [];
    const seenUrl = new Set<string>();
    for (const langUpper of payload.languages) {
      const track = payload.tracks[langUpper];
      if (!track) continue;
      const langLower = langUpper.toLowerCase();
      const display = this.titleCase(langUpper);
      const isDub = langUpper !== "JAPANESE";

      for (const g of track.servers) {
        const url = g.streams[0]?.url;
        if (!url || seenUrl.has(url)) continue;
        seenUrl.add(url);
        const referer = this.refererFor(g.server);
        servers.push({
          name: `animelok ${g.server} (${display})`.toLowerCase(),
          url,
          isDub,
          lang: langLower,
          intro: { start: payload.intro?.[0] ?? 0, end: payload.intro?.[1] ?? 0 },
          outro: { start: payload.outro?.[0] ?? 0, end: payload.outro?.[1] ?? 0 },
          ...(referer ? { headers: { Referer: referer } } : {}),
        });
      }
      for (const e of track.embeds) {
        if (!e.url || seenUrl.has(e.url)) continue;
        seenUrl.add(e.url);
        servers.push({
          name: `animelok ${e.server} (${display})`.toLowerCase(),
          url: e.url,
          isDub,
          lang: langLower,
          intro: { start: 0, end: 0 },
          outro: { start: 0, end: 0 },
        });
      }
    }
    return servers;
  }
}
