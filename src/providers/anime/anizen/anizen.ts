import * as cheerio from "cheerio";
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
    const html = await this.getHtml(
      `/search?keyword=${encodeURIComponent(query)}&page=${p}`,
    );
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
        arr.sort((a: any, b: any) =>
          String(b?.time ?? "").localeCompare(String(a?.time ?? "")),
        );
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

  // ─── Player resolver ───────────────────────────────────────────────────────
  // Upstream's streamingLink.file is a /player/<token> page on aniapi.anizen.tr
  // that wraps a megacloud-style iframe. Resolve it down to the actual m3u8:
  //   1. GET /player/<token>/resolve with X-Requested-With: ZenPlayer
  //        → { url: "https://megaplay.buzz/stream/s-2/<realId>/<sub|dub>" }
  //   2. GET that page, scrape data-id="<fileId>" off #megaplay-player
  //   3. GET <inner host>/stream/getSources?id=<fileId>
  //        → { sources:{file:<m3u8>}, tracks:[...], intro, outro }
  // The inner player is mirrored across megaplay.buzz and vidwish.live (same
  // /stream/s-2/<id>/<type> paths), and /resolve sometimes hands out the dead
  // mirror (vidwish serves an error page for files megaplay has) — so try the
  // given host first, then its mirror. The CDN that serves the m3u8
  // hard-checks the Referer of whichever mirror produced it (every other
  // referer gets 403), so clients MUST send the returned referer.

  private static readonly PLAYER_MIRROR_HOSTS = ["megaplay.buzz", "vidwish.live"];

  private static isPlayerUrl(url: string): boolean {
    return /^https?:\/\/[^/]*(?:aniapi|cdn)\.anizen\.[a-z]+\/player\//i.test(url);
  }

  private static async resolvePlayer(playerUrl: string): Promise<{
    m3u8: string;
    referer: string;
    subtitles: { file: string; label?: string; kind?: string; default?: boolean }[];
    intro?: { start: number; end: number };
    outro?: { start: number; end: number };
  } | null> {
    try {
      // 1. /resolve → inner iframe URL
      const resolveRes = await fetch(`${playerUrl}/resolve`, {
        headers: {
          "User-Agent": USER_AGENT,
          Referer: playerUrl,
          "X-Requested-With": "ZenPlayer",
        },
      });
      if (!resolveRes.ok) return null;
      const resolveJson = (await resolveRes.json()) as { url?: string };
      const innerUrl = resolveJson?.url;
      if (!innerUrl) return null;

      // 2+3 on the given host, then on its mirror.
      const candidates = [innerUrl];
      try {
        const u = new URL(innerUrl);
        if (this.PLAYER_MIRROR_HOSTS.includes(u.host)) {
          for (const host of this.PLAYER_MIRROR_HOSTS) {
            if (host === u.host) continue;
            const alt = new URL(innerUrl);
            alt.host = host;
            candidates.push(alt.toString());
          }
        }
      } catch {
        /* not a parseable URL — try it as-is */
      }

      for (const candidate of candidates) {
        const resolved = await this.resolveInnerPlayer(candidate);
        if (resolved) return resolved;
      }
      return null;
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

  // Upstream's `servers` array mixes every audio variant (hsub/ssub/dub) in
  // one list no matter which `type` was requested — filter before labeling,
  // or a sub request surfaces dub embeds tagged "(HardSub)".
  private static serverMatchesType(s: any, t: "sub" | "dub"): boolean {
    const st = String(s?.type ?? "").toLowerCase();
    if (!st) return true;
    return t === "dub" ? st === "dub" : st !== "dub";
  }

  static async fetchEpisodeServers(
    episodeId: string,
    subOrDub: "softsub" | "dub" | "hardsub" = "hardsub",
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
    const servers = (Array.isArray(raw?.results?.servers) ? raw.results.servers : []).filter(
      (s: any) => this.serverMatchesType(s, t),
    );

    const suffix = t === "dub" ? " (Dub)" : " (HardSub)";
    const results: AnizenStreamSource[] = [];
    const seen = new Set<string>();

    let resolvedIntro: [number, number] | null = null;
    let resolvedOutro: [number, number] | null = null;
    let haveHls = false;

    if (link?.link?.file) {
      const name = `Anizen ${link.server ?? "primary"}${suffix}`;
      seen.add(link.server ?? "");
      const upstreamTracks = Array.isArray(link.tracks) ? link.tracks : [];
      const upstreamSubs = upstreamTracks
        .filter((tr: any) => tr?.kind !== "thumbnails")
        .map((tr: any) => ({
          url: tr.file ?? tr.url ?? undefined,
          lang: tr.label ?? tr.kind ?? undefined,
          type: t === "dub" ? "none" : "soft",
        }));

      const file = link.link.file as string;
      const isAlreadyHls = /\.m3u8(\?|$)/i.test(file);

      // If the upstream "file" is really a /player/ iframe, resolve the chain
      // and serve the real m3u8. Client (Android/ExoPlayer) injects Referer
      // directly — no server-side proxying needed.
      if (!isAlreadyHls && this.isPlayerUrl(file)) {
        const resolved = await this.resolvePlayer(file);
        if (resolved) {
          const resolvedSubs = resolved.subtitles.map((tr) => ({
            url: tr.file,
            lang: tr.label ?? tr.kind ?? undefined,
            type: t === "dub" ? "none" : "soft",
          }));
          const subtitles = resolvedSubs.length > 0 ? resolvedSubs : upstreamSubs;
          results.push({
            name,
            iframe: file,
            sources: [{ file: resolved.m3u8, type: "hls" }],
            subtitles,
            download: null,
            headers: { Referer: resolved.referer },
          });
          if (resolved.intro) resolvedIntro = [resolved.intro.start, resolved.intro.end];
          if (resolved.outro) resolvedOutro = [resolved.outro.start, resolved.outro.end];
          haveHls = true;
        } else {
          // Resolver failed (network/upstream change); surface the iframe so
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

      // The primary chain came up iframe-only; these embeds are /player/
      // pages on the same resolver, so try to turn one of them into a real
      // m3u8 before settling for iframes.
      if (!haveHls && this.isPlayerUrl(s.embed)) {
        const resolved = await this.resolvePlayer(s.embed);
        if (resolved) {
          results.unshift({
            name: `Anizen ${sName}${suffix}`,
            iframe: s.embed,
            sources: [{ file: resolved.m3u8, type: "hls" }],
            subtitles: resolved.subtitles.map((tr) => ({
              url: tr.file,
              lang: tr.label ?? tr.kind ?? undefined,
              type: t === "dub" ? "none" : "soft",
            })),
            download: null,
            headers: { Referer: resolved.referer },
          });
          if (resolved.intro && !resolvedIntro)
            resolvedIntro = [resolved.intro.start, resolved.intro.end];
          if (resolved.outro && !resolvedOutro)
            resolvedOutro = [resolved.outro.start, resolved.outro.end];
          haveHls = true;
          continue;
        }
      }

      results.push({
        name: `Anizen ${sName}${suffix}`,
        iframe: s.embed,
        sources: [{ file: s.embed, type: "iframe" }],
        subtitles: [],
        download: null,
      });
    }

    // Prefer the upstream's intro/outro when present; fall back to whatever
    // the megaplay resolver returned (often the only source of skip markers).
    const introArr = Array.isArray(link?.intro) ? link.intro : null;
    const outroArr = Array.isArray(link?.outro) ? link.outro : null;
    const intro: [number, number] | null = introArr
      ? [this.toInt(introArr[0]), this.toInt(introArr[1])]
      : resolvedIntro;
    const outro: [number, number] | null = outroArr
      ? [this.toInt(outroArr[0]), this.toInt(outroArr[1])]
      : resolvedOutro;
    return {
      isDub: t === "dub",
      results,
      ...(intro ? { intro } : {}),
      ...(outro ? { outro } : {}),
    };
  }
}
