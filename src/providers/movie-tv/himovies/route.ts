import Elysia, { t } from "elysia";
import { HiMovies } from "./himovies.js";

const himoviesRoutes = new Elysia({ prefix: "/himovies" })
  .get("/", () => {
    return {
      provider: "himovies",
      type: "movie/tv",
      endpoints: [
        "/himovies/home",
        "/himovies/media/search",
        "/himovies/media/suggestions",
        "/himovies/movies/category/:category",
        "/himovies/tv/category/:category",
        "/himovies/media/upcoming",
        "/himovies/media/filter",
        "/himovies/media/:id",
        "/himovies/genres/:genre",
        "/himovies/countries/:country",
        "/himovies/media/:id/servers",
        "/himovies/sources/:episodeId",
      ],
    };
  })
  .get("/home", async () => {
    return await HiMovies.fetchHome();
  })
  .get(
    "/media/search",
    async ({ query: { q, page } }) => {
      return await HiMovies.search(q, page ? Number(page) : undefined);
    },
    {
      query: t.Object({
        q: t.String(),
        page: t.Optional(t.Numeric()),
      }),
    },
  )
  .get(
    "/media/suggestions",
    async ({ query: { q } }) => {
      return await HiMovies.searchSuggestions(q);
    },
    {
      query: t.Object({
        q: t.String(),
      }),
    },
  )
  .get(
    "/movies/category/:category",
    async ({ params: { category }, query: { page } }) => {
      const pageNum = page ? Number(page) : undefined;
      if (category === "popular") return await HiMovies.fetchPopularMovies(pageNum);
      if (category === "top-rated") return await HiMovies.fetchTopMovies(pageNum);
      return { error: "Invalid category" };
    },
    {
      params: t.Object({
        category: t.String(),
      }),
      query: t.Object({
        page: t.Optional(t.Numeric()),
      }),
    },
  )
  .get(
    "/tv/category/:category",
    async ({ params: { category }, query: { page } }) => {
      const pageNum = page ? Number(page) : undefined;
      if (category === "popular") return await HiMovies.fetchPopularTv(pageNum);
      if (category === "top-rated") return await HiMovies.fetchTopTv(pageNum);
      return { error: "Invalid category" };
    },
    {
      params: t.Object({
        category: t.String(),
      }),
      query: t.Object({
        page: t.Optional(t.Numeric()),
      }),
    },
  )
  .get(
    "/media/upcoming",
    async ({ query: { page } }) => {
      return await HiMovies.fetchUpcoming(page ? Number(page) : undefined);
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric()),
      }),
    },
  )
  .get(
    "/media/filter",
    async ({ query: { type, quality, genre, country, year, page } }) => {
      return await HiMovies.advancedSearch(
        type,
        quality,
        genre,
        country,
        year,
        page ? Number(page) : undefined,
      );
    },
    {
      query: t.Object({
        type: t.Optional(t.String({ default: "all" })),
        quality: t.Optional(t.String({ default: "all" })),
        genre: t.Optional(t.String({ default: "all" })),
        country: t.Optional(t.String({ default: "all" })),
        year: t.Optional(t.String({ default: "all" })),
        page: t.Optional(t.Numeric({ default: 1 })),
      }),
    },
  )
  .get(
    "/media/:id",
    async ({ params: { id } }) => {
      return await HiMovies.fetchMediaInfo(id);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )
  .get(
    "/genres/:genre",
    async ({ params: { genre }, query: { page } }) => {
      return await HiMovies.fetchGenre(genre, page ? Number(page) : undefined);
    },
    {
      params: t.Object({
        genre: t.String(),
      }),
      query: t.Object({
        page: t.Optional(t.Numeric()),
      }),
    },
  )
  .get(
    "/countries/:country",
    async ({ params: { country }, query: { page } }) => {
      return await HiMovies.fetchByCountry(country, page ? Number(page) : undefined);
    },
    {
      params: t.Object({
        country: t.String(),
      }),
      query: t.Object({
        page: t.Optional(t.Numeric()),
      }),
    },
  )
  .get(
    "/media/:id/servers",
    async ({ params: { id } }) => {
      return await HiMovies.fetchServers(id);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )
  .get(
    "/sources/:episodeId",
    async ({ params: { episodeId }, query: { server } }) => {
      return await HiMovies.fetchSources(episodeId, server);
    },
    {
      params: t.Object({
        episodeId: t.String(),
      }),
      query: t.Object({
        server: t.Optional(t.String({ default: "megacloud" })),
      }),
    },
  );

export { himoviesRoutes };
