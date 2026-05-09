import { Elysia } from "elysia";
import { animekaiRoutes } from "./animekai/route.js";
import { animepaheRoutes } from "./animepahe/route.js";
import { toonstreamRoutes } from "./toonstream/route.js";
import { animesaltRoutes } from "./animesalt/route.js";

import { anigoRoutes } from "./anigo/route.js";
import { hianimeRoutes } from "./hianime/route.js";

export const animeRoutes = new Elysia({ prefix: "/anime" })
  .use(animepaheRoutes)
  .use(animekaiRoutes)
  .use(toonstreamRoutes)
  .use(animesaltRoutes)
  .use(anigoRoutes)
  .use(hianimeRoutes)

  // ─── Overview Endpoint ────────────────────────────────────────────────────────
  .get(
    "/",
    () => ({
      service: "anime",
      description: "Unified anime API — provider-isolated route architecture",
      providers: ["animepahe", "animekai", "toonstream", "animesalt", "anigo", "hianime"],
      endpoints: {
        animepahe: [
          "GET /anime/animepahe/search/:query         → Search titles",
          "GET /anime/animepahe/latest                → Latest updated titles",
          "GET /anime/animepahe/info/:id              → Full title details",
          "GET /anime/animekai/episodes/:id           → Episode list",
          "GET /anime/animekai/episode/:id/:session   → Stream results",
        ],
        anigo: [
          "GET /anime/anigo/search/:query          → Paginated search",
          "GET /anime/anigo/spotlight              → Spotlight anime",
          "GET /anime/anigo/schedule/:date         → Airing schedule (YYYY-MM-DD)",
          "GET /anime/anigo/suggestions/:query     → Search suggestions",
          "GET /anime/anigo/recent-episodes        → Recently updated episodes",
          "GET /anime/anigo/recent-added           → Recently added series",
          "GET /anime/anigo/completed              → Latest completed series",
          "GET /anime/anigo/new-releases           → New releases",
          "GET /anime/anigo/movies                 → Movies",
          "GET /anime/anigo/tv                     → TV Series",
          "GET /anime/anigo/ova                    → OVAs",
          "GET /anime/anigo/ona                    → ONAs",
          "GET /anime/anigo/specials               → Specials",
          "GET /anime/anigo/genres                 → Available genres",
          "GET /anime/anigo/genre/:genre           → Browse by genre",
          "GET /anime/anigo/info/:id               → Full title details",
          "GET /anime/anigo/watch/:episodeId       → Watch / stream sources",
          "GET /anime/anigo/servers/:episodeId     → Episode servers",
        ],
        toonstream: [
          "GET /anime/animekai/search/:query          → Paginated search",
          "GET /anime/animekai/spotlight              → Spotlight anime",
          "GET /anime/animekai/schedule/:date         → Airing schedule (YYYY-MM-DD)",
          "GET /anime/animekai/suggestions/:query     → Search suggestions",
          "GET /anime/animekai/recent-episodes        → Recently updated episodes",
          "GET /anime/animekai/recent-added           → Recently added series",
          "GET /anime/animekai/completed              → Latest completed series",
          "GET /anime/animekai/new-releases           → New anime releases",
          "GET /anime/animekai/movies                 → Browse anime movies",
          "GET /anime/animekai/tv                     → Browse TV series",
          "GET /anime/animekai/ova                    → Browse OVA",
          "GET /anime/animekai/ona                    → Browse ONA",
          "GET /anime/animekai/specials               → Browse specials",
          "GET /anime/animekai/genres                 → List all genres",
          "GET /anime/animekai/genre/:genre           → Search by genre",
          "GET /anime/animekai/info?id=               → Full anime info + episodes",
          "GET /anime/animekai/watch/:episodeId       → Stream sources (query: dub)",
          "GET /anime/animekai/servers/:episodeId     → Episode servers (query: dub)",
        ],

        animesalt: [
          "GET /anime/animesalt/home                           → Home page (featured + recent)",
          "GET /anime/animesalt/search/:query/:page?           → Search titles",
          "GET /anime/animesalt/category/*[:page]              → Browse categories (recursive types)",
          "GET /anime/animesalt/movies/:page?                  → Browse movies",
          "GET /anime/animesalt/movies/info/:slug              → Movie details",
          "GET /anime/animesalt/movies/sources/:slug           → Movie stream sources",
          "GET /anime/animesalt/series/:page?                  → Browse series",
          "GET /anime/animesalt/series/info/:slug              → Series details + episodes",
          "GET /anime/animesalt/episode/sources/:slug          → Episode stream sources",
          "GET /anime/animesalt/m3u8-proxy?url=&headers=       → HLS playlist proxy",
          "GET /anime/animesalt/ts-segment?url=&headers=       → TS segment proxy",
          "GET /anime/animesalt/mp4-proxy?url=&headers=        → MP4 video proxy",
          "GET /anime/animesalt/fetch?url=&headers=            → Generic media fetch proxy",
        ],

        hianime: [
          "GET /anime/hianime/home                  → Home page (spotlight, trending, latest, most-viewed)",
          "GET /anime/hianime/search/:query?page=N  → Paginated search",
          "GET /anime/hianime/suggestions/:query    → Search suggestions (autocomplete)",
          "GET /anime/hianime/recent-episodes?page= → Recently updated episodes",
          "GET /anime/hianime/recent-added?page=    → Recently added series",
          "GET /anime/hianime/completed?page=       → Latest completed series",
          "GET /anime/hianime/new-releases?page=    → New releases",
          "GET /anime/hianime/movies?page=          → Movies",
          "GET /anime/hianime/tv?page=              → TV Series",
          "GET /anime/hianime/ova?page=             → OVAs",
          "GET /anime/hianime/ona?page=             → ONAs",
          "GET /anime/hianime/specials?page=        → Specials",
          "GET /anime/hianime/genres                → Available genres",
          "GET /anime/hianime/genre/:genre?page=    → Browse by genre",
          "GET /anime/hianime/info/:id              → Full title details + episodes (JSON API)",
          "GET /anime/hianime/servers/:episodeId    → Episode servers (query: type=hardsub|softsub|dub)",
          "GET /anime/hianime/watch/:episodeId      → Decrypted m3u8 sources + subtitles + intro/outro skip (query: type)",
        ],
      },
    }),
    {
      detail: { tags: ["anime"], summary: "Anime API Overview" },
    },
  );
