import { Logger } from "../core/logger.js";
import { aniZipResponseSchema, mappingsSchema } from "./types.js";
import type { AniZipEpisode, AniZipResponse, ExternalMappings } from "./types.js";

const ANI_ZIP_BASE = "https://api.ani.zip";

type LookupParams = {
  mal_id?: number;
  anilist_id?: number;
  themoviedb_id?: number;
  imdb_id?: string;
  kitsu_id?: number;
  anidb_id?: number;
  anisearch_id?: number;
  livechart_id?: number;
};

export class AniZip {
  private static buildQuery(params: LookupParams): string {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length === 0) return "";
    return entries.map(([k, v]) => `${k}=${v}`).join("&");
  }

  static async getMappings(params: LookupParams): Promise<ExternalMappings | null> {
    try {
      const query = this.buildQuery(params);
      if (!query) return null;

      const res = await fetch(`${ANI_ZIP_BASE}/mappings?${query}`);
      if (!res.ok) {
        Logger.warn(`AniZip getMappings failed: ${res.status} ${res.statusText}`);
        return null;
      }

      const json = (await res.json()) as Record<string, unknown>;
      const parsed = mappingsSchema.safeParse(json?.mappings);

      if (!parsed.success) {
        Logger.warn(`AniZip getMappings: invalid mappings shape`);
        return null;
      }

      const d = parsed.data;
      // Arranged in the exact sequence requested
      return {
        animeplanet_id: d.animeplanet_id ?? null,
        kitsu_id: d.kitsu_id ?? null,
        mal_id: d.mal_id ?? null,
        type: d.type ?? null,
        anilist_id: d.anilist_id ?? null,
        anisearch_id: d.anisearch_id ?? null,
        anidb_id: d.anidb_id ?? null,
        notifymoe_id: d.notifymoe_id ?? null,
        livechart_id: d.livechart_id ?? null,
        thetvdb_id: d.thetvdb_id ?? null,
        imdb_id: d.imdb_id ?? null,
        themoviedb_id: d.themoviedb_id ?? null,
      };
    } catch (err) {
      Logger.warn(`AniZip getMappings error: ${String(err)}`);
      return null;
    }
  }

  static async getFullData(params: LookupParams): Promise<AniZipResponse | null> {
    try {
      const query = this.buildQuery(params);
      if (!query) return null;

      const res = await fetch(`${ANI_ZIP_BASE}/mappings?${query}`);
      if (!res.ok) {
        Logger.warn(`AniZip getFullData failed: ${res.status} ${res.statusText}`);
        return null;
      }

      const json = await res.json();
      const parsed = aniZipResponseSchema.safeParse(json);

      if (!parsed.success) {
        Logger.warn(`AniZip getFullData: invalid response shape`);
        return null;
      }

      const d = parsed.data;
      return {
        mappings: {
          // Arranged in the exact sequence requested
          animeplanet_id: d.mappings.animeplanet_id ?? null,
          kitsu_id: d.mappings.kitsu_id ?? null,
          mal_id: d.mappings.mal_id ?? null,
          type: d.mappings.type ?? null,
          anilist_id: d.mappings.anilist_id ?? null,
          anisearch_id: d.mappings.anisearch_id ?? null,
          anidb_id: d.mappings.anidb_id ?? null,
          notifymoe_id: d.mappings.notifymoe_id ?? null,
          livechart_id: d.mappings.livechart_id ?? null,
          thetvdb_id: d.mappings.thetvdb_id ?? null,
          imdb_id: d.mappings.imdb_id ?? null,
          themoviedb_id: d.mappings.themoviedb_id ?? null,
        },
        titles: d.titles as Record<string, string>,
        episodes: d.episodes as Record<string, AniZipEpisode>,
        episodeCount: d.episodeCount,
        specialCount: d.specialCount,
        images: d.images,
      };
    } catch (err) {
      Logger.warn(`AniZip getFullData error: ${String(err)}`);
      return null;
    }
  }

  static async getEpisodes(params: LookupParams): Promise<AniZipEpisode[] | null> {
    try {
      const full = await this.getFullData(params);
      if (!full) return null;
      return Object.values(full.episodes);
    } catch (err) {
      Logger.warn(`AniZip getEpisodes error: ${String(err)}`);
      return null;
    }
  }
}
