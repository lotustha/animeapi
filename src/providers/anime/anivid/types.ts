// Shapes mirror src/providers/anime/anizen/types.ts (which itself mirrors
// animekai), so /anime/anivid/* is drop-in compatible with /anime/anizen/*.

export interface AnividPagedResult<T> {
  currentPage: number;
  hasNextPage: boolean;
  totalPages: number;
  results: T[];
}

export interface AnividSearchItem {
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

export interface AnividSuggestionItem extends AnividSearchItem {
  year?: string;
}

export interface AnividScheduleItem {
  id: string | undefined;
  title: string;
  japaneseTitle?: string | null;
  airingTime: string;
  airingEpisode: string;
}

export interface AnividRelatedItem {
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

export interface AnividEpisode {
  id: string;
  number: number;
  title: string;
  isFiller: boolean;
  isSubbed: boolean;
  isDubbed: boolean;
  url: string;
}

export interface AnividInfo {
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
  genres?: string[];
  recommendations?: AnividRelatedItem[];
  relations?: AnividRelatedItem[];
  episodes: AnividEpisode[];
}

export interface AnividServer {
  name: string;
  url: string;
  isDub: boolean;
  intro: { start: number; end: number };
  outro: { start: number; end: number };
  // `url` is the /proxy/embed wrapper page (same embed /watch returns), ready
  // to frame directly in a webview — not a raw m3u8.
}

export interface AnividStreamSource {
  name: string;
  // /proxy/embed wrapper URL — an HTML page on our server that frames the
  // vidnest player, ready to load directly in a webview.
  iframe: string;
  // file = raw m3u8 (CDN serves the client directly; player must send
  // headers.Referer). proxy = same stream via our m3u8-proxy (Referer injected
  // server-side, no client headers needed, but uses our bandwidth).
  sources: { file: string; type: string; proxy?: string }[];
  subtitles: { url?: string; lang?: string; type: string }[];
  download: string | null;
  // HTTP headers the client MUST send when fetching `sources[].file` and its
  // segments. VidNest CDNs hard-check Referer; ExoPlayer/Media3 on Android
  // can inject these directly so no server-side proxying is needed.
  headers?: Record<string, string>;
}

export interface AnividStreamResponse {
  isDub: boolean;
  results: AnividStreamSource[];
  intro?: [number, number];
  outro?: [number, number];
}
