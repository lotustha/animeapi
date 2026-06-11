import { lookerFetch } from "./fetch.js";
import { buildFullSlug } from "./slug.js";
import { QUALITY_ORDER } from "./const.js";

export type DirectStream = { url: string; quality: string; server: string };
export type EmbedStream = { url: string; server: string };
export type ServerGroup = { server: string; streams: Omit<DirectStream, "server">[] };

/** Resolved streams for a single audio language. */
export type LangTrack = {
  lang: string;
  hash: string | null;
  servers: ServerGroup[]; // direct HLS/MP4, grouped by server
  embeds: EmbedStream[]; // iframe/embed players
  best: string | null;
};

export type SubTrack = { url: string; lang?: string };

export type AllLangsResult = {
  episodeNumber: number;
  // animelok's full slug (`${titleToSlug(title)}-${anilistId}`) — callers use it
  // to build links back to animelok.online pages (e.g. /watch/<slug>?ep=N).
  slug: string;
  preferQuality: string;
  languages: string[];
  tracks: Record<string, LangTrack>;
  // Episode-level metadata (same across languages).
  intro?: [number, number];
  outro?: [number, number];
  subtitles: SubTrack[];
};

// ─── Server categorisation ────────────────────────────────────────────────────

/**
 * Push a raw server entry into the correct bucket (direct HLS/MP4 vs embed).
 * Handles stringified-JSON arrays (pahe style) and auto-detects quality.
 */
function collectServer(srv: any, direct: DirectStream[], embeds: EmbedStream[]) {
  const rawUrl = srv.url;
  if (!rawUrl) return;

  const serverName: string = srv.name || srv.server || "Unknown";
  let items: Array<{ url: string; quality: string; server: string }> = [];

  // pahe-style payloads stuff a JSON array of {url,quality} into `url`
  const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        items = parsed.map((p: any) => ({
          url: p.url,
          quality: p.quality || srv.quality || "unknown",
          server: serverName,
        }));
      }
    } catch {
      // not valid JSON — fall through to single-URL handling
    }
  }

  if (items.length === 0) {
    items.push({ url: rawUrl, quality: srv.quality || "unknown", server: serverName });
  }

  for (const item of items) {
    if (!item.url) continue;
    const urlLower = item.url.toLowerCase();
    const type = (srv.type || "").toLowerCase();

    if (!item.quality || item.quality === "unknown") {
      if (urlLower.includes("master.m3u8")) item.quality = "Multi";
      else if (urlLower.includes("1080p") || urlLower.includes("/1080/")) item.quality = "1080p";
      else if (urlLower.includes("720p") || urlLower.includes("/720/")) item.quality = "720p";
      else if (urlLower.includes("480p") || urlLower.includes("/480/")) item.quality = "480p";
      else if (urlLower.includes("360p") || urlLower.includes("/360/")) item.quality = "360p";
    }

    const isDirect =
      type === "hls" ||
      type === "m3u8" ||
      type === "mp4" ||
      urlLower.includes(".m3u8") ||
      urlLower.includes(".mp4");

    if (isDirect) {
      direct.push({ url: item.url, quality: item.quality || "unknown", server: item.server });
    } else {
      embeds.push({ url: item.url, server: item.server });
    }
  }
}

// ─── Per-language track ────────────────────────────────────────────────────────

/**
 * Build a self-contained track for one language from the raw server list.
 * When `fallbackAll` is set and nothing matches the language, every server is
 * used instead (sensible for a single requested language; off when enumerating
 * all languages so tracks don't bleed into each other).
 */
export function buildLangTrack(
  rawServers: any[],
  langUpper: string,
  preferQuality: string,
  fallbackAll = false,
): LangTrack {
  const direct: DirectStream[] = [];
  const embeds: EmbedStream[] = [];

  for (const srv of rawServers) {
    const hasLang = !srv.languages?.length || srv.languages.includes(langUpper);
    if (!hasLang) continue;
    collectServer(srv, direct, embeds);
  }

  if (fallbackAll && direct.length === 0 && embeds.length === 0) {
    for (const srv of rawServers) collectServer(srv, direct, embeds);
  }

  direct.sort((a, b) => {
    if (a.quality === preferQuality && b.quality !== preferQuality) return -1;
    if (b.quality === preferQuality && a.quality !== preferQuality) return 1;
    const idxA = QUALITY_ORDER.indexOf(a.quality);
    const idxB = QUALITY_ORDER.indexOf(b.quality);
    const rankA = idxA === -1 ? QUALITY_ORDER.length - 1.5 : idxA;
    const rankB = idxB === -1 ? QUALITY_ORDER.length - 1.5 : idxB;
    return rankA - rankB;
  });

  const serverMap = new Map<string, Omit<DirectStream, "server">[]>();
  for (const { url, quality, server } of direct) {
    const key = server.toLowerCase();
    if (!serverMap.has(key)) serverMap.set(key, []);
    serverMap.get(key)!.push({ url, quality });
  }
  const servers: ServerGroup[] = Array.from(serverMap.entries()).map(([server, streams]) => ({
    server,
    streams,
  }));

  const hashMatch = embeds.map((e) => e.url?.match(/\/video\/([a-f0-9]+)$/i)).find(Boolean);
  const hash = hashMatch ? hashMatch[1]! : null;

  return { lang: langUpper, hash, servers, embeds, best: direct[0]?.url ?? embeds[0]?.url ?? null };
}

/** Distinct audio languages advertised across the raw server list. */
export function listLanguages(rawServers: any[]): string[] {
  const set = new Set<string>();
  for (const srv of rawServers) {
    if (Array.isArray(srv.languages)) {
      for (const l of srv.languages) if (typeof l === "string" && l) set.add(l.toUpperCase());
    }
  }
  return Array.from(set);
}

// ─── Episode metadata helpers ──────────────────────────────────────────────────

function parseSkip(start: unknown, end: unknown): [number, number] | undefined {
  const s = Number(start);
  const e = Number(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || (s === 0 && e === 0)) return undefined;
  return [s, e];
}

function parseSubs(raw: unknown): SubTrack[] {
  if (!Array.isArray(raw)) return [];
  const out: SubTrack[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item) out.push({ url: item });
      continue;
    }
    const url = item?.url || item?.file;
    if (typeof url !== "string" || !url) continue;
    if (item?.kind === "thumbnails") continue;
    const lang = item?.label || item?.lang || item?.language;
    out.push({ url, lang: typeof lang === "string" ? lang : undefined });
  }
  return out;
}

// ─── Public scrapers ───────────────────────────────────────────────────────────

async function fetchEpisode(slug: string, episodeNumber: string | number): Promise<any> {
  const data = await lookerFetch<{ episode?: any }>(
    `/api/anime/${slug}/episodes/${episodeNumber}`,
    slug,
  );
  return data.episode ?? {};
}

/**
 * Fetch stream sources for an episode and build a track for EVERY language the
 * episode exposes (JAPANESE/ENGLISH/HINDI/TAMIL/TELUGU/MALAYALAM …) plus
 * episode-level intro/outro/subtitles — all from a single API call.
 */
export async function scrapeStreamAllLangs(
  anilistId: string,
  episodeNumber: string | number,
  title: string,
  preferQuality = "1080p",
): Promise<AllLangsResult> {
  const slug = buildFullSlug(title, anilistId);
  const episode = await fetchEpisode(slug, episodeNumber);
  const rawServers: any[] = Array.isArray(episode.servers) ? episode.servers : [];

  const languages = listLanguages(rawServers);
  const tracks: Record<string, LangTrack> = {};
  for (const lang of languages) {
    tracks[lang] = buildLangTrack(rawServers, lang, preferQuality, false);
  }

  return {
    episodeNumber: typeof episodeNumber === "string" ? parseInt(episodeNumber, 10) : episodeNumber,
    slug,
    preferQuality,
    languages,
    tracks,
    intro: parseSkip(episode.introStart, episode.introEnd),
    outro: parseSkip(episode.outroStart, episode.outroEnd),
    subtitles: parseSubs(episode.subtitles),
  };
}
