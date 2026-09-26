import { z } from "zod";

// ─── Episode list embedded in the watch page ────────────────────────────────
// The page ships the whole episode list as a `const episodeItemsRaw = [...]`
// literal. `play_url` is usually "" on a cold item — the real URL only comes
// back from the refresh-source call, so it is not required here.
export const episodeItemSchema = z.object({
  id: z.number(),
  number: z.number(),
  route_episode_number: z.number().optional(),
  title: z.string().optional(),
  play_url: z.string().optional(),
  subtitle_url: z.string().nullish(),
  thumb_url: z.string().nullish(),
  is_playable: z.boolean().optional(),
  browser_prefetch_mode: z.string().nullish(),
});

export const episodeItemsSchema = z.array(episodeItemSchema);

// ─── refresh-source response (edge host) ────────────────────────────────────
export const refreshSourceSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  retryable: z.boolean().optional(),
  movie_id: z.number().optional(),
  episode_id: z.number().optional(),
  episode_number: z.number().optional(),
  play_url: z.string().optional(),
  direct_play_url: z.string().optional(),
  direct_play_is_hls: z.boolean().optional(),
  subtitle_url: z.string().optional(),
  direct_subtitle_url: z.string().optional(),
  multi_subtitles: z
    .array(z.object({ label: z.string().optional(), url: z.string().optional() }).loose())
    .optional(),
  multi_resolutions: z
    .array(z.object({ label: z.string().optional(), stream_url: z.string().optional() }).loose())
    .optional(),
});

export type RefreshSource = z.infer<typeof refreshSourceSchema>;

// ─── Provider explorer (/home/providers/sections) ───────────────────────────
// narto-drama aggregates ~41 upstream apps (iDrama, ReelShort, MoviBox, …) and
// exposes each one's own catalogue through this JSON endpoint.
export const providerSectionsSchema = z.object({
  ok: z.boolean().optional(),
  active_provider: z.string().nullish(),
  providers: z.array(z.object({ key: z.string(), label: z.string() })).default([]),
  sections: z
    .array(
      z.object({
        tab_key: z.string(),
        tab_label: z.string().optional(),
        page: z.number().optional(),
        has_prev: z.boolean().optional(),
        fallback: z.boolean().optional(),
        items: z
          .array(
            z.object({
              book_id: z.string(),
              title: z.string(),
              description: z.string().optional(),
              poster_url: z.string().optional(),
              watch_url: z.string().optional(),
              source_type: z.string().optional(),
              category_name: z.string().optional(),
              is_adult: z.boolean().optional(),
              tag_names: z.array(z.string()).default([]),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

export interface UpstreamProvider {
  key: string;
  label: string;
}

export interface ProviderItem {
  bookId: string;
  title: string;
  description: string;
  poster: string;
  provider: string;
  isAdult: boolean;
  tags: string[];
}

export interface ProviderSection {
  key: string;
  label: string;
  page: number;
  items: ProviderItem[];
}

export interface ProviderCatalogue {
  provider: string;
  providers: UpstreamProvider[];
  sections: ProviderSection[];
}

// ─── Public shapes ──────────────────────────────────────────────────────────
export interface DramaCard {
  id: string;
  title: string;
  url: string;
  poster: string;
}

export interface DramaEpisode {
  id: string;
  number: number;
  title: string;
  thumbnail: string;
  isPlayable: boolean;
}

export interface DramaInfo {
  id: string;
  title: string;
  /** Upstream app backing this title (idrama, melolo, reelshort, …). */
  provider?: string;
  url: string;
  poster: string;
  description: string;
  totalEpisodes: number;
  tags: string[];
  episodes: DramaEpisode[];
}

export interface DramaSubtitle {
  label: string;
  url: string;
}

export interface DramaSource {
  url: string;
  quality: string;
  isM3U8: boolean;
  /**
   * False when the URL points straight at the upstream CDN instead of this
   * server's proxy — the case for upstreams that geo-block the server itself.
   */
  proxied: boolean;
  /**
   * The upstream CDN URL, unwrapped.
   *
   * Always present, even when `url` is proxied, so a client can try the CDN
   * first and fall back to the proxy only if it actually fails. Measured on a
   * 353 KB segment: 0.12s direct against 1.83s through the proxy, and the
   * proxy also rewrites every segment URI in a playlist so the whole stream
   * funnels through this server. Going direct where it works is the single
   * largest playback win available.
   */
  directUrl: string;
}

export interface DramaStream {
  id: string;
  episode: number;
  /** Upstream app serving this title (idrama, melolo, reelshort, …). */
  provider: string;
  sources: DramaSource[];
  subtitles: DramaSubtitle[];
  /**
   * Which fallback rung served this episode, when narto's edge did not:
   * "listing" (the watch page's own list) or an alternate site's name
   * ("vibeshort", "reelall-dramabox", …). Absent when narto answered. Lets a
   * caller or the route cache treat a borrowed link differently (2026-09-26).
   */
  servedBy?: string;
}

export interface Paginated<T> {
  currentPage: number;
  hasNextPage: boolean;
  results: T[];
}
