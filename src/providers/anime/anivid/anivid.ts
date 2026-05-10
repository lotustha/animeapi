import { Logger } from "../../../core/logger.js";
import { anilist as anilistSite, anilist_graphql, jikan_api, vidnest } from "../../origins.js";
import { USER_AGENT } from "../animepahe/scraper/index.js";
import type {
  AnividEpisode,
  AnividInfo,
  AnividPagedResult,
  AnividRelatedItem,
  AnividScheduleItem,
  AnividSearchItem,
  AnividServer,
  AnividStreamResponse,
  AnividStreamSource,
  AnividSuggestionItem,
} from "./types.js";

// Metadata is sourced from AniList's public GraphQL API. Streaming is
// delegated to vidnest.fun (iframe-only, keyed on AniList ID).
//
// Episode IDs minted here are `${anilistId}$ep=${num}` so /watch and
// /servers can rebuild the vidnest URL with no extra round-trips.
//
// Response shapes mirror src/providers/anime/anizen/types.ts so /anime/anivid
// is drop-in compatible with /anime/anizen and /anime/animekai.
export class Anivid {
  private static api = anilist_graphql;
  private static site = anilistSite;
  private static embed = vidnest;
  private static jikan = jikan_api;
  private static PER_PAGE = 20;

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
        Logger.error(`Anivid gql ${res.status}: ${await res.text().catch(() => "")}`);
        return null;
      }
      const json: any = await res.json();
      if (json?.errors) {
        Logger.error(`Anivid gql errors: ${JSON.stringify(json.errors)}`);
      }
      return (json?.data as T) ?? null;
    } catch (err) {
      Logger.error(`Anivid gql error: ${String(err)}`);
      return null;
    }
  }

  // ─── Mappers ────────────────────────────────────────────────────────────────

  private static mapMedia(m: any): AnividSearchItem | null {
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

  private static mapPaged(page: any, fallbackPage: number): AnividPagedResult<AnividSearchItem> {
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
      .filter((x): x is AnividSearchItem => x !== null);
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
          ${Anivid.MEDIA_FIELDS}
        }
      }
    }
  `;

  private static async browse(
    variables: Record<string, any>,
    page: number,
  ): Promise<AnividPagedResult<AnividSearchItem>> {
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
  // AniList's `Page.media(search:)` is currently silently ignored — even inline
  // literal queries return id-ascending results regardless of the search term
  // (verified May 2026). We delegate the search itself to Jikan v4, then batch
  // re-hydrate the matched MAL IDs through AniList's `idMal_in` so the rest of
  // the pipeline (info/watch/servers, all keyed on AniList ID) keeps working.

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
      Logger.error(`Anivid jikan error: ${String(err)}`);
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
            ${Anivid.MEDIA_FIELDS}
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

  static async search(query: string, page = 1): Promise<AnividPagedResult<AnividSearchItem>> {
    if (!query) return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    const p = page > 0 ? page : 1;
    const { malIds, pagination, fallback } = await this.jikanSearch(query, p);
    if (malIds.length === 0) {
      return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    }
    const byMal = await this.enrichByMal(malIds);
    const results: AnividSearchItem[] = [];
    for (const mal of malIds) {
      const m = byMal.get(mal);
      if (m) {
        const card = this.mapMedia(m);
        if (card) results.push(card);
        continue;
      }
      // No AniList match — surface the Jikan record so the user still sees the
      // hit, but flag it with a `mal:` prefix so /info / /watch can resolve it
      // back through `Media(idMal:)`.
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

  static async suggestions(query: string): Promise<AnividSuggestionItem[]> {
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

  static async schedule(date: string): Promise<AnividScheduleItem[]> {
    if (!date) return [];
    // Interpret `date` as a UTC calendar day (YYYY-MM-DD).
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
      .map((it: any): AnividScheduleItem | null => {
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
      .filter((x): x is AnividScheduleItem => x !== null);
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

  private static buildEpisodes(anilistId: string, count: number): AnividEpisode[] {
    if (count <= 0) return [];
    const eps: AnividEpisode[] = [];
    for (let i = 1; i <= count; i++) {
      eps.push({
        id: `${anilistId}$ep=${i}`,
        number: i,
        title: `Episode ${i}`,
        isFiller: false,
        isSubbed: true,
        isDubbed: false,
        url: `${this.embed}/anime/${anilistId}/${i}/sub`,
      });
    }
    return eps;
  }

  static async info(id: string): Promise<AnividInfo | null> {
    if (!id) return null;
    const head = String(id).split("$")[0]!;
    // Allow `mal:12345` for items that came from a Jikan-only search hit.
    const malMatch = /^mal:(\d+)$/i.exec(head);
    const isMal = !!malMatch;
    const numId = isMal ? parseInt(malMatch![1]!, 10) : parseInt(head, 10);
    if (!Number.isFinite(numId) || numId <= 0) return null;

    const idArg = isMal ? "idMal" : "id";
    const query = `
      query ($id: Int) {
        Media(${idArg}: $id, type: ANIME) {
          ${Anivid.MEDIA_FIELDS}
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
    const episodes = this.buildEpisodes(aId, epCount);

    const seasonStr =
      media.season && media.seasonYear
        ? `${String(media.season).charAt(0) + String(media.season).slice(1).toLowerCase()} ${media.seasonYear}`
        : undefined;

    const duration = media.duration ? `${media.duration} min` : undefined;

    const relEdges: any[] = Array.isArray(media.relations?.edges) ? media.relations.edges : [];
    const seenRel = new Set<string>();
    const relations: AnividRelatedItem[] = [];
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
    const recommendations: AnividRelatedItem[] = [];
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
      url: `${this.site}/anime/${media.id}`,
      totalEpisodes: this.toInt(media.episodes) || epCount,
      status: media.status ?? undefined,
      season: seasonStr,
      duration,
      malId: media.idMal != null ? String(media.idMal) : undefined,
      anilistId: aId,
      hasSub: true,
      hasDub: false,
      subOrDub: "sub",
      genres: Array.isArray(media.genres) ? media.genres : [],
      recommendations,
      relations,
      episodes,
    };
  }

  // ─── Stream / servers ───────────────────────────────────────────────────────

  // Episode IDs from info() are `${anilistId}$ep=${num}`. /watch and /servers
  // accept that exact format; vidnest needs only anilistId + episode + sub|dub.
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

  private static normalizeType(type?: string): "sub" | "dub" {
    return type === "dub" ? "dub" : "sub";
  }

  private static iframeUrl(anilistId: string, ep: number, type: "sub" | "dub"): string {
    return `${this.embed}/anime/${anilistId}/${ep}/${type}`;
  }

  static async fetchEpisodeServers(
    episodeId: string,
    subOrDub: "softsub" | "dub" | "hardsub" = "hardsub",
  ): Promise<AnividServer[]> {
    const parsed = this.parseEpisodeId(episodeId);
    if (!parsed) return [];
    const t = this.normalizeType(subOrDub);
    const suffix = t === "dub" ? " (Dub)" : " (Sub)";
    return [
      {
        name: `anivid vidnest${suffix}`.toLowerCase(),
        url: this.iframeUrl(parsed.anilistId, parsed.ep, t),
        isDub: t === "dub",
        intro: { start: 0, end: 0 },
        outro: { start: 0, end: 0 },
      },
    ];
  }

  static async streams(
    episodeId: string,
    type?: "softsub" | "dub" | "hardsub",
  ): Promise<AnividStreamResponse> {
    const parsed = this.parseEpisodeId(episodeId);
    if (!parsed) return { isDub: false, results: [] };
    const t = this.normalizeType(type);
    const url = this.iframeUrl(parsed.anilistId, parsed.ep, t);
    const suffix = t === "dub" ? " (Dub)" : " (Sub)";
    const result: AnividStreamSource = {
      name: `Anivid VidNest${suffix}`,
      iframe: url,
      sources: [{ file: url, type: "iframe" }],
      subtitles: [],
      download: null,
    };
    return { isDub: t === "dub", results: [result] };
  }
}
