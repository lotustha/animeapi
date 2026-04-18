import { Elysia } from "elysia";
import { atsu } from "./atsu.js";

const ok = (data: unknown) => ({ status: 200, success: true, data });
const err = (set: any, status: number, message: string) => {
  set.status = status;
  return { status, success: false, message, data: null };
};

const getBaseUrl = (request: Request) => {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/manga/atsu`;
};

const DEFAULT_TYPES = "Manga,Manwha,Manhua,OEL";

export const atsuRoutes = new Elysia({ prefix: "/atsu" })

  // ─── Provider Info Endpoint ───
  .get("/", () => {
    return {
      provider: "Atsu",
      status: "operational",
      description:
        "Atsu is a sleek online manga reading platform that offers a wide variety of manga, manhwa, and manhua titles across different genres. It provides users with an extensive, high-quality library, including both classic and contemporary titles, along with features like personalized recommendations, trending sections, and a user-friendly interface for discovering and reading comics online.",
      message: "Atsu provider is running. Visit /docs for available endpoints.",
    };
  })
  // ─── Standard (Non-Adult) Endpoints ───
  .get("/home", async ({ request, set }) => {
    const data = await atsu.parseHome(getBaseUrl(request), false);
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  })
  .get("/trending", async ({ request, query, set }) => {
    const page = parseInt(query.page as string) || 0;
    const types = (query.types as string) || DEFAULT_TYPES;
    const data = await atsu.fetchInfiniteSection(
      "trending",
      page,
      { types },
      getBaseUrl(request),
      false,
    );
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  })
  .get("/most-bookmarked", async ({ request, query, set }) => {
    const page = parseInt(query.page as string) || 0;
    const timeframe = (query.timeframe as string) || "7";
    const types = (query.types as string) || DEFAULT_TYPES;
    const data = await atsu.fetchInfiniteSection(
      "mostBookmarked",
      page,
      { timeframe, types },
      getBaseUrl(request),
      false,
    );
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  })
  .get("/hot-updates", async ({ request, query, set }) => {
    const page = parseInt(query.page as string) || 0;
    const types = (query.types as string) || DEFAULT_TYPES;
    const data = await atsu.fetchInfiniteSection(
      "recentlyUpdated",
      page,
      { types },
      getBaseUrl(request),
      false,
    );
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  })
  .get("/top-rated", async ({ request, query, set }) => {
    const page = parseInt(query.page as string) || 0;
    const types = (query.types as string) || DEFAULT_TYPES;
    const data = await atsu.fetchInfiniteSection(
      "topRated",
      page,
      { types },
      getBaseUrl(request),
      false,
    );
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  })
  .get("/popular", async ({ request, query, set }) => {
    const page = parseInt(query.page as string) || 0;
    const types = (query.types as string) || DEFAULT_TYPES;
    const data = await atsu.fetchInfiniteSection(
      "popular",
      page,
      { types },
      getBaseUrl(request),
      false,
    );
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  })
  .get("/recently-added", async ({ request, query, set }) => {
    const page = parseInt(query.page as string) || 0;
    const types = (query.types as string) || DEFAULT_TYPES;
    const data = await atsu.fetchInfiniteSection(
      "recentlyAdded",
      page,
      { types },
      getBaseUrl(request),
      false,
    );
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  })

  // ─── Detail & Reading Endpoints ───
  .get("/detail/:id", async ({ request, params, set }) => {
    const data = await atsu.fetchMangaDetails(params.id, getBaseUrl(request));
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  })
  .get("/info/:id", async ({ params, set }) => {
    const data = await atsu.fetchChapterInfo(params.id);
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  })
  .get("/read", async ({ request, query, set }) => {
    if (!query.mangaId || !query.chapterId) {
      return err(set, 400, "mangaId and chapterId query parameters are required");
    }
    const data = await atsu.fetchChapterPages(
      query.mangaId as string,
      query.chapterId as string,
      getBaseUrl(request),
    );
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  })

  // ─── Discovery & Filters Endpoints ───
  .get("/filters", async ({ set }) => {
    const data = await atsu.fetchFilters();
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  })
  .get("/explore", async ({ request, query, set }) => {
    const data = await atsu.fetchFilteredView(
      {
        genres: query.genres as string,
        types: query.types as string,
        statuses: query.statuses as string,
        page: parseInt(query.page as string) || 0,
        adult: false,
      },
      getBaseUrl(request),
    );
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  })
  .get("/genre/:slug", async ({ request, params, query, set }) => {
    const data = await atsu.fetchFilteredView(
      {
        genres: params.slug,
        page: parseInt(query.page as string) || 0,
        adult: false,
      },
      getBaseUrl(request),
    );
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  })
  // ─── Re-mapped: Author Route ───
  .get("/author/:slug", async ({ request, params, query, set }) => {
    const data = await atsu.fetchAuthor(
      params.slug,
      parseInt(query.page as string) || 0,
      query.type as string,
      getBaseUrl(request),
    );
    if (data.error) return err(set, 500, data.error);

    if (data.items) {
      data.items = data.items.filter((item: any) => !item.isAdult);
    }
    return ok(data);
  })

  // ─── Adult (+18) Endpoints ───
  .group("/adult", (app) =>
    app
      .get("/home", async ({ request, set }) => {
        const data = await atsu.parseHome(getBaseUrl(request), true);
        if (data.error) return err(set, 500, data.error);
        return ok(data);
      })
      .get("/explore", async ({ request, query, set }) => {
        const data = await atsu.fetchFilteredView(
          {
            genres: query.genres as string,
            types: query.types as string,
            statuses: query.statuses as string,
            page: parseInt(query.page as string) || 0,
            adult: true,
          },
          getBaseUrl(request),
        );
        if (data.error) return err(set, 500, data.error);
        return ok(data);
      })
      .get("/genre/:slug", async ({ request, params, query, set }) => {
        const data = await atsu.fetchFilteredView(
          {
            genres: params.slug,
            page: parseInt(query.page as string) || 0,
            adult: true,
          },
          getBaseUrl(request),
        );
        if (data.error) return err(set, 500, data.error);
        return ok(data);
      })
      // ─── Re-mapped: Adult Author Route / Working @Metahat───
      .get("/author/:slug", async ({ request, params, query, set }) => {
        const data = await atsu.fetchAuthor(
          params.slug,
          parseInt(query.page as string) || 0,
          query.type as string,
          getBaseUrl(request),
        );
        if (data.error) return err(set, 500, data.error);
        return ok(data);
      })
      .get("/trending", async ({ request, query, set }) => {
        const page = parseInt(query.page as string) || 0;
        const types = (query.types as string) || DEFAULT_TYPES;
        const data = await atsu.fetchInfiniteSection(
          "trending",
          page,
          { types },
          getBaseUrl(request),
          true,
        );
        if (data.error) return err(set, 500, data.error);
        return ok(data);
      })
      .get("/most-bookmarked", async ({ request, query, set }) => {
        const page = parseInt(query.page as string) || 0;
        const timeframe = (query.timeframe as string) || "7";
        const types = (query.types as string) || DEFAULT_TYPES;
        const data = await atsu.fetchInfiniteSection(
          "mostBookmarked",
          page,
          { timeframe, types },
          getBaseUrl(request),
          true,
        );
        if (data.error) return err(set, 500, data.error);
        return ok(data);
      })
      .get("/hot-updates", async ({ request, query, set }) => {
        const page = parseInt(query.page as string) || 0;
        const types = (query.types as string) || DEFAULT_TYPES;
        const data = await atsu.fetchInfiniteSection(
          "recentlyUpdated",
          page,
          { types },
          getBaseUrl(request),
          true,
        );
        if (data.error) return err(set, 500, data.error);
        return ok(data);
      })
      .get("/top-rated", async ({ request, query, set }) => {
        const page = parseInt(query.page as string) || 0;
        const types = (query.types as string) || DEFAULT_TYPES;
        const data = await atsu.fetchInfiniteSection(
          "topRated",
          page,
          { types },
          getBaseUrl(request),
          true,
        );
        if (data.error) return err(set, 500, data.error);
        return ok(data);
      })
      .get("/popular", async ({ request, query, set }) => {
        const page = parseInt(query.page as string) || 0;
        const types = (query.types as string) || DEFAULT_TYPES;
        const data = await atsu.fetchInfiniteSection(
          "popular",
          page,
          { types },
          getBaseUrl(request),
          true,
        );
        if (data.error) return err(set, 500, data.error);
        return ok(data);
      })
      .get("/recently-added", async ({ request, query, set }) => {
        const page = parseInt(query.page as string) || 0;
        const types = (query.types as string) || DEFAULT_TYPES;
        const data = await atsu.fetchInfiniteSection(
          "recentlyAdded",
          page,
          { types },
          getBaseUrl(request),
          true,
        );
        if (data.error) return err(set, 500, data.error);
        return ok(data);
      }),
  )

  // ─── Image Proxy ───
  .get("/image/*", async ({ params, set }) => {
    const path = params["*"] as string;
    const result = await atsu.proxyImage(path);

    if (!result) {
      set.status = 404;
      return;
    }

    set.headers["Content-Type"] = result.contentType;
    set.headers["Cache-Control"] = "public, max-age=86400";
    return result.content;
  });
