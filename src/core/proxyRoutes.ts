import { Elysia, t } from "elysia";
import { SERVER_ORIGIN } from "./config.js";
import { isTooLarge } from "./helper.js";
import { Logger } from "./logger.js";

// for proxy safety
const MAX_M3U8_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_TS_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_FETCH_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_MP4_SIZE = 20 * 1024 * 1024 * 1024; // 20 GB

const PLAYLIST_REGEX = /\.m3u|playlist|\.txt/i;

import { env } from "./runtime.js";

if (!SERVER_ORIGIN && env.NODE_ENV !== "test") throw new Error("set SERVER_ORIGIN at .env!");

export const proxyRoutes = new Elysia({ prefix: "/proxy" })

  .get(
    "/",
    () => {
      return {
        endpoints: [
          "-------------PROXY--------------",
          "/proxy/m3u8-proxy?url={url}&headers={encodedHeaders}",
          "/proxy/ts-segment?url={url}&headers={encodedHeaders}",
          "/proxy/fetch?url={url}&headers={encodedHeaders}",
          "/proxy/mp4-proxy?url={url}&headers=",
        ],
      };
    },
    {
      detail: {
        tags: ["proxy"],
        summary: "Proxy API Overview",
      },
    },
  )

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
                  proxiedUrl = `${SERVER_ORIGIN}/proxy/m3u8-proxy?url=${encodedUrl}${headers ? `&headers=${encodedHeaders}` : ""}`;
                } else {
                  proxiedUrl = `${SERVER_ORIGIN}/proxy/fetch?url=${encodedUrl}${headers ? `&headers=${encodedHeaders}` : ""}`;
                }

                return `URI="${proxiedUrl}"`;
              });
            }

            const absoluteUrl = new URL(tl, url).href;
            const encodedUrl = encodeURIComponent(absoluteUrl);

            if (PLAYLIST_REGEX.test(absoluteUrl)) {
              return `${SERVER_ORIGIN}/proxy/m3u8-proxy?url=${encodedUrl}${headers ? `&headers=${encodedHeaders}` : ""}`;
            } else {
              return `${SERVER_ORIGIN}/proxy/ts-segment?url=${encodedUrl}${headers ? `&headers=${encodedHeaders}` : ""}`;
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
