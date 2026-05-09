export interface HiAnimeCard {
  id: string;
  aniId: string | null;
  title: string;
  japaneseTitle: string | null;
  url: string;
  image: string | null;
  type: string;
  duration: string | null;
  rating: string | null;
  quality: string | null;
  sub: number;
  dub: number;
  episodes: number;
}

export interface HiAnimePagedResult<T> {
  currentPage: number;
  hasNextPage: boolean;
  totalPages: number;
  results: T[];
}

export interface HiAnimeSpotlight {
  id: string;
  aniId: string | null;
  rank: number | null;
  title: string;
  japaneseTitle: string | null;
  url: string;
  banner: string | null;
  description: string | null;
  type: string | null;
  duration: string | null;
  releaseDate: string | null;
  quality: string | null;
  sub: number;
  dub: number;
}

export interface HiAnimeHome {
  spotlight: HiAnimeSpotlight[];
  trending: HiAnimeCard[];
  latestUpdates: HiAnimeCard[];
  mostViewed: HiAnimeCard[];
}

export interface HiAnimeEpisode {
  id: string;
  number: number;
  title: string;
  isFiller: boolean;
  isSubbed: boolean;
  isDubbed: boolean;
  releaseDate: string | null;
  url: string;
}

export interface HiAnimeInfo {
  id: string;
  aniId: string;
  title: string;
  japaneseTitle: string | null;
  altTitles: string[];
  description: string | null;
  image: string | null;
  banner: string | null;
  url: string;
  type: string | null;
  status: string | null;
  season: string | null;
  duration: string | null;
  rating: string | null;
  quality: string | null;
  broadcast: string | null;
  startDate: string | null;
  endDate: string | null;
  year: number | null;
  episodeCount: number | null;
  sub: number;
  dub: number;
  hasSub: boolean;
  hasDub: boolean;
  subOrDub: "sub" | "dub" | "both";
  malId: string | null;
  anilistId: string | null;
  refScore: number | null;
  followedCount: string | null;
  genres: string[];
  studios: string[];
  producers: string[];
  countries: string[];
  tags: string[];
  episodes: HiAnimeEpisode[];
  recommendations: HiAnimeCard[];
}

export interface HiAnimeServer {
  name: string;
  url: string;
  isDub: boolean;
  intro: { start: number; end: number };
  outro: { start: number; end: number };
}
