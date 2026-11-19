import { Logger } from "../../../core/logger.js";
import { proxifySource } from "../../../core/proxy.js";
import { inc } from "../../../core/counters.js";
import type {
  DramaInfo,
  DramaSource,
  DramaStream,
  DramaSubtitle,
  Paginated,
} from "../nartodrama/types.js";
import { KNOWN_KEY, decrypt, keyInBundle } from "./crypto.js";
import {
  DRAMATIP,
  appKey,
  flightOf,
  lastPage,
  localePath,
  parseCards,
  parseInfo,
  parseSources,
  siteLocale,
  type Descriptor,
  type DramatipCard,
} from "./parse.js";
import { choose, mightPlay } from "./playback.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const EMPTY_PAGE: Paginated<DramatipCard> = { currentPage: 1, hasNextPage: false, results: [] };

/** A page fetch may not hang a caller: the site answers in about a second. */
const PAGE_TIMEOUT_MS = 20_000;

/** dramatip answered, and the answer was "busy" (429/5xx). Not a verdict. */
export class DramatipBusy extends Error {
  constructor(what: string) {
    super(`dramatip busy: ${what}`);
    this.name = "DramatipBusy";
  }
}

/**
 * DramaTip (dramatip.net): an aggregator of ~87 short-drama apps.
 *
 * Next.js behind Cloudflare, server-rendered, no challenge and no cookies.
 * Listings and detail are HTML (see parse.ts). The one JSON endpoint is the
 * stream API, which wants a dramatip Referer and answers with encrypted blobs
 * (crypto.ts). How each app's stream is delivered differs (playback.ts).
 */
export class Dramatip {
  // ─── Fetching ──────────────────────────────────────────────────────────────

  private static async fetchText(url: string, accept: string): Promise<string> {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept, Referer: `${DRAMATIP}/` },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (res.status === 429 || res.status >= 500) throw new DramatipBusy(`${res.status} ${url}`);
    if (!res.ok) throw new Error(`dramatip fetch failed (${res.status}): ${url}`);
    return res.text();
  }

  private static fetchHtml(url: string) {
    return this.fetchText(url, "text/html,application/xhtml+xml");
  }

  // ─── The key ───────────────────────────────────────────────────────────────

  private static key = process.env.DRAMATIP_KEY || KNOWN_KEY;
  private static keyReadAt = 0;
  private static keyRead: Promise<string | null> | null = null;

  /**
   * Read the AES key out of the player bundle.
   *
   * The key sits in a lazily-loaded chunk that no page links directly: an
   * episode page links ~16 chunks, and one of those names the chunk with the
   * key. So the page's chunks are searched first, then the chunks THEY name,
   * up to a cap.
   * At most once every ten minutes however many episodes fail, and one read
   * serves every caller that arrives while it runs.
   */
  static refreshKey(): Promise<string | null> {
    if (this.keyRead) return this.keyRead;
    if (Date.now() - this.keyReadAt < 10 * 60_000) return Promise.resolve(null);
    this.keyReadAt = Date.now();
    this.keyRead = this.readKeyFromBundle()
      .then((found) => {
        if (found && found !== this.key) {
          Logger.warn("dramatip: the player's AES key changed; using the new one");
          this.key = found;
          inc("dramatip.key_rotated");
        }
        return found;
      })
      .catch((err) => {
        Logger.error(err);
        return null;
      })
      .finally(() => {
        this.keyRead = null;
      });
    return this.keyRead;
  }

  private static async readKeyFromBundle(): Promise<string | null> {
    const chunkRe = /(?:\/_next\/)?static\/chunks\/[A-Za-z0-9_~.-]+\.js/g;
    const urlOf = (path: string) =>
      `${DRAMATIP}/_next/${path.replace(/^\/?_next\//, "").replace(/^\//, "")}`;

    // Only a page with the PLAYER on it links the chunk that names the key's
    // chunk, and that is an episode page - the listing pages do not. Any
    // episode page will do, so the first title on the catalogue is used.
    const slug = parseCards(await this.fetchHtml(`${DRAMATIP}/series`))[0]?.id;
    if (!slug) return null;
    const html = await this.fetchHtml(`${DRAMATIP}/series/${slug}/episode-1`);
    const queue = [...new Set((html.match(chunkRe) ?? []).map(urlOf))];
    const seen = new Set(queue);

    for (let i = 0; i < queue.length && i < 80; i++) {
      let js: string;
      try {
        js = await this.fetchText(queue[i], "*/*");
      } catch {
        continue;
      }
      const key = keyInBundle(js);
      if (key) return key;
      for (const path of js.match(chunkRe) ?? []) {
        const next = urlOf(path);
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    Logger.error("dramatip: AES key not found in the player bundle");
    inc("dramatip.key_not_found");
    return null;
  }

  // ─── Listings ──────────────────────────────────────────────────────────────

  private static async listing(
    path: string,
    page: number,
    lang: string,
    pageUrl: (base: string, page: number) => string,
  ): Promise<Paginated<DramatipCard>> {
    const locale = siteLocale(lang);
    // A locale dramatip does not have is "nothing listed", not an error.
    if (!locale) return { ...EMPTY_PAGE, currentPage: page };
    const html = await this.fetchHtml(pageUrl(DRAMATIP + localePath(locale, path), page));
    return {
      currentPage: page,
      hasNextPage: lastPage(html) > page,
      results: parseCards(html),
    };
  }

  /** The whole catalogue, newest first: `/series/page/N`. */
  static home(page = 1, lang = "en") {
    return this.listing("/series", page, lang, (b, p) => (p > 1 ? `${b}/page/${p}` : b));
  }

  /** One upstream app's catalogue: `/source/<key>/page/N`. */
  static source(key: string, page = 1, lang = "en") {
    return this.listing(`/source/${encodeURIComponent(key)}`, page, lang, (b, p) =>
      p > 1 ? `${b}/page/${p}` : b,
    );
  }

  static search(query: string, page = 1, lang = "en") {
    const q = encodeURIComponent(query.trim());
    return this.listing("/search", page, lang, (b, p) => `${b}?q=${q}${p > 1 ? `&page=${p}` : ""}`);
  }

  /** Every upstream app and how many titles it has. */
  static async sources(lang = "en") {
    const locale = siteLocale(lang);
    if (!locale) return [];
    return parseSources(await this.fetchHtml(DRAMATIP + localePath(locale, "/sources")));
  }

  // ─── Detail ────────────────────────────────────────────────────────────────

  /**
   * Title, synopsis, poster and episode list.
   *
   * `provider` is the UPSTREAM APP ("dramabox"), as it is for narto: that is
   * what our catalogue files a title under and what a takedown names.
   * `playable` is a first guess from episode one's descriptor, which the page
   * already carries - no extra request.
   */
  static async info(
    slug: string,
    lang = "en",
  ): Promise<(DramaInfo & { playable: boolean; playbackTypes: string[] }) | null> {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return null;
    const locale = siteLocale(lang);
    if (!locale) return null;

    const res = await fetch(DRAMATIP + localePath(locale, `/series/${slug}`), {
      headers: { "User-Agent": UA, Accept: "text/html", Referer: `${DRAMATIP}/` },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) throw new DramatipBusy(`${res.status} info ${slug}`);
    if (!res.ok) throw new Error(`dramatip info failed (${res.status}): ${slug}`);

    const parsed = parseInfo(await res.text(), slug);
    // An unknown slug is answered with the series hub page: 200, no episodes.
    if (!parsed || parsed.episodes.length === 0) return null;

    return {
      id: slug,
      title: parsed.title,
      provider: appKey(parsed.sourceName) || "dramatip",
      url: `${DRAMATIP}/series/${slug}`,
      poster: parsed.poster,
      description: parsed.description,
      totalEpisodes: parsed.totalEpisodes,
      tags: parsed.tags,
      episodes: parsed.episodes,
      playable: mightPlay(parsed.first?.chain),
      playbackTypes: (parsed.first?.chain ?? []).map((c) => String(c?.type ?? "none")),
    } as DramaInfo & { playable: boolean; playbackTypes: string[] };
  }

  // ─── Stream ────────────────────────────────────────────────────────────────

  private static async descriptor(
    slug: string,
    episode: number,
    locale: string,
  ): Promise<Descriptor | null> {
    const url = `${DRAMATIP}/api/episode-source/${encodeURIComponent(slug)}/${episode}?lang=${locale}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        // Without a dramatip Referer this endpoint answers 403 "forbidden".
        Referer: `${DRAMATIP}${localePath(locale, `/series/${slug}/episode-${episode}`)}`,
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (res.status === 429 || res.status >= 500) throw new DramatipBusy(`${res.status} source ${slug}/${episode}`);
    if (!res.ok) throw new Error(`dramatip source failed (${res.status}): ${slug}/${episode}`);
    const body = (await res.json()) as { descriptor?: Descriptor | null };
    return body?.descriptor ?? null;
  }

  /**
   * A playable source for one episode, or null when there is none we can use.
   *
   * `refresh` in the answer says the link is short-lived (signed, or a session
   * the app must renew), so the route caches it briefly.
   */
  static async watch(
    slug: string,
    episode: number,
    lang = "en",
  ): Promise<(DramaStream & { refresh: boolean }) | null> {
    const locale = siteLocale(lang) ?? "en";
    const descriptor = await this.descriptor(slug, episode, locale);
    // `{"descriptor":null}` with a 200 is how a missing episode is answered.
    if (!descriptor?.chain?.length) return null;

    let picked = choose(descriptor.chain, (enc) => decrypt(enc, this.key));
    // Nothing decrypted at all: that is a rotated key, not an unplayable
    // episode. Read the key again and try once more.
    if (picked.ok === false && picked.why.every((w) => w.includes("undecryptable"))) {
      inc("dramatip.decrypt_failed");
      if (await this.refreshKey()) {
        picked = choose(descriptor.chain, (enc) => decrypt(enc, this.key));
      }
    }
    if (picked.ok === false) {
      for (const why of picked.why) inc(`dramatip.unsupported.${why.replace(/[^a-z0-9]+/gi, "_")}`);
      Logger.warn(`dramatip: no playable source for ${slug} ep ${episode} (${picked.why.join(", ")})`);
      return null;
    }

    const { entry, play } = picked;
    const origin = { Origin: DRAMATIP, Referer: `${DRAMATIP}/` };
    const source: DramaSource =
      play.how === "origin-proxy"
        ? {
            // The CDN answers only dramatip's origin, so there is no link a
            // player could open by itself: `directUrl` stays empty and the
            // stream goes through our proxy, which sends the header.
            url: proxifySource(play.url, origin, true),
            quality: "default",
            isM3U8: true,
            proxied: true,
            directUrl: "",
          }
        : {
            url: proxifySource(play.url, undefined, play.isM3U8),
            quality: "default",
            isM3U8: play.isM3U8,
            proxied: true,
            directUrl: play.url,
          };

    // Other sizes of the same stream, when the app publishes them separately.
    const qualities: DramaSource[] = [];
    if (play.how === "direct") {
      for (const [label, enc] of Object.entries(entry.encByQuality ?? {})) {
        try {
          const url = decrypt(enc, this.key);
          if (url === play.url || /\.encrypt\./i.test(url)) continue;
          qualities.push({
            url: proxifySource(url, undefined, play.isM3U8),
            quality: /^\d+$/.test(label) ? `${label}p` : label,
            isM3U8: play.isM3U8,
            proxied: true,
            directUrl: url,
          });
        } catch {
          /* one size failing to decrypt costs only that size */
        }
      }
    }

    const subtitles: DramaSubtitle[] = [];
    if (descriptor.subtitle?.enc) {
      try {
        subtitles.push({
          url: decrypt(descriptor.subtitle.enc, this.key),
          label: descriptor.subtitle.language || "English",
        } as DramaSubtitle);
      } catch {
        /* a subtitle is a nicety; the episode still plays */
      }
    }

    return {
      id: `${slug}-${episode}`,
      episode,
      provider: appKey(String(descriptor.source ?? entry.source ?? "")) || "dramatip",
      sources: [source, ...qualities],
      subtitles,
      servedBy: "dramatip",
      refresh: entry.refresh === true,
    };
  }

  /** For tests and the route's own diagnostics. */
  static flightOf = flightOf;
}
