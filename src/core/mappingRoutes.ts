// common mapping routes — not tied to any provider, just AniZip lookups
// accessible at /mappings  from the root

import Elysia from "elysia";
import { AniZip } from "../anizip/index.js";

const mappingRoutes = new Elysia()
  // cross-platform ID mappings (MAL, AniList, TMDB, IMDB, Kitsu, etc.)
  .get(
    "/mappings",
    async ({ query }) => {
      // Extract any supported ID from the query string
      const params = {
        mal_id: query?.mal_id ? parseInt(String(query.mal_id), 10) : undefined,
        anilist_id: query?.anilist_id ? parseInt(String(query.anilist_id), 10) : undefined,
        kitsu_id: query?.kitsu_id ? parseInt(String(query.kitsu_id), 10) : undefined,
        anidb_id: query?.anidb_id ? parseInt(String(query.anidb_id), 10) : undefined,
        themoviedb_id: query?.themoviedb_id ? parseInt(String(query.themoviedb_id), 10) : undefined,
        imdb_id: query?.imdb_id ? String(query.imdb_id) : undefined,
      };

      // Check if at least one ID was provided
      if (Object.values(params).every((val) => val === undefined)) {
        return {
          error:
            "Provide at least one ID parameter (mal_id, anilist_id, kitsu_id, themoviedb_id, imdb_id, or anidb_id)",
        };
      }

      const mappings = await AniZip.getMappings(params);
      if (!mappings) {
        return { error: "No mappings found for the given ID" };
      }
      return mappings;
    },
    {
      detail: {
        tags: ["core"],
        summary: "Get Cross-Platform ID Mappings (MAL, AniList, TMDB, IMDB, Kitsu, etc.)",
      },
    },
  );

export { mappingRoutes };
