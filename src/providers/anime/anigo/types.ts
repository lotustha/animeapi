import { z } from "zod";

// ─── Paged Result Wrapper ────────────────────────────────────────────────────

export interface AnigoPagedResult<T> {
  currentPage: number;
  hasNextPage: boolean;
  totalPages: number;
  results: T[];
}

// ─── Search Item ─────────────────────────────────────────────────────────────

export const anigoSearchItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  image: z.string().optional(),
  japaneseTitle: z.string().optional().nullable(),
  type: z.string().optional(),
  sub: z.number().optional(),
  dub: z.number().optional(),
  episodes: z.number().optional(),
});

export type AnigoSearchItem = z.infer<typeof anigoSearchItemSchema>;

// ─── Related / Recommendation Item ───────────────────────────────────────────

export const anigoRelatedItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().optional(),
  image: z.string().optional(),
  japaneseTitle: z.string().optional().nullable(),
  type: z.string().optional(),
  sub: z.number().optional(),
  dub: z.number().optional(),
  episodes: z.number().optional(),
  relationType: z.string().optional(),
});

export type AnigoRelatedItem = z.infer<typeof anigoRelatedItemSchema>;

// ─── Anime Info ───────────────────────────────────────────────────────────────

export const anigoInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  japaneseTitle: z.string().optional().nullable(),
  image: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  url: z.string().optional(),
  totalEpisodes: z.number().optional(),
  status: z.string().optional(),
  season: z.string().optional(),
  duration: z.string().optional(),
  malId: z.string().optional(),
  anilistId: z.string().optional(),
  hasSub: z.boolean().optional(),
  hasDub: z.boolean().optional(),
  subOrDub: z.enum(["sub", "dub", "both"]).optional(),
  genres: z.array(z.string()).optional(),
  recommendations: z.array(anigoRelatedItemSchema).optional(),
  relations: z.array(anigoRelatedItemSchema).optional(),
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

export type AnigoInfo = z.infer<typeof anigoInfoSchema>;
export type AnigoEpisode = AnigoInfo["episodes"][number];

// ─── Episode Server ───────────────────────────────────────────────────────────

export interface AnigoServer {
  name: string;
  url: string;
  isDub: boolean;
  intro: { start: number; end: number };
  outro: { start: number; end: number };
}
