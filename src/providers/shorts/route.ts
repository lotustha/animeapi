import { Elysia } from "elysia";
import { mojRoutes } from "./moj/route.js";

export const shortsRoutes = new Elysia({ prefix: "/shorts" })
  .use(mojRoutes)

  // ─── Overview Endpoint ────────────────────────────────────────────────────────
  .get(
    "/",
    () => ({
      service: "shorts",
      description: "Unified short-video API — provider-isolated route architecture",
      providers: ["moj"],
      endpoints: {
        moj: [
          "GET /shorts/moj/feed?limit=10           → For You feed (new batch each call)",
          "GET /shorts/moj/search/:query?offset=   → Search shorts",
          "GET /shorts/moj/tag/:hashtag?offset=    → Popular shorts for a hashtag",
        ],
      },
    }),
    {
      detail: { tags: ["shorts"], summary: "Shorts API Overview" },
    },
  );
