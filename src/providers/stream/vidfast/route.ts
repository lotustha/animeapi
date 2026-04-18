import { Elysia, t } from "elysia";
import { vidfast } from "./vidfast.js";

export const vidfastRoutes = new Elysia({ prefix: "/vidfast" })
  .get("/", () => ({
    provider: "vidfast",
    status: "active",
    type: "stream",
    capabilities: ["movie", "tv"],
  }))
  .get(
    "/watch",
    async ({ query }) => {
      const { type, id, s, e } = query;
      if (type === "movie") return await vidfast.fetchMovie(id);
      if (type === "tv" && s && e) return await vidfast.fetchTv(id, s, e);
      return { error: "Invalid parameters." };
    },
    {
      query: t.Object({
        type: t.String(),
        id: t.String(),
        s: t.Optional(t.String()),
        e: t.Optional(t.String()),
      }),
    },
  )
  .get("/movie/:id", async ({ params: { id } }) => {
    return await vidfast.fetchMovie(id);
  })
  .get("/tv/:id/:season/:episode", async ({ params: { id, season, episode } }) => {
    return await vidfast.fetchTv(id, season, episode);
  });
