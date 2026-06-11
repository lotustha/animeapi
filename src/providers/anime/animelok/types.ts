// Shapes mirror src/providers/anime/anivid/types.ts (which mirrors animekai),
// so /anime/animelok/* is drop-in compatible with /anime/anivid and
// /anime/animekai — with extra fields for animelok's multi-audio support.

export interface AnimelokPagedResult<T> {
  currentPage: number;
  hasNextPage: boolean;
  totalPages: number;
  results: T[];
}

export interface AnimelokSearchItem {
  id: string;
  title: string;
  url?: string;
  image?: string;
  japaneseTitle?: string | null;
  type?: string;
  sub?: number;
  dub?: number;
  episodes?: number;
}

export interface AnimelokSuggestionItem extends AnimelokSearchItem {
  year?: string;
}

export interface AnimelokScheduleItem {
  id: string | undefined;
  title: string;
  japaneseTitle?: string | null;
  airingTime: string;
  airingEpisode: string;
}

export interface AnimelokRelatedItem {
  id: string;
  title: string;
  url?: string;
  image?: string;
  japaneseTitle?: string | null;
  type?: string;
  sub?: number;
  dub?: number;
  episodes?: number;
  relationType?: string;
}

export interface AnimelokEpisode {
  id: string;
  number: number;
  title: string;
  isFiller: boolean;
  isSubbed: boolean;
  isDubbed: boolean;
  url: string;
}

export interface AnimelokInfo {
  id: string;
  title: string;
  japaneseTitle?: string | null;
  image?: string;
  cover?: string | null;
  description?: string;
  type?: string;
  url?: string;
  totalEpisodes?: number;
  status?: string;
  season?: string;
  duration?: string;
  malId?: string;
  anilistId?: string;
  hasSub?: boolean;
  hasDub?: boolean;
  subOrDub?: "sub" | "dub" | "both";
  // Audio languages animelok can serve for this title (capability list, lower-
  // case, e.g. ["japanese","english","hindi",...]). Real per-episode languages
  // are confirmed at /watch and /servers.
  audioLanguages?: string[];
  genres?: string[];
  recommendations?: AnimelokRelatedItem[];
  relations?: AnimelokRelatedItem[];
  episodes: AnimelokEpisode[];
}

export interface AnimelokServer {
  name: string;
  // Frameable embed URL — animelok.online's own watch page for direct-HLS
  // servers, or the upstream embed player. Never a raw m3u8.
  url: string;
  isDub: boolean;
  // Audio language for this server (lower-case): japanese | english | hindi |
  // tamil | telugu | malayalam.
  lang?: string;
  intro: { start: number; end: number };
  outro: { start: number; end: number };
}

export interface AnimelokStreamSource {
  name: string;
  // Embed/iframe player URL (e.g. short.icu / zephyrflick) — used for languages
  // animelok only exposes as embeds (Hindi/Tamil/Telugu/Malayalam).
  iframe: string;
  // Direct HLS/MP4 streams. `quality` is animelok's label (1080p/720p/Multi…).
  // `file` is the raw m3u8 (client sends headers.Referer); `proxy` routes it
  // through our m3u8-proxy with the Referer injected server-side.
  sources: { file: string; type: string; quality?: string; proxy?: string }[];
  subtitles: { url?: string; lang?: string; type: string }[];
  download: string | null;
  // Audio language of this source (lower-case).
  lang?: string;
  headers?: Record<string, string>;
}

export interface AnimelokStreamResponse {
  isDub: boolean;
  results: AnimelokStreamSource[];
  // All audio languages available for this episode (lower-case).
  languages?: string[];
  intro?: [number, number];
  outro?: [number, number];
}
