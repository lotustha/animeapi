import { Elysia, t } from "elysia";
import { Cache } from "../../../core/cache.js";
import { SERVER_ORIGIN } from "../../../core/config.js";
import { isTooLarge } from "../../../core/helper.js";
import { Logger } from "../../../core/logger.js";
import { Toonstream } from "./toonstream.js";

// for proxy safety
const MAX_M3U8_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_TS_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_FETCH_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_MP4_SIZE = 20 * 1024 * 1024 * 1024; // 20 GB

// const PLAYLIST_REGEX = /\.m3u|playlist|\.txt/i
const PLAYLIST_REGEX =
  /\.m3u|playlist|\.txt|^(?!.*\.(?:js|css|gif|jpg|png|svg|woff|woff2|ttf|ts|mp4|m4s|aac|key|vtt)(?:[?#].*)?$).*$/i;

const prefix = "/anime/toonstream";

export const toonstreamRoutes = new Elysia({ prefix: "/toonstream" })
  .get("/", () => {
    return {
      name: "toonstream-api",
      version: "0.2",
      endpoints: [
        prefix + "/search/{query}?page=",
        prefix + "/suggestions/{query}",
        prefix + "/spotlight",
        prefix + "/recent-episodes",
        prefix + "/movies?page=",
        prefix + "/tv?page=",
        prefix + "/genres",
        prefix + "/genre/{genre}?page=",
        "----------------------",
        prefix + "/info/{id}",
        prefix + "/watch/{episodeId}",
        prefix + "/servers/{episodeId}",
        "----------------------",
        prefix + "/m3u8-proxy?url={url}&headers={encodedHeaders}",
        prefix + "/ts-segment?url={url}&headers={encodedHeaders}",
        prefix + "/fetch?url={url}&headers={encodedHeaders}",
        prefix + "/mp4-proxy?url={url}&headers=",
      ],
      msg: "ids are movie$<slug> / series$<slug>; episode ids append $ep=<season>x<episode>. Same node output as /anime/animekai.",
    };
  })

  // ─── Search ────────────────────────────────────────────────────────────────
  .get("/search/:query", async ({ params: { query }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `toonstream:search:${query}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Toonstream.search(query, page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200); // 12 hours
    }
    return results;
  })

  // ─── Search Suggestions ────────────────────────────────────────────────────
  .get("/suggestions/:query", async ({ params: { query } }) => {
    const key = `toonstream:suggestions:${query}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Toonstream.suggestions(query);
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 43200); // 12 hours
    }
    return { results };
  })

  // ─── Spotlight ─────────────────────────────────────────────────────────────
  .get("/spotlight", async () => {
    const cachedData = await Cache.get("toonstream:spotlight");
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Toonstream.spotlight();
    if (results && results.length > 0) {
      Cache.set("toonstream:spotlight", JSON.stringify(results), 43200); // 12 hours
    }
    return { results };
  })

  // ─── Recent Episodes (latest episodes rail) ────────────────────────────────
  .get("/recent-episodes", async () => {
    const key = `toonstream:recent-episodes`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Toonstream.recentEpisodes();
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 60); // 1 minute for recent episodes
    }
    return results;
  })

  // ─── Movies ────────────────────────────────────────────────────────────────
  .get("/movies", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `toonstream:movies:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Toonstream.movies(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7); // 7 days
    }
    return results;
  })

  // ─── TV (series) ───────────────────────────────────────────────────────────
  .get("/tv", async ({ query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `toonstream:tv:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Toonstream.tv(page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 7);
    }
    return results;
  })

  // ─── Genre List ────────────────────────────────────────────────────────────
  .get("/genres", async () => {
    const key = `toonstream:genres`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { results: JSON.parse(cachedData) };

    const results = await Toonstream.genres();
    if (results && results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 30); // 30 days
    }
    return { results };
  })

  // ─── By Genre ──────────────────────────────────────────────────────────────
  .get("/genre/:genre", async ({ params: { genre }, query: qs }) => {
    const page = parseInt(qs?.page as string) || 1;
    const key = `toonstream:genre:${genre}:${page}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const results = await Toonstream.genreSearch(genre, page);
    if (results && results.results && results.results.length > 0) {
      Cache.set(key, JSON.stringify(results), 86400 * 3); // 3 days
    }
    return results;
  })

  // ─── Anime Info ────────────────────────────────────────────────────────────
  .get("/info/:id?", async ({ params: { id }, set }) => {
    if (!id) {
      set.status = 400;
      return { message: "id is required" };
    }

    const key = `toonstream:info:${id}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return JSON.parse(cachedData);

    const res = await Toonstream.info(id);
    if (!res) {
      set.status = 404;
      return { message: "Anime not found" };
    }

    Cache.set(key, JSON.stringify(res), 86400 * 3); // 3 days for info
    return res;
  })

  // ─── Watch / Stream Sources ────────────────────────────────────────────────
  .get("/watch/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }

    const type = qs?.type as "softsub" | "dub" | "hardsub" | undefined;

    // Every server is multi-audio, so all types resolve to the same list; only
    // the isDub flag reflects the request. Vidmoly's signed m3u8 goes stale
    // (e=43200), keep the TTL modest.
    const key = `toonstream:v1:watch:${episodeId}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { isDub: type === "dub", ...JSON.parse(cachedData) };

    const res = await Toonstream.streams(episodeId, type);
    if (res?.results?.length > 0) {
      Cache.set(key, JSON.stringify({ results: res.results }), 1800);
    }
    return res;
  })

  // ─── Episode Servers ───────────────────────────────────────────────────────
  .get("/servers/:episodeId", async ({ params: { episodeId }, query: qs, set }) => {
    if (!episodeId) {
      set.status = 400;
      return { message: "episodeId is required" };
    }

    const type = qs?.type as "softsub" | "dub" | "hardsub" | undefined;

    const key = `toonstream:v1:servers:${episodeId}:${type ?? "hardsub"}`;
    const cachedData = await Cache.get(key);
    if (cachedData) return { servers: JSON.parse(cachedData) };

    const servers = await Toonstream.servers(episodeId, type);
    if (servers.length > 0) Cache.set(key, JSON.stringify(servers), 1800);
    return { servers };
  })

  // ─── Media Proxies ─────────────────────────────────────────────────────────

  .get(
    "/m3u8-proxy",
    async ({ request, query: { url, headers } }) => {
      let corsHeaders: Record<string, string> = {};

      if (headers) {
        try {
          corsHeaders = JSON.parse(decodeURIComponent(headers));
        } catch {
          return new Response("Invalid headers format", { status: 400 });
        }
      }

      corsHeaders["Connection"] = "keep-alive";

      try {
        const res = await fetch(url, {
          headers: corsHeaders,
          signal: request.signal, // Abort if client disconnects
        });

        if (!res.ok) {
          console.log("Fetch failed with status:", res.status, "Url:", url);
          return new Response(res.body, { status: res.status });
        }

        // Size limit check
        if (isTooLarge(res.headers.get("content-length"), MAX_M3U8_SIZE)) {
          return new Response("File too large", { status: 413 });
        }

        const text = await res.text();
        const encodedHeaders = encodeURIComponent(headers || "");

        const proxifiedM3u8 = text
          .split("\n")
          .map((line) => {
            const tl = line.trim();
            if (!tl) return line;

            if (tl.startsWith("#EXT")) {
              return tl.replace(/URI="([^"]+)"/g, (_, uri) => {
                const absoluteUrl = new URL(uri, url).href;
                let proxiedUrl;
                const encodedUrl = encodeURIComponent(absoluteUrl);

                if (PLAYLIST_REGEX.test(absoluteUrl)) {
                  proxiedUrl = `${SERVER_ORIGIN}${prefix}/m3u8-proxy?url=${encodedUrl}${headers ? `&headers=${encodedHeaders}` : ""}`;
                } else {
                  proxiedUrl = `${SERVER_ORIGIN}${prefix}/fetch?url=${encodedUrl}${headers ? `&headers=${encodedHeaders}` : ""}`;
                }

                return `URI="${proxiedUrl}"`;
              });
            }

            const absoluteUrl = new URL(tl, url).href;
            const encodedUrl = encodeURIComponent(absoluteUrl);

            if (PLAYLIST_REGEX.test(absoluteUrl)) {
              return `${SERVER_ORIGIN}${prefix}/m3u8-proxy?url=${encodedUrl}${headers ? `&headers=${encodedHeaders}` : ""}`;
            } else {
              return `${SERVER_ORIGIN}${prefix}/ts-segment?url=${encodedUrl}${headers ? `&headers=${encodedHeaders}` : ""}`;
            }
          })
          .join("\n");

        return new Response(proxifiedM3u8, {
          headers: {
            "Content-Type": res.headers.get("Content-Type") || "application/vnd.apple.mpegurl",
          },
        });
      } catch (err: any) {
        if (err.name === "AbortError") return new Response("Client disconnected", { status: 499 });
        Logger.error(err);
        return new Response("Internal Server Error", { status: 500 });
      }
    },
    {
      query: t.Object({
        url: t.String(),
        headers: t.Optional(t.String()),
      }),
      detail: {
        tags: ["proxy"],
        summary: "M3U8 Playlist Proxy",
      },
    },
  )

  .get(
    "/ts-segment",
    async ({ request, query: { url, headers } }) => {
      let corsHeaders: Record<string, string> = {};

      if (headers) {
        try {
          corsHeaders = JSON.parse(decodeURIComponent(headers));
        } catch {
          return new Response("Invalid headers format", { status: 400 });
        }
      }

      // Force keep-alive for the upstream connection
      corsHeaders["Connection"] = "keep-alive";

      try {
        const res = await fetch(url, {
          headers: corsHeaders,
          signal: request.signal, // Abort if client disconnects
        });

        if (!res.ok) {
          console.error("TS segment Fetch failed:", res.status, url);
          return new Response(res.body, { status: res.status });
        }

        // Size limit check
        if (isTooLarge(res.headers.get("content-length"), MAX_TS_SIZE)) {
          return new Response("Segment too large", { status: 413 });
        }

        return new Response(res.body, {
          headers: {
            "Content-Type": res.headers.get("Content-Type") || "video/MP2T",
            "Cache-Control": "public, max-age=86400",
          },
        });
      } catch (err: any) {
        if (err.name === "AbortError") return new Response("Client disconnected", { status: 499 });
        Logger.error(err);
        return new Response("Internal Server Error", { status: 500 });
      }
    },
    {
      query: t.Object({
        url: t.String(),
        headers: t.Optional(t.String()),
      }),
      detail: {
        tags: ["proxy"],
        summary: "TS Segment Proxy",
      },
    },
  )

  .get(
    "/mp4-proxy",
    async ({ request, query: { url, headers } }) => {
      let corsHeaders: Record<string, string> = {};

      if (headers) {
        try {
          corsHeaders = JSON.parse(decodeURIComponent(headers));
        } catch {
          return new Response("Invalid headers format", { status: 400 });
        }
      }

      const clientRange = request.headers.get("range");

      if (clientRange) {
        corsHeaders["Range"] = clientRange;
      }

      corsHeaders["Connection"] = "keep-alive";

      try {
        const res = await fetch(url, {
          headers: corsHeaders,
          signal: request.signal, // Abort if client disconnects
        });

        if (!res.ok) {
          console.error("[MP4] Fetch failed:", res.status, url);
          return new Response(await res.text(), { status: res.status });
        }

        // Size limit check
        if (isTooLarge(res.headers.get("content-length"), MAX_MP4_SIZE)) {
          return new Response("Video too large", { status: 413 });
        }

        return new Response(res.body, {
          status: res.status,
          headers: {
            "content-type": res.headers.get("content-type") || "video/mp4",
            "content-range": res.headers.get("content-range") || "",
            "content-length": res.headers.get("content-length") || "",
            "accept-ranges": "bytes",
          },
        });
      } catch (err: any) {
        if (err.name === "AbortError") return new Response("Client disconnected", { status: 499 });
        console.error("[MP4] Proxy Error:", err);
        return new Response("Internal Server Error", { status: 500 });
      }
    },
    {
      query: t.Object({
        url: t.String(),
        headers: t.Optional(t.String()),
      }),
      detail: {
        tags: ["proxy"],
        summary: "MP4 Video Proxy",
      },
    },
  )

  .get(
    "/fetch",
    async ({ request, query: { url, headers } }) => {
      let customHeaders: Record<string, string> = {};
      if (headers) {
        try {
          customHeaders = JSON.parse(decodeURIComponent(headers));
        } catch (_e) {
          console.error("Fetch header parse failed");
        }
      }

      customHeaders["Connection"] = "keep-alive";

      try {
        const res = await fetch(url, {
          headers: customHeaders,
          signal: request.signal, // Abort if client disconnects
        });

        // Size limit check
        if (isTooLarge(res.headers.get("content-length"), MAX_FETCH_SIZE)) {
          return new Response("Payload too large", { status: 413 });
        }

        return new Response(res.body, {
          status: res.status,
          headers: {
            "content-type": res.headers.get("content-type") || "application/octet-stream",
          },
        });
      } catch (err: any) {
        if (err.name === "AbortError") return new Response("Client disconnected", { status: 499 });
        return new Response("Fetch Error", { status: 500 });
      }
    },
    {
      query: t.Object({
        url: t.String(),
        headers: t.Optional(t.String()),
      }),
      detail: {
        tags: ["proxy"],
        summary: "General Media Fetch Proxy",
      },
    },
  );
