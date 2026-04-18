import { Elysia } from "elysia";
import { vidcore } from "./vidcore.js";

const ok = (data: unknown) => ({ status: 200, success: true, data });
const err = (set: any, status: number, message: string) => {
  set.status = status;
  return { status, success: false, message, data: null };
};

export const vidcoreRoutes = new Elysia({ prefix: "/vidcore" })

  .get("/", () => {
    return {
      provider: "Vidcore",
      status: "operational",
      description:
        "Vidcore is a streaming provider that supplies encrypted video sources and multi-language subtitles.",
      message: "Vidcore provider is running. Visit /docs for available endpoints.",
    };
  })

  .get("/watch", async ({ query, set }) => {
    const type = query.type as string;
    const tmdbId = query.id as string;

    if (!tmdbId) return err(set, 400, "TMDB ID is required (?id=...)");

    if (type === "movie") {
      const data = await vidcore.fetchMovie(tmdbId);
      if (data.error) return err(set, 500, data.error);
      return ok(data);
    }

    if (type === "tv") {
      const season = query.s as string;
      const episode = query.e as string;
      if (!season || !episode)
        return err(set, 400, "Season (?s=) and Episode (?e=) are required for TV shows");

      const data = await vidcore.fetchTv(tmdbId, season, episode);
      if (data.error) return err(set, 500, data.error);
      return ok(data);
    }

    return err(set, 400, "Invalid type. Must be 'movie' or 'tv'");
  })

  .get("/movie/:id", async ({ params, set }) => {
    const data = await vidcore.fetchMovie(params.id);
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  })

  .get("/tv/:id/:season/:episode", async ({ params, set }) => {
    const data = await vidcore.fetchTv(params.id, params.season, params.episode);
    if (data.error) return err(set, 500, data.error);
    return ok(data);
  });
