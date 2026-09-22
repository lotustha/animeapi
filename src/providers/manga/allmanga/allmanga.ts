import axios, { AxiosInstance } from "axios";
import { Logger } from "../../../core/logger.js";

// ─── Constants & CDNs ──────────────────────────────────────────────────────

const ALLMANGA_CDN_HOSTS = [
  "https://wp.youtube-anime.com/aln.youtube-anime.com",
  "https://wp.youtube-anime.com",
  "https://aln.youtube-anime.com",
];

import { allmanga as BASE_URL, allmanga_api as API_URL } from "../../origins.js";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  Referer: `${BASE_URL}/`,
  Origin: BASE_URL,
  Accept: "application/json",
};

// ─── Helper Functions ──────────────────────────────────────────────────────

function decodeHTMLEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&nbsp;": " ",
  };
  return text.replace(/&([^;]+);/g, (match, entity) => {
    if (entities[match]) return entities[match];
    if (entity.startsWith("#x")) return String.fromCharCode(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCharCode(parseInt(entity.slice(1), 10));
    return match;
  });
}

function cleanText(text: string): string {
  if (!text) return "";
  let cleaned = text.replace(/<[^>]*>?/gm, "");
  cleaned = decodeHTMLEntities(cleaned);
  return cleaned.replace(/\s+/g, " ").trim();
}

function proxyImage(url: string, baseApiUrl: string): string {
  if (!url || !baseApiUrl) return url;
  const root = baseApiUrl.replace(/\/$/, "");
  let targetUrl = url;

  if (!url.startsWith("http")) {
    const cleanPath = url.replace(/^\/+/, "");
    targetUrl = `${ALLMANGA_CDN_HOSTS[0]}/${cleanPath}?w=250`;
  }

  const path = targetUrl.replace(/^https?:\/\//, "");
  return `${root}/image/${path}`;
}

// ─── Scraper Class ─────────────────────────────────────────────────────────

export class AllMangaParser {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      headers: DEFAULT_HEADERS,
      timeout: 15000,
    });
  }

  private async apqRequest(variables: Record<string, any>, sha256Hash: string) {
    try {
      const extensions = {
        persistedQuery: { version: 1, sha256Hash: sha256Hash },
      };

      const response = await this.http.get(API_URL, {
        params: {
          variables: JSON.stringify(variables),
          extensions: JSON.stringify(extensions),
        },
      });
      return response.data;
    } catch (error: any) {
      Logger.error(`AllManga API Error: ${error.message}`);
      throw new Error("Failed to fetch data from AllManga API", { cause: error });
    }
  }

  private formatMangaList(rawList: any[], baseApiUrl: string) {
    return rawList.map((item: any) => {
      const card = item.anyCard || item;
      return {
        id: cleanText(card._id),
        title: cleanText(card.name),
        englishTitle: cleanText(card.englishName),
        nativeTitle: cleanText(card.nativeName),
        cover: proxyImage(card.thumbnail, baseApiUrl),
        score: card.score,
        availableChapters: card.availableChapters || { sub: 0, raw: 0 },
      };
    });
  }

  // ─── Endpoints ──────────────────────────────────────────────────────

  async parsePopular(
    baseApiUrl: string,
    page = 1,
    size = 20,
    period = "daily",
  ): Promise<Record<string, unknown>> {
    try {
      let dateRange = 1;
      if (period === "weekly") dateRange = 7;
      if (period === "monthly") dateRange = 30;
      if (period === "all") dateRange = 0;

      const variables = {
        type: "manga",
        size: size,
        dateRange: dateRange,
        page: page,
        allowAdult: false,
        allowUnknown: false,
      };
      const hash = "60f50b84bb545fa25ee7f7c8c0adbf8f5cea40f7b1ef8501cbbff70e38589489";
      const data = await this.apqRequest(variables, hash);
      const rawList = data?.data?.queryPopular?.recommendations || [];

      return {
        provider: "AllManga",
        total: data?.data?.queryPopular?.total || 0,
        page: page,
        period: period,
        results: this.formatMangaList(rawList, baseApiUrl),
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async parseSearch(
    query: string,
    baseApiUrl: string,
    page = 1,
    extraSearchArgs: any = {},
  ): Promise<Record<string, unknown>> {
    try {
      // FIX: Only inject the query string if it actually exists!
      const searchObj: any = {
        isManga: true,
        allowAdult: false,
        allowUnknown: false,
        ...extraSearchArgs,
      };
      if (query) {
        searchObj.query = query;
      }

      const variables = {
        search: searchObj,
        limit: 26,
        page: page,
        translationType: "sub",
        countryOrigin: "ALL",
      };

      const hash = "2d48e19fb67ddcac42fbb885204b6abb0a84f406f15ef83f36de4a66f49f651a";
      const data = await this.apqRequest(variables, hash);
      const rawList = data?.data?.mangas?.edges || [];

      return {
        provider: "AllManga",
        total: data?.data?.mangas?.pageInfo?.total || 0,
        page: page,
        results: this.formatMangaList(rawList, baseApiUrl),
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async parseRandom(baseApiUrl: string): Promise<Record<string, unknown>> {
    try {
      const variables = { format: "manga", allowAdult: false };
      const hash = "2ad2035e21ca17b8f8bab8e7e879be875cdd4ff4a1bdd89228b50e84ac1425d5";
      const data = await this.apqRequest(variables, hash);
      const rawList = data?.data?.queryRandomRecommendation || [];

      return { provider: "AllManga", results: this.formatMangaList(rawList, baseApiUrl) };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async parseTags(): Promise<Record<string, unknown>> {
    try {
      const variables = { search: { format: "manga", queryType: "Home" }, page: 1 };
      const hash = "fbd24de3aec73d35332185b621beec15396aaf8e8ae00183ddac6c19fbf8adcf";
      const data = await this.apqRequest(variables, hash);
      const rawList = data?.data?.queryTags?.edges || [];

      const tags = rawList.map((item: any) => ({
        name: item.name,
        slug: item.slug,
        type: item.tagType || "genre",
        count: item.mangaCount,
      }));

      return { provider: "AllManga", tags };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async parseTagList(
    slug: string,
    name: string,
    tagType: string | null,
    baseApiUrl: string,
  ): Promise<Record<string, unknown>> {
    try {
      const variables = { search: { slug: slug, format: "manga", tagType: tagType, name: name } };
      const hash = "ff61a63ff776f334f80c1e6ad1aa49ef71eab831e235e5d6ec679eae5b83450f";
      const data = await this.apqRequest(variables, hash);
      const rawList = data?.data?.queryListForTag?.edges || [];

      return {
        provider: "AllManga",
        tag: name,
        results: this.formatMangaList(rawList, baseApiUrl),
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async parseHome(baseApiUrl: string): Promise<Record<string, unknown>> {
    try {
      const tags = [
        { slug: "pegging", name: "Pegging", type: null },
        { slug: "ga_bunko_magazine-magazine", name: "GA Bunko Magazine", type: "magazine" },
        { slug: "ganma_-magazine", name: "Ganma!", type: "magazine" },
        { slug: "tournament_s", name: "Tournament/s", type: null },
        { slug: "shounen_jump_weekly_-magazine", name: "Shounen Jump (Weekly)", type: "magazine" },
        { slug: "bunshun_online-magazine", name: "Bunshun Online", type: "magazine" },
        { slug: "based_on_a_visual_novel", name: "Based on a Visual Novel", type: null },
        { slug: "crafting", name: "Crafting", type: null },
        { slug: "4_koma", name: "4-koma", type: null },
        { slug: "young_animal-magazine", name: "Young Animal", type: "magazine" },
        { slug: "depression", name: "Depression", type: null },
        { slug: "transformation_s", name: "Transformation/s", type: null },
        { slug: "beast_girl_s", name: "Beast Girl/s", type: null },
        {
          slug: "advanced_knowledge_meets_archaic_world",
          name: "Advanced Knowledge Meets Archaic World",
          type: null,
        },
        { slug: "anachronism", name: "Anachronism", type: null },
        { slug: "beautiful_love_interest_s", name: "Beautiful Love Interest/s", type: null },
        { slug: "disowned_child", name: "Disowned Child", type: null },
        { slug: "magazine_pocket-magazine", name: "Magazine pocket", type: "magazine" },
      ];

      const corePromises = [
        this.parsePopular(baseApiUrl, 1, 15, "daily").then((res) => ({
          id: "popular-daily",
          title: "Popular Manga (Daily)",
          items: (res as any).results || [],
        })),
        this.parseSearch("", baseApiUrl, 1).then((res) => ({
          id: "latest",
          title: "Latest Updates",
          items: (res as any).results || [],
        })),
        this.parseSearch("", baseApiUrl, 1, { year: 2026 }).then((res) => ({
          id: "manga-2026",
          title: "Manga 2026",
          items: (res as any).results || [],
        })),
        this.parseRandom(baseApiUrl).then((res) => ({
          id: "random",
          title: "Random Recommendations",
          items: (res as any).results || [],
        })),
      ];

      const tagPromises = tags.map((t) =>
        this.parseTagList(t.slug, t.name, t.type, baseApiUrl).then((res) => ({
          id: t.slug,
          title: t.name,
          items: (res as any).results || [],
        })),
      );

      const allResults = await Promise.allSettled([...corePromises, ...tagPromises]);

      const sections = allResults
        .filter((res): res is PromiseFulfilledResult<any> => res.status === "fulfilled")
        .map((res) => res.value)
        .filter((section) => section.items.length > 0);

      return {
        provider: "AllManga",
        sections: sections,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async parseDetail(id: string, baseApiUrl: string): Promise<Record<string, unknown>> {
    try {
      // The site's own detail query. The old code read the manga off `chapterPages`,
      // which upstream now gates behind a browser-only crypto handshake — every title
      // came back "Manga not found". This query needs no handshake.
      const variables = {
        _id: id,
        search: { allowAdult: false, allowUnknown: false },
      };
      const hash = "d77781dcf964b97aea0be621dbde430e89e200b58526823ee6010dd11c3ca96a";
      const data = await this.apqRequest(variables, hash);

      const mangaInfo = data?.data?.manga;
      if (!mangaInfo) throw new Error("Manga not found");

      const coverUrl = proxyImage(mangaInfo.thumbnail, baseApiUrl);

      const genresArray = (mangaInfo.genres || []).map((g: string) => ({
        genre: cleanText(g),
        slug: g,
      }));

      const authorsArray = (mangaInfo.authors || []).map((a: string) => ({
        author: cleanText(a),
        slug: a,
      }));

      const totalSub = mangaInfo.availableChapters?.sub || 0;

      // Real chapter strings, not a 1..n guess — upstream numbering has gaps and
      // decimals ("0", "1.1", "1090.5") that a generated range never matches.
      const subChapters: string[] = mangaInfo.availableChaptersDetail?.sub || [];
      const chapterList = (
        subChapters.length
          ? subChapters
          : Array.from({ length: totalSub }, (_, i) => String(totalSub - i))
      ).map((chapterString) => ({
        id: `${id}:sub:${chapterString}`,
        number: Number(chapterString),
        title: `Chapter ${chapterString}`,
        lang: "sub",
      }));

      return {
        provider: "AllManga",
        id: mangaInfo._id,
        title: cleanText(mangaInfo.name),
        englishTitle: cleanText(mangaInfo.englishName),
        nativeTitle: cleanText(mangaInfo.nativeName),
        altTitles: mangaInfo.altNames || [],
        cover: coverUrl,
        banner: mangaInfo.banner || null,
        description: cleanText(mangaInfo.description || ""),
        genres: genresArray,
        authors: authorsArray,
        tags: mangaInfo.tags || [],
        type: mangaInfo.type || null,
        magazine: mangaInfo.magazine || null,
        countryOfOrigin: mangaInfo.countryOfOrigin || null,
        score: mangaInfo.score ?? null,
        averageScore: mangaInfo.averageScore ?? null,
        status: mangaInfo.status || "Unknown",
        totalChapters: totalSub,
        rawChapters: mangaInfo.availableChapters?.raw || 0,
        airedStart: mangaInfo.airedStart,
        airedEnd: mangaInfo.airedEnd,
        chapterList: chapterList,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async parseRead(chapterId: string, baseApiUrl: string): Promise<Record<string, unknown>> {
    try {
      const parts = chapterId.split(":");
      const mangaId = parts[0];
      const translationType = parts[1] || "sub";
      const chapterString = parts[2] || "1";

      const variables = {
        mangaId: mangaId,
        translationType: translationType,
        chapterString: chapterString,
        limit: 10,
        offset: 0,
      };
      const hash = "a062f1b131dae3d17c1950fad14640d066b988ac10347ed49cfbe70f5e7f661b";
      const data = await this.apqRequest(variables, hash);

      // Upstream gated `chapterPages` behind a rotating browser-only crypto
      // handshake (x-build-id / x-aa-boot, issued after a Cloudflare Turnstile on
      // the reader domain). Say so instead of reporting an empty chapter.
      const gated = (data?.errors || []).find((e: any) =>
        String(e?.extensions?.code || e?.message || "").startsWith("AA_CRYPTO"),
      );
      if (gated) {
        throw new Error(
          `AllManga blocked chapter pages (${gated.extensions?.code || gated.message}) — ` +
            `upstream now requires a browser-issued token for reading`,
        );
      }

      const edges = data?.data?.chapterPages?.edges || [];
      if (!edges.length) throw new Error("Chapter pages not found");

      const source = edges[0];
      const head = source.pictureUrlHead || ALLMANGA_CDN_HOSTS[0];

      const pages = source.pictureUrls.map((page: any) => {
        let url = page.url;
        if (!url.startsWith("http")) {
          url = `${head.replace(/\/$/, "")}/${url.replace(/^\/+/, "")}`;
        }
        return {
          page: page.num + 1,
          img: proxyImage(url, baseApiUrl),
        };
      });

      return { provider: "AllManga", id: chapterId, pages: pages };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async proxyImage(targetUrl: string): Promise<any> {
    try {
      const res = await this.http.get(targetUrl, {
        responseType: "arraybuffer",
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          Referer: "https://allmanga.to/",
        },
      });
      return {
        success: true,
        contentType: res.headers["content-type"] || "image/jpeg",
        content: res.data,
      };
    } catch (err: any) {
      Logger.error(`AllManga Image Proxy Error: ${err.message}`);
      return { success: false, status: err.response?.status || 500, error: err.message };
    }
  }
}

export const allmanga = new AllMangaParser();
