import { createHash } from "node:crypto";
import { Logger } from "../../../core/logger.js";
import { proxifyFetch, proxifySource } from "../../../core/proxy.js";
import { moviebox, moviebox_api } from "../../origins.js";
import {
  captionSchema,
  detailSchema,
  filterItemsSchema,
  homeRowsSchema,
  playSchema,
  rawSchema,
  searchSchema,
  trendingSchema,
  type MovieBoxDub,
  type MovieBoxFilter,
  type MovieBoxInfo,
  type MovieBoxItem,
  type MovieBoxStream,
  type MovieBoxSubtitle,
  type MovieBoxType,
} from "./types.js";
import { cleanResults, mergeSubtitles, sameCut } from "./scraper/clean.js";

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

// Rows added to the top of /home, in order. Each is one of the site's browse
// filters, the same list MovieBox's own "Categories" tiles open.
const HOME_ROWS: { title: string; filter: MovieBoxFilter }[] = [
  // themoviebox.xyz/web/film?type=/home/movieFilter&tabId=2&country=India&sort=Latest
  { title: "Bollywood", filter: { type: "movie", country: "India", sort: "Latest" } },
];

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

  /** `data` of a BFF call in MovieBox's own shape, or null on failure. */
  private static async raw(
    path: string,
    init?: { method?: "GET" | "POST"; body?: unknown },
  ): Promise<unknown> {
    const parsed = rawSchema.safeParse(await this.api(path, init));
    if (!parsed.success || parsed.data.code !== 0 || parsed.data.data == null) {
      Logger.warn(`moviebox: ${path} returned an unexpected shape`);
      return null;
    }
    return parsed.data.data;
  }

  // Raw passthroughs for MovieBox-shaped clients (the Noon Flix TV app): they
  // keep the upstream's payloads verbatim so the client models never change.

  /**
   * Home page rows (`operatingList`: banners, subject rails, …), with
   * HOME_ROWS placed first after the banner. Added rows copy the shape of the
   * site's own subject rows, so clients render them like any other.
   */
  /**
   * A site tab's rows (`operatingList`), the page behind /web/<tab>. Tab 2 is
   * Movie; tab 9 is the age-gated "midnight" (18+) tab.
   */
  static async tab(tabId: number) {
    return this.raw(`/tab-operating?tabId=${tabId}&host=themoviebox.xyz`);
  }

  static async home() {
    const [home, ...extra] = await Promise.all([
      this.raw("/home"),
      ...HOME_ROWS.map((r) => this.filter(r.filter)),
    ]);
    const parsed = homeRowsSchema.safeParse(home);
    if (!parsed.success) return home;

    const rows = parsed.data.operatingList;
    const template = rows.find((r) => r.type === "SUBJECTS_MOVIE");
    const bannerAt = rows.findIndex((r) => r.type === "BANNER");
    const position = bannerAt >= 0 ? rows[bannerAt].position : 1;

    const added = HOME_ROWS.flatMap((row, i) => {
      const subjects = filterItemsSchema.safeParse(extra[i]).data?.items ?? [];
      if (!template || subjects.length === 0) return [];
      return [
        {
          ...template,
          title: row.title,
          subjects,
          position,
          opId: `mugen-${row.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          url: "",
          filters: [],
          genreTopId: "",
          detailPath: "",
          // Where "see all" leads: GET /movie-tv/moviebox/filter with these facets.
          filter: row.filter,
        },
      ];
    });

    rows.splice(bannerAt + 1, 0, ...added);
    return parsed.data;
  }

  /**
   * One page of the site's movie/TV browse filter (`pager`, `items`), the page
   * behind /web/film?type=/home/movieFilter. Pages are 1-based.
   */
  static filter(f: MovieBoxFilter, page = 1, perPage = 24) {
    return this.raw("/subject/filter", {
      method: "POST",
      body: {
        page,
        perPage,
        channelId: f.type === "tv" ? 2 : 1,
        classify: f.classify || "All",
        country: f.country || "All",
        genre: f.genre || "All",
        year: f.year || "All",
        sort: f.sort || "Latest",
      },
    });
  }

  /** One ranking list (`title`, `subjectList`, `pager`). Pages are 1-based. */
  static ranking(id: string, page = 1, perPage = 24) {
    return this.raw(
      `/ranking-list/content?id=${encodeURIComponent(id)}&page=${page}&perPage=${perPage}`,
    );
  }

  /** Full detail (`subject`, `stars`, `resource`, …) keyed by subjectId. */
  static detail(subjectId: string) {
    return this.raw(`/detail?subjectId=${encodeURIComponent(subjectId)}`);
  }

  /** Search-as-you-type words (`items`). */
  static suggest(keyword: string, perPage = 12) {
    return this.raw("/subject/search-suggest", {
      method: "POST",
      body: { keyword, perPage },
    });
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
    const results = cleanResults(
      (parsed.data.data.items ?? []).map(toItem).filter((i): i is MovieBoxItem => i !== null),
    );
    return { page, hasNextPage: parsed.data.data.pager.hasMore, results };
  }

  /**
   * What people are searching for right now (the site's "everyone is
   * searching" list), each term with its top search result so clients can
   * show a poster. Terms with no result are dropped.
   */
  static async topSearches() {
    const raw = (await this.raw("/subject/everyone-search")) as
      | { everyoneSearch?: { title?: string }[] }
      | null;
    const terms = (raw?.everyoneSearch ?? [])
      .map((e) => (e?.title ?? "").trim())
      .filter((t) => t.length > 0);
    const found = await Promise.all(
      terms.map(async (keyword) => {
        const { results } = await this.search(keyword, 1, "all");
        return results.length ? { keyword, item: results[0] } : null;
      }),
    );
    return { items: found.filter((f) => f !== null) };
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
    const results = cleanResults(
      (parsed.data.data.subjectList ?? []).map(toItem).filter((i): i is MovieBoxItem => i !== null),
    );
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
        kind: d.type === 1 ? ("hardsub" as const) : ("audio" as const),
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
   * The language version of `info` to play for `audio` (a langCode such as
   * "hi", or a dub's id). A dubbed track wins over a hardsub one of the same
   * language. Without `audio` it is the title itself. Null when nothing matches.
   */
  static pickDub(info: MovieBoxInfo, audio?: string): MovieBoxDub | null {
    if (!audio) return info.dubs.find((d) => d.subjectId === info.subjectId) ?? null;
    const code = audio.toLowerCase();
    return (
      info.dubs.find((d) => d.id === audio) ??
      info.dubs.find((d) => d.langCode.toLowerCase() === code && d.kind === "audio") ??
      info.dubs.find((d) => d.langCode.toLowerCase() === code) ??
      null
    );
  }

  /**
   * One language version's MP4 streams and the subtitles filed with them.
   * Null when the version has nothing to play.
   */
  private static async play(
    target: { id: string; subjectId: string },
    se: number,
    ep: number,
    withSubtitles = true,
  ) {
    const { id, subjectId } = target;
    // The play endpoint answers an empty stream list unless the Referer is this
    // title's page on the moviebox site.
    const referer = `${moviebox}/movies/${id}`;
    const query = `subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${encodeURIComponent(id)}`;

    const parsed = playSchema.safeParse(await this.api(`/subject/play?${query}`, { referer }));
    if (!parsed.success || parsed.data.code !== 0) {
      Logger.warn(`moviebox: play ${id} S${se}E${ep} returned an unexpected shape`);
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
    const durations = streams.map((s) => s.duration ?? 0);

    const first = streams[0];
    const subtitles = withSubtitles ? await this.subtitles(target, first, referer) : [];
    return { sources, subtitles, durations, first };
  }

  /** Captions are keyed to a stream but shared across its resolutions. */
  private static async subtitles(
    { id, subjectId }: { id: string; subjectId: string },
    stream: { id: string; format: string },
    referer = `${moviebox}/movies/${id}`,
  ): Promise<MovieBoxSubtitle[]> {
    const captions = captionSchema.safeParse(
      await this.api(
        `/subject/caption?format=${stream.format}&id=${stream.id}&subjectId=${subjectId}&detailPath=${encodeURIComponent(id)}`,
        { referer },
      ),
    );
    if (!captions.success || captions.data.code !== 0) return [];
    return (captions.data.data?.captions ?? []).map((c) => ({
      label: c.lanName,
      langCode: c.lan,
      url: proxifyFetch(c.url, CDN_HEADERS),
      format: "srt" as const,
    }));
  }

  /**
   * Stream sources for a movie (season/episode 0) or one TV episode, in the
   * language version `dub` (default: the title itself). Every dub is its own
   * subject upstream, so switching audio means playing a different subject.
   *
   * Dubs often carry fewer subtitles than the original (The Love Hypothesis's
   * French dub has only French), so when a dub is the same cut as the original
   * the original's extra languages are added, marked `fromOriginal`.
   *
   * The returned MP4 URLs are signed and short-lived; they are proxied so the
   * CDN sees the moviebox Referer it insists on.
   */
  static async watch(
    info: Pick<MovieBoxInfo, "id" | "subjectId" | "type" | "dubs">,
    season = 0,
    episode = 0,
    dub?: MovieBoxDub | null,
  ): Promise<MovieBoxStream | null> {
    const se = info.type === "movie" ? 0 : season;
    const ep = info.type === "movie" ? 0 : episode;
    const target = dub ?? info;
    const original = info.dubs.find((d) => d.original);
    const borrowFrom = dub && original && original.subjectId !== dub.subjectId ? original : null;

    const [own, orig] = await Promise.all([
      this.play(target, se, ep),
      borrowFrom ? this.play(borrowFrom, se, ep, false) : null,
    ]);
    if (!own) return null;

    let subtitles = own.subtitles;
    if (borrowFrom && orig && sameCut(own.durations, orig.durations)) {
      subtitles = mergeSubtitles(subtitles, await this.subtitles(borrowFrom, orig.first));
    }

    return {
      sources: own.sources,
      subtitles,
      headers: CDN_HEADERS,
      audio: dub ?? undefined,
      audioTracks: info.dubs,
    };
  }
}
