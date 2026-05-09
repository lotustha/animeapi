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

export interface AnizenServer {
  name: string;
  url: string;
  isDub: boolean;
  intro: { start: number; end: number };
  outro: { start: number; end: number };
}

export interface AnizenStreamSource {
  name: string;
  iframe: string;
  sources: { file: string; type: string }[];
  subtitles: { url?: string; lang?: string; type: string }[];
  download: string | null;
}

export interface AnizenStreamResponse {
  isDub: boolean;
  results: AnizenStreamSource[];
  intro?: [number, number];
  outro?: [number, number];
}
