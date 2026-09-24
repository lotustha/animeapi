import * as cheerio from "cheerio";
import { Logger } from "../../../core/logger.js";
import { proxifySource, proxifyFetch } from "../../../core/proxy.js";
import { nartodrama } from "../../origins.js";
import { episodeItemSchema } from "./types.js";
import {
  LANG,
  UA,
  absoluteUrl,
  busy,
  forgetWatchContext,
  getWatchContext,
  getWatchContextResult,
  isHlsSource,
  resolveSourceResult,
  servesDirect,
} from "./scraper/refresh-source.js";
import type { SourceMiss } from "./scraper/refresh-source.js";
import {
  duplicateOfPrevious,
  fileKeys,
  rememberEpisodeFiles,
} from "./scraper/duplicate-episode.js";
import { fetchFullProviderCatalogue, fetchProviderSections, resolveImportSlug } from "./scraper/provider-explorer.js";

import type {
  DramaCard,
  DramaEpisode,
  DramaInfo,
  DramaSource,
  DramaStream,
  DramaSubtitle,
  Paginated,
  ProviderCatalogue,
  UpstreamProvider,
} from "./types.js";
import { browserCheckCookie, isBrowserCheck } from "./scraper/browser-check.js";
import { nartoBudget } from "./scraper/narto-budget.js";

const EMPTY_PAGE: Paginated<DramaCard> = { currentPage: 1, hasNextPage: false, results: [] };

export class NartoDrama {
  private static async fetchHtml(url: string) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        // See browser-check.ts: without it every listing is narto's stub.
        Cookie: browserCheckCookie(),
      },
    });
    if (res.status === 429) nartoBudget.noteBusy();
    if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`);
    const html = await res.text();
    // Thrown, not parsed: the stub has no cards, and an empty page is how the
    // last wall went unnoticed for a week.
    if (isBrowserCheck(html)) throw new Error(`narto browser check not passed: ${url}`);
    return cheerio.load(html);
  }

  private static absolute(url: string) {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    return nartodrama + (url.startsWith("/") ? url : "/" + url);
  }

  /** `/detail/watch/<slug>?lang=en-US&from=home` → `<slug>` */
  private static slugFromUrl(url: string) {
    const match = url.match(/\/detail\/watch\/([^/?#]+)/);
    return match ? match[1] : "";
  }

  /**
   * Every listing page (home, search, genre, tag) renders the same
   * `article.card` grid, so one parser covers all of them.
   */
  private static parseCards($: cheerio.CheerioAPI): DramaCard[] {
    const results: DramaCard[] = [];

    $("article.card").each((_, el) => {
      const card = $(el);
      const href =
        card.attr("data-watch-url") || card.find("a.card-link-overlay").attr("href") || "";
      const id = this.slugFromUrl(href);
      if (!id) return;

      const img = card.find("img.poster");
      const title =
        card.attr("data-movie-title") ||
        card.attr("data-search-title") ||
        card.find("h3.title").attr("title") ||
        card.find("h3.title").text().trim() ||
        img.attr("alt") ||
        "";

      results.push({
        id,
        title: title.trim(),
        url: `${nartodrama}/detail/watch/${id}`,
        poster: this.absolute(img.attr("data-src") || img.attr("src") || ""),
      });
    });

    return results;
  }

  /**
   * Listing pages disagree on how they advertise the next page: the home grid
   * renders a real pagination anchor, while /search only emits a
   * `<link rel="next">` in the head. Checking the anchor alone reports
   * hasNextPage:false on search and clients stop after the first 24 results.
   */
  private static hasNextPage($: cheerio.CheerioAPI, page: number) {
    return $(`link[rel="next"]`).length > 0 || $(`a[href*="page=${page + 1}"]`).length > 0;
  }

  /**
   * Some titles render no `.movie-desc` block at all; for those the only
   * synopsis on the page is the TVSeries ld+json, which appends a fixed
   * site-wide marketing sentence that gets trimmed back off here.
   */
  private static descriptionFromLdJson($: cheerio.CheerioAPI): string {
    let description = "";

    $('script[type="application/ld+json"]').each((_, el) => {
      if (description) return;
      try {
        const data = JSON.parse($(el).text());
        if (data?.["@type"] === "TVSeries" || data?.["@type"] === "Movie") {
          description = String(data.description || "");
        }
      } catch {
        /* malformed ld+json — ignore and try the next block */
      }
    });

    return description.split(" Narto Drama - Watch Short Dramas")[0].trim();
  }

  private static async listing(
    path: string,
    page: number,
    lang: string = LANG,
  ): Promise<Paginated<DramaCard>> {
    try {
      const url = new URL(nartodrama + path);
      url.searchParams.set("lang", lang);
      if (page > 1) url.searchParams.set("page", String(page));

      const $ = await this.fetchHtml(url.toString());
      return {
        currentPage: page,
        hasNextPage: this.hasNextPage($, page),
        results: this.parseCards($),
      };
    } catch (err) {
      Logger.error(err);
      return { ...EMPTY_PAGE, currentPage: page };
    }
  }

  static async home(page = 1, lang: string = LANG) {
    return this.listing("/", page, lang);
  }

  static async search(
    query: string,
    page = 1,
    lang: string = LANG,
  ): Promise<Paginated<DramaCard>> {
    try {
      const url = new URL(nartodrama + "/search");
      url.searchParams.set("q", query);
      url.searchParams.set("lang", lang);
      if (page > 1) url.searchParams.set("page", String(page));

      const $ = await this.fetchHtml(url.toString());
      return {
        currentPage: page,
        hasNextPage: this.hasNextPage($, page),
        results: this.parseCards($),
      };
    } catch (err) {
      Logger.error(err);
      return { ...EMPTY_PAGE, currentPage: page };
    }
  }

  static async genre(genre: string, page = 1, lang: string = LANG) {
    return this.listing(`/genre/${genre}`, page, lang);
  }

  static async tag(tag: string, page = 1, lang: string = LANG) {
    return this.listing(`/tag/${tag}`, page, lang);
  }

  /** The ~41 upstream apps narto-drama aggregates (iDrama, ReelShort, …). */
  static async providers(lang: string = LANG): Promise<UpstreamProvider[]> {
    const catalogue = await fetchProviderSections(undefined, lang);
    return catalogue?.providers ?? [];
  }

  /**
   * One upstream provider's own catalogue, grouped into its channels/tabs.
   *
   * An unknown `provider=` is not an error upstream — the endpoint answers 200
   * with whichever app is currently promoted (bibishort), so an unvalidated key
   * would serve the wrong catalogue and cache it under the requested name.
   * Treat a mismatch between what was asked for and what came back as a miss.
   */
  static async providerCatalogue(
    key: string,
    lang: string = LANG,
    full = false,
  ): Promise<ProviderCatalogue | null> {
    const catalogue = full
      ? await fetchFullProviderCatalogue(key, lang)
      : await fetchProviderSections(key, lang);
    if (!catalogue) return null;

    const wanted = key.trim().toLowerCase();
    if (catalogue.provider.toLowerCase() !== wanted) return null;

    return catalogue;
  }

  /**
   * Map a provider catalogue entry (provider + bookId) to a local slug that
   * info()/watch() accept. Kept as its own step because resolving every item in
   * a catalogue eagerly would cost one request per item.
   */
  static async resolve(provider: string, bookId: string, lang: string = LANG) {
    const slug = await resolveImportSlug(provider, bookId, lang);
    if (!slug) return null;
    return { provider, bookId, slug, url: `${nartodrama}/detail/watch/${slug}` };
  }

  /**
   * Series metadata plus the full episode list.
   *
   * These live on two different pages: the detail page carries the title,
   * poster, description and tags, while the rich episode list (ids, thumbnails,
   * playable flags) is only embedded in a watch page. Both are fetched in
   * parallel; if the watch page fails the episode list degrades to the plain
   * `a.episode-item` links on the detail page.
   */
  static async info(slug: string, lang: string = LANG): Promise<DramaInfo | null> {
    try {
      const [$, watch] = await Promise.all([
        this.fetchHtml(`${nartodrama}/detail/watch/${slug}?lang=${lang}`),
        // `lang` matters here as much as on the detail page above: the watch
        // context supplies the whole episode list and the provider key, and
        // it is cached under a locale-scoped key. Omitting it returned English
        // episode titles for a Polish request and wrote them into the en-US
        // cache slot, while watch() next door was passing it correctly.
        getWatchContext(slug, 1, lang).catch(() => null),
      ]);

      const title = $("h1.movie-title").text().trim();
      if (!title) return null;

      const tags: string[] = [];
      $("a.movie-tag-pill").each((_, el) => {
        const tag = $(el).text().trim().replace(/^#/, "");
        if (tag) tags.push(tag);
      });

      let episodes: DramaEpisode[] = (watch?.episodes ?? []).flatMap((raw) => {
        const parsed = episodeItemSchema.safeParse(raw);
        if (!parsed.success) return [];
        const ep = parsed.data;
        const number = ep.route_episode_number ?? ep.number;
        return [
          {
            id: `${slug}$${number}`,
            number,
            title: ep.title || `Episode ${number}`,
            thumbnail: ep.thumb_url || "",
            isPlayable: ep.is_playable !== false,
          },
        ];
      });

      if (episodes.length === 0) {
        const numbers = new Set<number>();
        $("a.episode-item").each((_, el) => {
          const href = $(el).attr("href") || "";
          const match = href.match(/\/detail\/watch\/[^/?#]+\/(\d+)/);
          if (match) numbers.add(Number(match[1]));
        });
        episodes = [...numbers]
          .sort((a, b) => a - b)
          .map((number) => ({
            id: `${slug}$${number}`,
            number,
            title: `Episode ${number}`,
            thumbnail: "",
            isPlayable: true,
          }));
      }

      return {
        id: slug,
        title,
        provider: watch?.app || "",
        url: `${nartodrama}/detail/watch/${slug}`,
        poster: this.absolute($("div.movie-meta img.poster").attr("src") || ""),
        description: $("div.movie-desc").text().trim() || this.descriptionFromLdJson($),
        totalEpisodes: episodes.length,
        tags,
        episodes,
      };
    } catch (err) {
      Logger.error(err);
      return null;
    }
  }

  /**
   * Resolve playable sources for one episode.
   *
   * The returned CDN URL is signed and short-lived, and the upstream CDN 403s
   * when a narto-drama Referer is present — so sources are proxied WITHOUT any
   * forwarded headers. Subtitles go through /proxy/fetch for CORS only.
   */
  static async watch(
    slug: string,
    episode: number,
    lang: string = LANG,
    options: { fresh?: boolean } = {},
  ): Promise<DramaStream | null> {
    const result = await this.watchResult(slug, episode, lang, options);
    return "kind" in result ? null : result;
  }

  /**
   * [watch], but saying WHY when there is nothing to play.
   *
   * The route needs the difference: "gone" is a 404 it may cache, "busy" is a
   * 503 it must not. See [SourceMiss] for what conflating them cost.
   */
  static async watchResult(
    slug: string,
    episode: number,
    lang: string = LANG,
    options: { fresh?: boolean } = {},
  ): Promise<DramaStream | SourceMiss> {
    try {
      const page = await getWatchContextResult(slug, episode, lang);
      if (!("ctx" in page)) return page.miss;
      const ctx = page.ctx;

      const answer = await resolveSourceResult(ctx, slug, episode, options);
      if (answer.kind !== "ok") {
        // The edge stopped accepting the token this context carries. Let go of
        // the context so the retry we are about to invite fetches a new one.
        if (answer.kind === "busy" && answer.reason === "token-refused") {
          void forgetWatchContext(slug, lang);
        }
        return answer;
      }
      const resolved = answer.source;

      // After the ladder, whichever rung answered: a forced refresh hands back
      // the same repeated file, so it is checked here and not per rung. The
      // keys are remembered even for a copy, so a third identical episode is
      // caught against this one.
      const keys = fileKeys([resolved.play_url, resolved.direct_play_url]);
      const repeats = duplicateOfPrevious(slug, episode, keys, ctx.episodes);
      rememberEpisodeFiles(slug, episode, keys);
      if (repeats !== null) {
        Logger.warn(`nartodrama: ${slug} ep ${episode} is the same file as ep ${repeats} — withheld`);
        return { kind: "gone", reason: "duplicate" };
      }

      const primary = resolved.play_url || resolved.direct_play_url || "";
      const sources: DramaSource[] = [];
      const seen = new Set<string>();

      // Geo-blocked upstreams must not be proxied: routing them through this
      // server guarantees a 410, while the raw URL plays from the viewer's own
      // connection. See servesDirect() for why.
      const direct = servesDirect(ctx.app);

      const push = (raw: string, quality: string) => {
        const url = absoluteUrl(raw);
        if (!url || seen.has(url)) return;
        seen.add(url);
        const isM3U8 = isHlsSource(url, resolved.direct_play_is_hls);
        sources.push({
          url: direct ? url : proxifySource(url, undefined, isM3U8),
          quality,
          isM3U8,
          proxied: !direct,
          // Handed out alongside the proxied URL rather than instead of it:
          // some upstreams geo-block this server, others geo-block the viewer,
          // and only the client can find out which. It tries this first.
          directUrl: url,
        });
      };

      push(primary, "default");
      for (const res of resolved.multi_resolutions ?? []) {
        if (res.stream_url) push(res.stream_url, res.label || "auto");
      }

      if (sources.length === 0) return { kind: "gone", reason: "no-url" };

      const subtitles: DramaSubtitle[] = [];
      const subSeen = new Set<string>();
      // Normalize before deduping: the same track can arrive site-relative in
      // `subtitle_url` and absolute in `multi_subtitles`.
      const pushSub = (raw: string | undefined, label: string) => {
        const url = absoluteUrl(raw || "");
        if (!url || subSeen.has(url)) return;
        subSeen.add(url);
        subtitles.push({ label, url: proxifyFetch(url) });
      };

      pushSub(resolved.subtitle_url || resolved.direct_subtitle_url, "Default");
      for (const sub of resolved.multi_subtitles ?? []) {
        pushSub(sub.url, sub.label || "Unknown");
      }

      return {
        id: `${slug}$${episode}`,
        episode: resolved.episode_number ?? episode,
        provider: ctx.app || "",
        sources,
        subtitles,
      };
    } catch (err) {
      Logger.error(err);
      return busy("exception");
    }
  }
}
