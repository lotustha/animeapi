import { Elysia } from "elysia";
import { animekaiRoutes } from "./animekai/route.js";
import { animepaheRoutes } from "./animepahe/route.js";
import { toonstreamRoutes } from "./toonstream/route.js";
import { animesaltRoutes } from "./animesalt/route.js";

import { anigoRoutes } from "./anigo/route.js";
import { hianimeRoutes } from "./hianime/route.js";
import { anizenRoutes } from "./anizen/route.js";
import { anividRoutes } from "./anivid/route.js";
import { anikotoRoutes } from "./anikoto/route.js";
import { animelokRoutes } from "./animelok/route.js";
import { aniwavesRoutes } from "./aniwaves/route.js";

export const animeRoutes = new Elysia({ prefix: "/anime" })
  .use(animepaheRoutes)
  .use(animekaiRoutes)
  .use(toonstreamRoutes)
  .use(animesaltRoutes)
  .use(anigoRoutes)
  .use(hianimeRoutes)
  .use(anizenRoutes)
  .use(anividRoutes)
  .use(anikotoRoutes)
  .use(animelokRoutes)
  .use(aniwavesRoutes)

  // ─── Overview Endpoint ────────────────────────────────────────────────────────
  .get(
    "/",
    () => ({
      service: "anime",
      description: "Unified anime API — provider-isolated route architecture",
      providers: [
        "animepahe",
        "animekai",
        "toonstream",
        "animesalt",
        "anigo",
        "hianime",
        "anizen",
        "anivid",
        "anikoto",
        "animelok",
        "aniwaves",
      ],
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
          "GET /anime/hianime/spotlight             → Spotlight anime",
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

        anizen: [
          "GET /anime/anizen/search/:query          → Paginated search",
          "GET /anime/anizen/spotlight              → Spotlight anime",
          "GET /anime/anizen/schedule/:date         → Airing schedule (YYYY-MM-DD)",
          "GET /anime/anizen/suggestions/:query     → Search suggestions",
          "GET /anime/anizen/recent-episodes        → Recently updated episodes",
          "GET /anime/anizen/recent-added           → Recently added series",
          "GET /anime/anizen/completed              → Latest completed series",
          "GET /anime/anizen/new-releases           → New releases",
          "GET /anime/anizen/movies                 → Movies",
          "GET /anime/anizen/tv                     → TV Series",
          "GET /anime/anizen/ova                    → OVAs",
          "GET /anime/anizen/ona                    → ONAs",
          "GET /anime/anizen/specials               → Specials",
          "GET /anime/anizen/genres                 → Available genres",
          "GET /anime/anizen/genre/:genre           → Browse by genre",
          "GET /anime/anizen/info/:id               → Full title details + episodes (JSON API)",
          "GET /anime/anizen/watch/:episodeId       → Stream sources (query: type=sub|dub)",
          "GET /anime/anizen/servers/:episodeId     → Episode servers (query: type)",
        ],

        anivid: [
          "GET /anime/anivid/search/:query          → Paginated search (AniList GraphQL)",
          "GET /anime/anivid/suggestions/:query     → Search suggestions",
          "GET /anime/anivid/spotlight              → Spotlight anime (trending + banner)",
          "GET /anime/anivid/recent-episodes        → Recently aired episodes",
          "GET /anime/anivid/recent-added           → Recently added series",
          "GET /anime/anivid/completed              → Latest completed series",
          "GET /anime/anivid/new-releases           → New releases",
          "GET /anime/anivid/movies                 → Movies",
          "GET /anime/anivid/tv                     → TV Series",
          "GET /anime/anivid/ova                    → OVAs",
          "GET /anime/anivid/ona                    → ONAs",
          "GET /anime/anivid/specials               → Specials",
          "GET /anime/anivid/trending               → Trending anime",
          "GET /anime/anivid/popular                → Most popular",
          "GET /anime/anivid/top-rated              → Highest rated",
          "GET /anime/anivid/seasonal               → Current season",
          "GET /anime/anivid/upcoming               → Not yet released",
          "GET /anime/anivid/schedule/:date         → Airing schedule (YYYY-MM-DD, UTC)",
          "GET /anime/anivid/genres                 → Available genres",
          "GET /anime/anivid/genre/:genre           → Browse by genre",
          "GET /anime/anivid/info/:id               → Full title details + episodes (id = AniList ID)",
          "GET /anime/anivid/watch/:episodeId       → vidnest.fun iframe + m3u8 (query: type=sub|dub)",
          "GET /anime/anivid/servers/:episodeId     → Episode servers (query: type)",
        ],

        anikoto: [
          "GET /anime/anikoto/search/:query          → Paginated search",
          "GET /anime/anikoto/spotlight              → Spotlight anime",
          "GET /anime/anikoto/schedule/:date         → Airing schedule (YYYY-MM-DD)",
          "GET /anime/anikoto/suggestions/:query     → Search suggestions",
          "GET /anime/anikoto/recent-episodes        → Recently updated episodes",
          "GET /anime/anikoto/recent-added           → Recently added series",
          "GET /anime/anikoto/completed              → Latest completed series",
          "GET /anime/anikoto/new-releases           → New releases",
          "GET /anime/anikoto/most-viewed            → Most viewed series",
          "GET /anime/anikoto/movies                 → Movies",
          "GET /anime/anikoto/tv                     → TV Series",
          "GET /anime/anikoto/ova                    → OVAs",
          "GET /anime/anikoto/ona                    → ONAs",
          "GET /anime/anikoto/specials               → Specials",
          "GET /anime/anikoto/genres                 → Available genres",
          "GET /anime/anikoto/genre/:genre           → Browse by genre",
          "GET /anime/anikoto/info/:id               → Full title details + episodes",
          "GET /anime/anikoto/watch/:episodeId       → Decrypted m3u8 sources + Referer header (query: type=sub|dub)",
          "GET /anime/anikoto/servers/:episodeId     → Episode servers (query: type)",
        ],

        animelok: [
          "GET /anime/animelok/search/:query          → Paginated search (Jikan + AniList GraphQL)",
          "GET /anime/animelok/suggestions/:query     → Search suggestions",
          "GET /anime/animelok/spotlight              → Spotlight anime (trending + banner)",
          "GET /anime/animelok/recent-episodes        → Recently aired episodes",
          "GET /anime/animelok/recent-added           → Recently added series",
          "GET /anime/animelok/completed              → Latest completed series",
          "GET /anime/animelok/new-releases           → New releases",
          "GET /anime/animelok/movies                 → Movies",
          "GET /anime/animelok/tv                     → TV Series",
          "GET /anime/animelok/ova                    → OVAs",
          "GET /anime/animelok/ona                    → ONAs",
          "GET /anime/animelok/specials               → Specials",
          "GET /anime/animelok/trending               → Trending anime",
          "GET /anime/animelok/popular                → Most popular",
          "GET /anime/animelok/top-rated              → Highest rated",
          "GET /anime/animelok/seasonal               → Current season",
          "GET /anime/animelok/upcoming               → Not yet released",
          "GET /anime/animelok/schedule/:date         → Airing schedule (YYYY-MM-DD, UTC)",
          "GET /anime/animelok/genres                 → Available genres",
          "GET /anime/animelok/genre/:genre           → Browse by genre",
          "GET /anime/animelok/info/:id               → Full title details + episodes (id = AniList ID)",
          "GET /anime/animelok/watch/:episodeId       → Multi-audio streams (query: type=sub|dub|hindi|tamil|telugu|malayalam)",
          "GET /anime/animelok/servers/:episodeId     → Episode servers, all audio languages tagged",
          "GET /anime/animelok/player/:episodeId      → Self-hosted hls.js player page (iframe target; query: type)",
        ],

        aniwaves: [
          "GET /anime/aniwaves/search/:query          → Paginated search",
          "GET /anime/aniwaves/suggestions/:query     → Search suggestions",
          "GET /anime/aniwaves/spotlight              → Top anime ranked list (query: period=day|week|month)",
          "GET /anime/aniwaves/recent-episodes        → Recently updated episodes",
          "GET /anime/aniwaves/recent-added           → Recently added",
          "GET /anime/aniwaves/newest                 → Newest",
          "GET /anime/aniwaves/ongoing                → Ongoing",
          "GET /anime/aniwaves/most-popular           → Most popular",
          "GET /anime/aniwaves/top-airing             → Top airing",
          "GET /anime/aniwaves/completed              → Completed series",
          "GET /anime/aniwaves/movies                 → Movies",
          "GET /anime/aniwaves/tv                     → TV series",
          "GET /anime/aniwaves/ova                    → OVAs",
          "GET /anime/aniwaves/ona                    → ONAs",
          "GET /anime/aniwaves/specials               → Specials",
          "GET /anime/aniwaves/music                  → Music videos",
          "GET /anime/aniwaves/genre/:genre           → Browse by genre",
          "GET /anime/aniwaves/info/:id               → Full title details + episodes (id = slug-id)",
          "GET /anime/aniwaves/watch/:episodeId       → Framable embed iframe + intro/outro (query: type=sub|softsub|dub)",
          "GET /anime/aniwaves/servers/:episodeId     → Episode servers (query: type)",
        ],
      },
    }),
    {
      detail: { tags: ["anime"], summary: "Anime API Overview" },
    },
  );
