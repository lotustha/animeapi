import { createHash } from "node:crypto";
import { Logger } from "../../../core/logger.js";
import { proxifyFetch, proxifySource } from "../../../core/proxy.js";
import { moviebox, moviebox_api } from "../../origins.js";
import {
  captionSchema,
  detailSchema,
  playSchema,
  searchSchema,
  trendingSchema,
  type MovieBoxInfo,
  type MovieBoxItem,
  type MovieBoxStream,
  type MovieBoxType,
} from "./types.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

// The video and subtitle CDNs (hakunaymatata.com) 429 without a moviebox Referer.
const CDN_HEADERS = { Referer: `${moviebox}/`, "User-Agent": UA };

// Anonymous session. The BFF hands out a ~90-day JWT in the `x-user` response
// header of any call signed with X-Client-Token; after that only the Bearer is
// sent (sending both makes content calls answer 400 "invalid token").
let session: { token: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;

// X-Client-Token is "<unix secs>,<md5 of the secs reversed>" — no secret.
const clientToken = () => {
  const ts = String(Math.floor(Date.now() / 1000));
  const hash = createHash("md5").update(ts.split("").reverse().join("")).digest("hex");
  return `${ts},${hash}`;
};

const jwtExpiry = (token: string): number => {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch {
    // fall through to the default below
  }
  return Date.now() + 24 * 3600 * 1000;
};

const fetchToken = async (): Promise<string> => {
  const res = await fetch(`${moviebox_api}/subject/trending?page=0&perPage=1`, {
    headers: { "X-Client-Token": clientToken(), "User-Agent": UA, Accept: "application/json" },
  });
  const header = res.headers.get("x-user");
  if (!header) throw new Error(`moviebox: no session issued (HTTP ${res.status})`);
  const token = JSON.parse(header).token as string;
  // Renew an hour early so a token never expires mid-request.
  session = { token, expiresAt: jwtExpiry(token) - 3600 * 1000 };
  return token;
};

const getToken = async (): Promise<string> => {
  if (session && session.expiresAt > Date.now()) return session.token;
  pending ??= fetchToken().finally(() => (pending = null));
  return pending;
};

const toType = (subjectType: number): MovieBoxType | null =>
  subjectType === 1 ? "movie" : subjectType === 2 ? "tv" : null;

const toItem = (s: {
  subjectId: string;
  subjectType: number;
  title: string;
  detailPath: string;
  cover?: { url: string } | null;
  releaseDate?: string;
  genre?: string;
  countryName?: string;
  imdbRatingValue?: string;
}): MovieBoxItem | null => {
  const type = toType(s.subjectType);
  if (!type) return null;
  return {
    id: s.detailPath,
    subjectId: s.subjectId,
    title: s.title,
    type,
    poster: s.cover?.url || undefined,
    releaseDate: s.releaseDate || undefined,
    genres: s.genre ? s.genre.split(",").filter(Boolean) : [],
    country: s.countryName || undefined,
    rating: s.imdbRatingValue || undefined,
  };
};

const splitList = (value?: string) => (value ? value.split(",").filter(Boolean) : []);

export class MovieBox {
  /** Authenticated BFF call. Retries once with a fresh session if the token was refused. */
  private static async api(
    path: string,
    init: { method?: "GET" | "POST"; body?: unknown; referer?: string } = {},
    retry = true,
  ): Promise<unknown> {
    const token = await getToken();
    const res = await fetch(`${moviebox_api}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Client-Info": JSON.stringify({ timezone: "UTC" }),
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": UA,
        ...(init.referer ? { Referer: init.referer } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as { code?: number } | null;
    if (retry && (res.status === 401 || json?.code === 401 || json?.code === 400)) {
      session = null;
      return this.api(path, init, false);
    }
    return json;
  }

  static async search(query: string, page = 1, type: MovieBoxType | "all" = "all") {
    const subjectType = type === "movie" ? 1 : type === "tv" ? 2 : 0;
    const parsed = searchSchema.safeParse(
      await this.api("/subject/search", {
        method: "POST",
        body: { keyword: query, page, perPage: 24, subjectType },
      }),
    );
    if (!parsed.success || parsed.data.code !== 0 || !parsed.data.data) {
      Logger.warn(`moviebox: search "${query}" returned an unexpected shape`);
      return { page, hasNextPage: false, results: [] as MovieBoxItem[] };
    }
    const results = (parsed.data.data.items ?? [])
      .map(toItem)
      .filter((i): i is MovieBoxItem => i !== null);
    return { page, hasNextPage: parsed.data.data.pager.hasMore, results };
  }

  static async trending(page = 1) {
    // The BFF's trending pages are 0-based.
    const parsed = trendingSchema.safeParse(
      await this.api(`/subject/trending?page=${page - 1}&perPage=24`),
    );
    if (!parsed.success || parsed.data.code !== 0 || !parsed.data.data) {
      Logger.warn("moviebox: trending returned an unexpected shape");
      return { page, hasNextPage: false, results: [] as MovieBoxItem[] };
    }
    const results = (parsed.data.data.subjectList ?? [])
      .map(toItem)
      .filter((i): i is MovieBoxItem => i !== null);
    return { page, hasNextPage: parsed.data.data.pager?.hasMore ?? false, results };
  }

  static async info(id: string): Promise<MovieBoxInfo | null> {
    const parsed = detailSchema.safeParse(
      await this.api(`/detail?detailPath=${encodeURIComponent(id)}`),
    );
    if (!parsed.success || parsed.data.code !== 0 || !parsed.data.data) return null;

    const { subject, stars, resource } = parsed.data.data;
    const item = toItem(subject);
    if (!item) return null;

    const seasons = (resource?.seasons ?? []).map((s) => {
      const listed = splitList(s.allEp).map(Number).filter(Number.isFinite);
      const episodes =
        item.type === "movie"
          ? []
          : listed.length > 0
            ? listed
            : Array.from({ length: s.maxEp }, (_, i) => i + 1);
      return {
        season: s.se,
        episodes,
        resolutions: (s.resolutions ?? []).map((r) => r.resolution),
      };
    });

    return {
      ...item,
      description: subject.description || undefined,
      duration: subject.duration || undefined,
      subtitleLanguages: splitList(subject.subtitles),
      dubs: (subject.dubs ?? []).map((d) => ({
        id: d.detailPath,
        subjectId: d.subjectId,
        language: d.lanName,
        langCode: d.lanCode,
        original: d.original ?? false,
      })),
      cast: (stars ?? []).map((s) => ({
        name: s.name,
        character: s.character || undefined,
        image: s.avatarUrl || undefined,
      })),
      seasons,
    };
  }

  /**
   * Stream sources for a movie (season/episode 0) or one TV episode.
   * The returned MP4 URLs are signed and short-lived; they are proxied so the
   * CDN sees the moviebox Referer it insists on.
   */
  static async watch(
    info: Pick<MovieBoxInfo, "id" | "subjectId" | "type">,
    season = 0,
    episode = 0,
  ): Promise<MovieBoxStream | null> {
    const se = info.type === "movie" ? 0 : season;
    const ep = info.type === "movie" ? 0 : episode;
    // The play endpoint answers an empty stream list unless the Referer is this
    // title's page on the moviebox site.
    const referer = `${moviebox}/movies/${info.id}`;
    const query = `subjectId=${info.subjectId}&se=${se}&ep=${ep}&detailPath=${encodeURIComponent(info.id)}`;

    const parsed = playSchema.safeParse(await this.api(`/subject/play?${query}`, { referer }));
    if (!parsed.success || parsed.data.code !== 0) {
      Logger.warn(`moviebox: play ${info.id} S${se}E${ep} returned an unexpected shape`);
      return null;
    }
    const streams = parsed.data.data?.streams ?? [];
    if (streams.length === 0) return null;

    const sources = streams
      .map((s) => ({
        url: proxifySource(s.url, CDN_HEADERS),
        type: "mp4" as const,
        quality: Number(s.resolutions) || 0,
        sizeBytes: s.size ? Number(s.size) : undefined,
        codec: s.codecName || undefined,
      }))
      .sort((a, b) => b.quality - a.quality);

    // Captions are keyed to a stream but shared across its resolutions.
    const first = streams[0];
    const captions = captionSchema.safeParse(
      await this.api(
        `/subject/caption?format=${first.format}&id=${first.id}&subjectId=${info.subjectId}&detailPath=${encodeURIComponent(info.id)}`,
        { referer },
      ),
    );
    const subtitles =
      captions.success && captions.data.code === 0
        ? (captions.data.data?.captions ?? []).map((c) => ({
            label: c.lanName,
            langCode: c.lan,
            url: proxifyFetch(c.url, CDN_HEADERS),
          }))
        : [];

    return { sources, subtitles, headers: CDN_HEADERS };
  }
}
