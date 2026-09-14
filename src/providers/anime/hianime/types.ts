/** hianime.at exposes only sub and dub tiers; the old softsub tier is gone. */
export type HiAnimeAudioType = "sub" | "dub";

/** Accepted on the wire. "hardsub"/"softsub" are legacy aliases that map to "sub". */
export type HiAnimeTypeParam = HiAnimeAudioType | "hardsub" | "softsub";

export interface HiAnimeCard {
  /** URL slug, e.g. "bleach-1369". Always ends in the numeric id. */
  id: string;
  /** Numeric site id, e.g. "1369" — the key /api/theme endpoints use. */
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
  /** Composite id accepted by /watch and /servers: `<slug>$ep=<episodeId>`. */
  id: string;
  /** Bare numeric episode id, unrelated to the anime's own id. */
  episodeId: string;
  number: number;
  title: string;
  japaneseTitle: string | null;
  isFiller: boolean;
  isSubbed: boolean;
  isDubbed: boolean;
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
  score: string | null;
  genres: string[];
  studios: string[];
  producers: string[];
  episodes: HiAnimeEpisode[];
  recommendations: HiAnimeCard[];
}

export interface HiAnimeServer {
  name: string;
  /** Third-party embed URL, decoded from the site's base64 `data-hash`. */
  url: string;
  type: string;
  isDub: boolean;
  /** Headers the embed host requires; clients must replay these. */
  headers: Record<string, string>;
}
