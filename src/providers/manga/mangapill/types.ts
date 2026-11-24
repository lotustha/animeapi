// Shapes returned by the MangaPill routes. Another client is built against
// exactly these, so keep field names and nullability stable.

export interface MangaPillCard {
  id: string;
  slug: string;
  title: string;
  altTitle: string | null;
  cover: string;
  type: string | null;
  status: string | null;
  year: number | null;
}

export interface MangaPillRecentCard extends MangaPillCard {
  chapterId: string;
  chapterNumber: number | null;
  chapterTitle: string;
}

export interface MangaPillSearch {
  provider: "MangaPill";
  page: number;
  hasNextPage: boolean;
  results: MangaPillCard[];
}

export interface MangaPillHome {
  trending: MangaPillCard[];
  recent: MangaPillRecentCard[];
}

export interface MangaPillChapter {
  id: string;
  number: number | null;
  title: string;
}

export interface MangaPillDetail {
  id: string;
  slug: string;
  title: string;
  altTitle: string | null;
  cover: string;
  description: string;
  type: string | null;
  status: string | null;
  year: number | null;
  genres: string[];
  chapters: MangaPillChapter[];
}

export interface MangaPillRead {
  id: string;
  mangaId: string;
  number: number | null;
  title: string;
  pages: { index: number; url: string }[];
  imageHeaders: { Referer: string };
}

export interface MangaPillSearchFilters {
  q?: string;
  page?: number;
  type?: string;
  status?: string;
  genres?: string[];
}
