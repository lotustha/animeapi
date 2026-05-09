export interface AnizenPagedResult<T> {
  currentPage: number;
  hasNextPage: boolean;
  totalPages: number;
  results: T[];
}

export interface AnizenSearchItem {
  id: string;
  dataId?: string | null;
  title: string;
  japaneseTitle?: string | null;
  image?: string | null;
  url?: string;
  type?: string | null;
  duration?: string | null;
  sub: number;
  dub: number;
  episodes: number;
}

export interface AnizenSpotlightItem {
  id: string;
  dataId?: string | null;
  rank: number | null;
  title: string;
  japaneseTitle?: string | null;
  description?: string | null;
  banner?: string | null;
  url: string;
  type?: string | null;
  duration?: string | null;
  releaseDate?: string | null;
  quality?: string | null;
  sub: number;
  dub: number;
}

export interface AnizenScheduleItem {
  id: string;
  dataId?: string | null;
  title: string;
  japaneseTitle?: string | null;
  airingTime: string;
  airingEpisode: string;
  releaseDate?: string | null;
  poster?: string | null;
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
  dataId?: string | null;
  malId?: string | null;
  anilistId?: string | null;
  title: string;
  japaneseTitle?: string | null;
  synonyms?: string | null;
  image?: string | null;
  description?: string | null;
  type?: string | null;
  url?: string;
  status?: string | null;
  season?: string | null;
  duration?: string | null;
  quality?: string | null;
  rating?: string | null;
  airedDate?: string | null;
  totalEpisodes: number;
  sub: number;
  dub: number;
  hasSub: boolean;
  hasDub: boolean;
  subOrDub: "sub" | "dub" | "both";
  genres: string[];
  studios: string[];
  producers: string[];
  recommendations: AnizenSearchItem[];
  seasons: AnizenSeasonItem[];
  episodes: AnizenEpisode[];
}

export interface AnizenSeasonItem {
  id: string;
  dataId?: string | number | null;
  number?: number | null;
  season: string;
  title: string;
  poster?: string | null;
}

export interface AnizenServer {
  name: string;
  url: string;
  isDub: boolean;
  type: "sub" | "dub";
}

export interface AnizenStreamSource {
  name: string;
  iframe: string;
  file?: string | null;
  type?: string | null;
  isDub: boolean;
}

export interface AnizenStreamResponse {
  isDub: boolean;
  results: AnizenStreamSource[];
  intro?: [number, number] | null;
  outro?: [number, number] | null;
}
