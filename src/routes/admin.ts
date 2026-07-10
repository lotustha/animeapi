import { Elysia } from "elysia";
import { Cache } from "../core/cache.js";
import { env } from "../core/runtime.js";
import { Logger } from "../core/logger.js";

// Shared secret for admin cache operations. When unset, the endpoint is
// disabled entirely (503) so it can never be hit with an empty token.
const ADMIN_TOKEN = env.CACHE_ADMIN_TOKEN || "";

function extractToken(headers: Record<string, string | undefined>): string {
  const direct = headers["x-admin-token"];
  if (direct) return direct;
  const auth = headers["authorization"] || "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

// Namespace for privileged operations (cache invalidation, etc.).
// Every route here requires the `x-admin-token` header (or `Authorization: Bearer`).
export const adminRoutes = new Elysia({ prefix: "/admin" })
  // POST /admin/cache/purge?key=<exact-key>
  // POST /admin/cache/purge?prefix=<key-prefix>
  // Body { key } / { prefix } (JSON) is accepted too.
  .post("/cache/purge", async ({ headers, query, body, set }) => {
    if (!ADMIN_TOKEN) {
      set.status = 503;
      return { ok: false, message: "cache purge disabled: CACHE_ADMIN_TOKEN not configured" };
    }

    if (extractToken(headers as Record<string, string | undefined>) !== ADMIN_TOKEN) {
      set.status = 401;
      return { ok: false, message: "unauthorized" };
    }

    const b = (body ?? {}) as Record<string, unknown>;
    const key = (query?.key ?? b.key)?.toString();
    const prefix = (query?.prefix ?? b.prefix)?.toString();

    if (!key && !prefix) {
      set.status = 400;
      return { ok: false, message: "provide `key` or `prefix`" };
    }

    if (key) {
      const result = await Cache.purgeSingle(key);
      Logger.info(`[Admin] cache purge key=${key} result=${result}`);
      return { ok: true, purged: "key", key, result };
    }

    const count = await Cache.purgePrefix(prefix!);
    Logger.info(`[Admin] cache purge prefix=${prefix} count=${count}`);
    return { ok: true, purged: "prefix", prefix, count };
  });
