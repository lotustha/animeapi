import { z } from "zod";

// ─── External ID Mappings ───────────────────────────────────────────────────

export interface ExternalMappings {
  mal_id: number | null;
  anilist_id: number | null;
  themoviedb_id: string | null;
  imdb_id: string | null;
  thetvdb_id: number | null;
  kitsu_id: number | null;
  anidb_id: number | null;
  anisearch_id: number | null;
  livechart_id: number | null;
  animeplanet_id: string | null;
  notifymoe_id: string | null;
  type?: string | null;
}

// ─── Episode Metadata ───────────────────────────────────────────────────────

export interface AniZipEpisode {
  tvdbShowId: number | null;
  tvdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
  title: Record<string, string>;
  airDate: string | null;
  airDateUtc: string | null;
  runtime: number | null;
  overview: string | null;
  image: string | null;
  length: number | null;
  rating: string | null;
  summary: string | null;
}

// ─── Full Response ──────────────────────────────────────────────────────────

export interface AniZipResponse {
  mappings: ExternalMappings;
  titles: Record<string, string>;
  episodes: Record<string, AniZipEpisode>;
  episodeCount: number;
  specialCount: number;
  images: Array<{ coverType: string; url: string }>;
}

// ─── Zod Schemas ────────────────────────────────────────────────────────────

export const mappingsSchema = z
  .object({
    mal_id: z.number().nullable().optional(),
    anilist_id: z.number().nullable().optional(),
    themoviedb_id: z.string().nullable().optional(),
    imdb_id: z.string().nullable().optional(),
    thetvdb_id: z.number().nullable().optional(),
    kitsu_id: z.number().nullable().optional(),
    anidb_id: z.number().nullable().optional(),
    anisearch_id: z.number().nullable().optional(),
    livechart_id: z.number().nullable().optional(),
    animeplanet_id: z.string().nullable().optional(),
    notifymoe_id: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
  })
  .passthrough();

const episodeSchema = z
  .object({
    tvdbShowId: z.number().nullable().optional(),
    tvdbId: z.number().nullable().optional(),
    seasonNumber: z.number().nullable().optional(),
    episodeNumber: z.number().nullable().optional(),
    absoluteEpisodeNumber: z.number().nullable().optional(),
    title: z.record(z.string(), z.string().nullable()).optional().default({}),
    airDate: z.string().nullable().optional(),
    airDateUtc: z.string().nullable().optional(),
    runtime: z.number().nullable().optional(),
    overview: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
    length: z.number().nullable().optional(),
    rating: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
  })
  .passthrough();

export const aniZipResponseSchema = z
  .object({
    mappings: mappingsSchema,
    titles: z.record(z.string(), z.string().nullable()).optional().default({}),
    episodes: z.record(z.string(), episodeSchema).optional().default({}),
    episodeCount: z.number().optional().default(0),
    specialCount: z.number().optional().default(0),
    images: z
      .array(z.object({ coverType: z.string(), url: z.string() }))
      .optional()
      .default([]),
  })
  .passthrough();
