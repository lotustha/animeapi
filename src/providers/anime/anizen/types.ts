// Shapes here intentionally mirror src/providers/anime/animekai/types.ts so
// /anime/anizen/* responses are drop-in-compatible with /anime/animekai/*.

export interface AnizenPagedResult<T> {
  currentPage: number;
  hasNextPage: boolean;
  totalPages: number;
  results: T[];
}

export interface AnizenSearchItem {
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

export interface AnizenSuggestionItem extends AnizenSearchItem {
  year?: string;
}

export interface AnizenSpotlightItem {
  id: string;
  title: string;
  japaneseTitle?: string | null;
  banner: string | null;
  url: string;
  type: string;
  genres: string[];
  releaseDate: string;
  quality: string;
  sub: number;
  dub: number;
  description: string;
}

export interface AnizenScheduleItem {
  id: string | undefined;
  title: string;
  japaneseTitle?: string | null;
  airingTime: string;
  airingEpisode: string;
}

export interface AnizenRelatedItem {
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

export interface AnizenEpisode {
  id: string;
  number: number;
  title: string;
  isFiller: boolean;
  isSubbed: boolean;
  isDubbed: boolean;
  url: string;
}

export interface AnizenInfo {
  id: string;
  title: string;
  japaneseTitle?: string | null;
  image?: string;
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
  genres?: string[];
  recommendations?: AnizenRelatedItem[];
  relations?: AnizenRelatedItem[];
  episodes: AnizenEpisode[];
}

// Audio-track types the upstream /api/stream endpoint accepts. "hindi" and
// "hsub" (hardsubbed) were added when anizen started carrying Hindi dubs.
export type AnizenAudioType = "sub" | "dub" | "hindi" | "hsub";

// Route-level ?type= tokens. "softsub"/"hardsub" are legacy aliases that both
// map to upstream "sub" (historical behavior, kept for existing clients).
export type AnizenTypeParam = "sub" | "softsub" | "dub" | "hardsub" | "hindi" | "hsub";

export interface AnizenServer {
  name: string;
  url: string;
  isDub: boolean;
  intro: { start: number; end: number };
  outro: { start: number; end: number };
}

// One rendition from an HLS master playlist. `file` points at that rendition's
// media playlist and is directly playable/downloadable on its own — clients can
// hand it to a native HLS downloader (e.g. ExoPlayer's DownloadManager).
// Only resolutions the upstream actually publishes appear here; the list is
// empty when the stream ships a single quality.
export interface AnizenQuality {
  label: string;
  width?: number;
  height?: number;
  bandwidth?: number;
  file: string;
}

export interface AnizenStreamSource {
  name: string;
  iframe: string;
  sources: { file: string; type: string }[];
  qualities?: AnizenQuality[];
  subtitles: { url?: string; lang?: string; type: string }[];
  download: string | null;
  // HTTP headers the client MUST send when fetching `sources[].file` and its
  // segments. Some CDNs (megaplay/megacloud) hard-check Referer and return
  // 403 otherwise. ExoPlayer/Media3 on Android can inject these directly.
  headers?: Record<string, string>;
}

export interface AnizenStreamResponse {
  isDub: boolean;
  results: AnizenStreamSource[];
  intro?: [number, number];
  outro?: [number, number];
}
