// Shapes mirror src/providers/anime/anikoto/types.ts so /anime/aniwaves/* is
// drop-in compatible with the other hianime-style providers.

export interface AniwavesPagedResult<T> {
  currentPage: number;
  hasNextPage: boolean;
  totalPages: number;
  results: T[];
}

export interface AniwavesSearchItem {
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

export interface AniwavesSuggestionItem extends AniwavesSearchItem {
  year?: string;
}

export interface AniwavesScheduleItem {
  id: string | undefined;
  title: string;
  japaneseTitle?: string | null;
  airingTime: string;
  airingEpisode: string;
}

export interface AniwavesRelatedItem {
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

export interface AniwavesEpisode {
  id: string;
  number: number;
  title: string;
  isFiller: boolean;
  isSubbed: boolean;
  isDubbed: boolean;
  url: string;
}

export interface AniwavesInfo {
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
  hasSub?: boolean;
  hasDub?: boolean;
  subOrDub?: "sub" | "dub" | "both";
  genres?: string[];
  recommendations?: AniwavesRelatedItem[];
  relations?: AniwavesRelatedItem[];
  episodes: AniwavesEpisode[];
}

export interface AniwavesServer {
  name: string;
  url: string;
  isDub: boolean;
  // Audio/sub variant: sub (hardsub) | softsub | dub.
  type?: string;
  intro: { start: number; end: number };
  outro: { start: number; end: number };
}

export interface AniwavesStreamSource {
  name: string;
  // Embed player URL (weneverbeenfree / megacloud-family) — framable, used as
  // the iframe. m3u8 extraction from the embed is a follow-up.
  iframe: string;
  type?: string;
  sources: { file: string; type: string }[];
  subtitles: { url?: string; lang?: string; type: string }[];
  download: string | null;
  // Headers the client must send when loading `iframe`. The embed hosts gate on
  // the aniwaves Referer, so the webview must send it or the player won't load.
  headers?: Record<string, string>;
}

export interface AniwavesStreamResponse {
  isDub: boolean;
  results: AniwavesStreamSource[];
  intro?: [number, number];
  outro?: [number, number];
}
