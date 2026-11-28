import { proxifySource } from "../../../core/proxy.js";
import type { DramaInfo, DramaStream, DramaSubtitle, Paginated } from "../nartodrama/types.js";

/**
 * Narto Dramas (www.nartodramas.com): replaces narto-drama.com as the source
 * of NEW titles (2026-11-28). narto-drama.com walls its search by our IP and
 * answers "No results" even from home; this site serves the same catalogue
 * family from a plain JSON API with no wall, no cookie and no challenge.
 *
 *   /api/dramas?page=N&q=term      24 cards a page, newest first, with `total`
 *   /api/dramas?slug=S             one title with EVERY episode's video_url
 *   /api/dramas?slug=S&episode=N   one episode
 *
 * One mixed-language list: `lang` is ignored upstream, so the caller decides
 * which titles fit a locale (ani-nexus detect-language.mjs).
 *
 * Videos are plain MP4s on cdn.narto-drama.com that answer without a Referer,
 * so a player may open them directly; the proxy URL is the fallback.
 */

export const NARTODRAMAS = "https://www.nartodramas.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 24;

/** nartodramas answered "busy" (429/5xx) or not at all. Not a verdict. */
export class NartodramasBusy extends Error {
  constructor(what: string) {
    super(`nartodramas busy: ${what}`);
    this.name = "NartodramasBusy";
  }
}

export type NartodramasCard = {
  id: string;
  title: string;
  url: string;
  poster: string;
  /** The upstream app ("ShortPeak", "DramaBox"). */
  provider: string | null;
  tags: string[];
  description: string;
  totalEpisodes: number;
  availableEpisodes: number;
};

type RawEpisode = {
  episode_number?: unknown;
  title?: unknown;
  video_url?: unknown;
  subtitle_url?: unknown;
  available?: unknown;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const http = (v: unknown) => (typeof v === "string" && /^https?:\/\//i.test(v) ? v : "");
const SLUG = /^[a-z0-9][a-z0-9-]*$/i;

async function getJson(path: string): Promise<{ status: number; body: any }> {
  let res: Response;
  try {
    res = await fetch(`${NARTODRAMAS}${path}`, {
      headers: { "User-Agent": UA, Accept: "application/json", Referer: `${NARTODRAMAS}/` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new NartodramasBusy(`${(err as Error).name} ${path}`);
  }
  if (res.status === 429 || res.status >= 500) throw new NartodramasBusy(`${res.status} ${path}`);
  if (res.status === 404) return { status: 404, body: null };
  if (!res.ok) throw new Error(`nartodramas ${res.status}: ${path}`);
  return { status: res.status, body: await res.json() };
}

export function parseCard(raw: any): NartodramasCard | null {
  const id = str(raw?.slug);
  const title = str(raw?.title).trim();
  if (!SLUG.test(id) || !title) return null;
  return {
    id,
    title,
    url: `${NARTODRAMAS}/drama/${id}`,
    poster: http(raw?.posterUrl) || http(raw?.posterFallbackUrls?.[0]),
    provider: str(raw?.provider) || null,
    tags: Array.isArray(raw?.tags) ? raw.tags.map(String) : [],
    description: str(raw?.description),
    totalEpisodes: Number(raw?.episodes) || 0,
    availableEpisodes: Number(raw?.availableEpisodes) || 0,
  };
}

export function parseList(body: any, page: number): Paginated<NartodramasCard> {
  const items = Array.isArray(body?.items) ? body.items : [];
  const total = Number(body?.total) || 0;
  const size = Number(body?.pageSize) || PAGE_SIZE;
  return {
    currentPage: page,
    hasNextPage: page * size < total,
    results: items.map(parseCard).filter((c: NartodramasCard | null): c is NartodramasCard => c !== null),
  };
}

/** Only episodes the site marks available AND gives a link for. */
function playableEpisodes(raw: unknown): { number: number; url: string; subtitle: string }[] {
  return (Array.isArray(raw) ? (raw as RawEpisode[]) : [])
    .map((e) => ({
      number: Number(e?.episode_number),
      url: http(e?.video_url),
      subtitle: http(e?.subtitle_url),
      available: e?.available !== false,
    }))
    .filter((e) => Number.isInteger(e.number) && e.number > 0 && e.url && e.available)
    .map(({ number, url, subtitle }) => ({ number, url, subtitle }))
    .sort((a, b) => a.number - b.number);
}

export function parseInfo(body: any): DramaInfo | null {
  const item = body?.item;
  const slug = str(item?.slug);
  const title = str(item?.title).trim();
  if (!SLUG.test(slug) || !title) return null;
  const all = Array.isArray(item?.episodes) ? item.episodes : [];
  const episodes = playableEpisodes(all);
  if (episodes.length === 0) return null;
  return {
    id: slug,
    title,
    provider: str(item?.provider) || undefined,
    url: `${NARTODRAMAS}/drama/${slug}`,
    poster: http(item?.poster_url) || http(item?.poster_fallback_urls?.[0]),
    description: str(item?.description),
    // Declared by the episode list itself, unavailable ones included: a title
    // with 60 listed and 56 out is ongoing, not a 56-episode show.
    totalEpisodes: all.length,
    tags: Array.isArray(item?.tags) ? item.tags.map(String) : [],
    episodes: episodes.map((e) => ({
      id: `${slug}$${e.number}`,
      number: e.number,
      title: `Episode ${e.number}`,
      thumbnail: "",
      isPlayable: true,
    })),
  };
}

/** Whether a link's first bytes come back: a link is not a stream until fetched. */
async function delivers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Range: "bytes=0-1023" },
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

export class Nartodramas {
  static async list(page = 1, q = ""): Promise<Paginated<NartodramasCard>> {
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set("q", q);
    const { body } = await getJson(`/api/dramas?${params}`);
    return parseList(body, page);
  }

  static async info(slug: string): Promise<DramaInfo | null> {
    if (!SLUG.test(slug)) return null;
    const { status, body } = await getJson(`/api/dramas?slug=${encodeURIComponent(slug)}`);
    return status === 404 ? null : parseInfo(body);
  }

  /**
   * One episode. [check] fetches the file's first bytes before answering, for
   * the import gate: only a link that delivers now lets a title in.
   */
  static async watch(slug: string, episode: number, check = false): Promise<DramaStream | null> {
    if (!SLUG.test(slug)) return null;
    const { status, body } = await getJson(
      `/api/dramas?slug=${encodeURIComponent(slug)}&episode=${episode}`,
    );
    if (status === 404) return null;
    const [ep] = playableEpisodes(body?.episode ? [body.episode] : []);
    if (!ep || ep.number !== episode) return null;
    if (check && !(await delivers(ep.url))) return null;

    const isM3U8 = /\.m3u8(\?|$)/i.test(ep.url);
    const subtitles: DramaSubtitle[] = ep.subtitle ? [{ label: "English", url: ep.subtitle }] : [];
    return {
      id: `${slug}$${episode}`,
      episode,
      provider: "",
      sources: [
        {
          url: proxifySource(ep.url, undefined, isM3U8),
          quality: "default",
          isM3U8,
          proxied: true,
          directUrl: ep.url,
        },
      ],
      subtitles,
    };
  }
}
