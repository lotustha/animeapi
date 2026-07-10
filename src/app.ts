import cors from "@elysiajs/cors";
import openapi from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { CORS_CREDENTIALS, CORS_ORIGIN, OPENAPI_VERSION } from "./core/config.js";
import { mappingRoutes } from "./core/mappingRoutes.js";
import { proxyRoutes } from "./core/proxyRoutes.js";
import { animeRoutes } from "./providers/anime/route.js";
import { mangaRoutes } from "./providers/manga/route.js";
import { movieTvRoutes } from "./providers/movie-tv/route.js";
import { musicRoutes } from "./providers/music/route.js";
import { streamRoutes } from "./providers/stream/route.js";
import { cronRoutes } from "./routes/cron.js";
import { adminRoutes } from "./routes/admin.js";

import { isNode } from "./core/runtime.js";
import { env } from "./core/runtime.js";

export async function createApp() {
  let appConfig: Record<string, any> = {};
  if (isNode && process.env.NODE_ENV !== "test") {
    const { node } = await import("@elysiajs/node");
    appConfig = { adapter: node() };
  }

  // Support subdirectory deployment (e.g., BASE_PATH=/api for cPanel)
  const basePath = (env.BASE_PATH || "").replace(/\/+$/, "");
  if (basePath) appConfig.prefix = basePath;

  const app = new Elysia(appConfig)
    .use(
      cors({
        origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN.split(","),
        credentials: CORS_CREDENTIALS,
      }),
    )
    .onBeforeHandle(({ request }: { request: Request }) => {
      // Normalize paths: remove double slashes and trailing slashes
      const url = new URL(request.url);
      if (url.pathname.includes("//") || (url.pathname.length > 1 && url.pathname.endsWith("/"))) {
        const normalizedPath = url.pathname.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
        if (normalizedPath !== url.pathname) {
          return Response.redirect(url.origin + normalizedPath + url.search, 301);
        }
      }
    });

  app.use(
    openapi({
      path: "/docs",
      documentation: {
        info: {
          title: "Cooren API",
          version: "1.0.0",
        },
        tags: [
          { name: "anime", description: "📺 Anime Providers & Mappings" },
          { name: "manga", description: "📚 Manga Providers (e.g., Mangaball, Atsu)" },
          { name: "movie", description: "🍿 Movie & TV Providers" },
          { name: "stream", description: "⚡ Direct Stream Providers" },
          { name: "proxy", description: "🥷 Utilities" },
        ],
      },
    }),
  );

  app
    .get(
      "/",
      () => {
        return {
          name: "Cooren API",
          version: OPENAPI_VERSION,
          repo: "https://github.com/CoorenLabs/Cooren.git",
          environment: process.env.NODE_ENV || "development",
          about:
            "Cooren is a high-performance, scalable scraping engine designed to collect, organize, and deliver structured data from across the world of anime, movies, manga, and music, all in one unified ecosystem",
          status: "operational",
        };
      },
      {
        detail: {
          tags: ["core"],
          summary: "System Status & API Overview",
        },
      },
    )
    .use(movieTvRoutes)
    .use(animeRoutes)
    .use(mangaRoutes)
    .use(musicRoutes)
    .use(streamRoutes)
    .use(proxyRoutes)
    .use(cronRoutes)
    .use(adminRoutes)
    .use(mappingRoutes);

  return app;
}
