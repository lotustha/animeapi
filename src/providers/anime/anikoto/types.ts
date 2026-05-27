import { z } from "zod";

// ─── Paged Result Wrapper ────────────────────────────────────────────────────

export interface AnikotoPagedResult<T> {
  currentPage: number;
  hasNextPage: boolean;
  totalPages: number;
  results: T[];
}

// ─── Search / Card Item ──────────────────────────────────────────────────────

export const anikotoSearchItemSchema = z.object({
  id: z.string(),
  aniId: z.string().optional().nullable(),
  title: z.string(),
  url: z.string(),
  image: z.string().optional().nullable(),
  japaneseTitle: z.string().optional().nullable(),
  type: z.string().optional(),
  rating: z.string().optional().nullable(),
  sub: z.number().optional(),
  dub: z.number().optional(),
  episodes: z.number().optional(),
});

export type AnikotoSearchItem = z.infer<typeof anikotoSearchItemSchema>;

// ─── Related / Recommendation Item ───────────────────────────────────────────

export const anikotoRelatedItemSchema = anikotoSearchItemSchema.extend({
  relationType: z.string().optional(),
});

export type AnikotoRelatedItem = z.infer<typeof anikotoRelatedItemSchema>;

// ─── Anime Info ──────────────────────────────────────────────────────────────

export const anikotoInfoSchema = z.object({
  id: z.string(),
  aniId: z.string().optional().nullable(),
  title: z.string(),
  japaneseTitle: z.string().optional().nullable(),
  synonyms: z.array(z.string()).optional(),
  image: z.string().optional().nullable(),
  description: z.string().optional(),
  type: z.string().optional(),
  url: z.string().optional(),
  totalEpisodes: z.number().optional(),
  status: z.string().optional(),
  season: z.string().optional(),
  aired: z.string().optional(),
  duration: z.string().optional(),
  score: z.string().optional(),
  studios: z.array(z.string()).optional(),
  producers: z.array(z.string()).optional(),
  malId: z.string().optional(),
  anilistId: z.string().optional(),
  hasSub: z.boolean().optional(),
  hasDub: z.boolean().optional(),
  subOrDub: z.enum(["sub", "dub", "both"]).optional(),
  genres: z.array(z.string()).optional(),
  recommendations: z.array(anikotoRelatedItemSchema).optional(),
  episodes: z.array(
    z.object({
      id: z.string(),
      number: z.number(),
      title: z.string(),
      isFiller: z.boolean(),
      isSubbed: z.boolean(),
      isDubbed: z.boolean(),
      url: z.string(),
    }),
  ),
});

export type AnikotoInfo = z.infer<typeof anikotoInfoSchema>;
export type AnikotoEpisode = AnikotoInfo["episodes"][number];

// ─── Episode Server ──────────────────────────────────────────────────────────

export interface AnikotoServer {
  name: string;
  url: string;
  isDub: boolean;
  intro: { start: number; end: number };
  outro: { start: number; end: number };
}

// ─── Stream Source ───────────────────────────────────────────────────────────

export interface AnikotoStreamSource {
  name: string;
  iframe: string;
  sources: { file: string; type: string }[];
  subtitles: { url?: string; lang?: string; type?: string }[];
  download: string | null;
  headers?: Record<string, string>;
}
