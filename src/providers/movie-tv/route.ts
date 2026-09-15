import { Elysia } from "elysia";
import { primesrcRoutes } from "./primesrc/route.js";
import { yFlixRoutes } from "./yflix/route.js";
import { himoviesRoutes } from "./himovies/route.js";
import { flixhqRoutes } from "./flixhq/route.js";
import { nartoDramaRoutes } from "./nartodrama/route.js";

export const movieTvRoutes = new Elysia({ prefix: "/movie-tv" })
  .use(primesrcRoutes)
  .use(yFlixRoutes)
  .use(himoviesRoutes)
  .use(flixhqRoutes)
  .use(nartoDramaRoutes)

  // ─── Overview Endpoint ────────────────────────────────────────────────────────
  .get(
    "/",
    () => ({
      service: "movie-tv",
      description: "Unified Movie & TV API — provider-isolated route architecture",
      providers: ["primesrc", "yflix", "himovies", "flixhq", "nartodrama"],
      endpoints: {
        primesrc: [
          "GET /movie-tv/primesrc/movie/:tmdbid   → Get movie sources",
          "GET /movie-tv/primesrc/tv/:tmdbid/:season/:episode → Get TV episode sources",
        ],
        yflix: [
          "GET /movie-tv/yflix/home                → Featured content",
          "GET /movie-tv/yflix/search?query=...     → Search content",
        ],
        himovies: [
          "GET /movie-tv/himovies/home                → Featured content",
          "GET /movie-tv/himovies/media/search?q=...  → Search media",
          "GET /movie-tv/himovies/media/suggestions?q=... → Search suggestions (autocomplete)",
          "GET /movie-tv/himovies/movies/category/:category → Movies (popular, top-rated)",
          "GET /movie-tv/himovies/tv/category/:category → TV Shows (popular, top-rated)",
          "GET /movie-tv/himovies/media/upcoming      → Upcoming content",
          "GET /movie-tv/himovies/media/filter        → Advanced filter search",
          "GET /movie-tv/himovies/media/:id           → Media info & episodes",
          "GET /movie-tv/himovies/genres/:genre       → Media by genre",
          "GET /movie-tv/himovies/countries/:country → Media by country",
          "GET /movie-tv/himovies/media/:id/servers   → Available servers for episode",
          "GET /movie-tv/himovies/sources/:episodeId  → Stream sources and subtitles",
        ],
        flixhq: [
          "GET /movie-tv/flixhq/home                → Featured content",
          "GET /movie-tv/flixhq/media/search?q=...  → Search media",
          "GET /movie-tv/flixhq/media/suggestions?q=... → Search suggestions (autocomplete)",
          "GET /movie-tv/flixhq/movies/category/:category → Movies (popular, top-rated)",
          "GET /movie-tv/flixhq/tv/category/:category → TV Shows (popular, top-rated)",
          "GET /movie-tv/flixhq/media/upcoming      → Upcoming content",
          "GET /movie-tv/flixhq/media/filter        → Advanced filter search",
          "GET /movie-tv/flixhq/media/:id           → Media info & episodes",
          "GET /movie-tv/flixhq/genres/:genre       → Media by genre",
          "GET /movie-tv/flixhq/countries/:country → Media by country",
          "GET /movie-tv/flixhq/media/:id/servers   → Available servers for episode",
          "GET /movie-tv/flixhq/sources/:episodeId  → Stream sources and subtitles",
        ],
        nartodrama: [
          "GET /movie-tv/nartodrama/providers          → Upstream apps aggregated (iDrama, ReelShort, …)",
          "GET /movie-tv/nartodrama/provider/:key      → One upstream app's catalogue",
          "GET /movie-tv/nartodrama/resolve/:provider/:bookId → Provider item → local slug",
          "GET /movie-tv/nartodrama/home?page=1        → Latest short dramas",
          "GET /movie-tv/nartodrama/search/:query?page=1 → Search short dramas",
          "GET /movie-tv/nartodrama/genre/:genre?page=1 → Browse by genre",
          "GET /movie-tv/nartodrama/tag/:tag?page=1   → Browse by tag",
          "GET /movie-tv/nartodrama/info/:slug        → Series info & episode list",
          "GET /movie-tv/nartodrama/watch/:slug/:episode → Episode stream sources",
        ],
      },
    }),
    {
      detail: { tags: ["movie"], summary: "Movie & TV API Overview" },
    },
  );
