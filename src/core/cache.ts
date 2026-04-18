// maintainer - binrot
// accept all incomings for this file, if coming from @binrot

import { Redis } from "@upstash/redis";
import { env, isBun } from "./runtime.js";
import { Logger } from "./logger.js";

// File-based cache imports (works on Node.js / cPanel)
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// We can't import RedisClient from "bun" in non-Bun runtimes.
let _RedisClientValue: any;
if (isBun) {
  import("bun").then((m) => (_RedisClientValue = m.RedisClient));
}

const cacheProviders = ["default", "uptash", "file"];

const ENABLE_CACHE = env.ENABLE_CACHE;
const DEFAULT_CACHE_TTL = +(env.DEFAULT_CACHE_TTL || -1);
const CACHE_PROVIDER = env.CACHE_PROVIDER;

if (isNaN(DEFAULT_CACHE_TTL)) {
  throw new Error("Invalid `DEFAULT_CACHE_TTL` value " + env.DEFAULT_CACHE_TTL);
}

if (
  ENABLE_CACHE === "true" &&
  (!CACHE_PROVIDER || !cacheProviders.includes(CACHE_PROVIDER as any))
) {
  throw new Error("Invalid `CACHE_PROVIDER` value " + CACHE_PROVIDER);
}

const REDIS_URL = env.REDIS_URL;
const UPSTASH_REDIS_REST_URL = env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = env.UPSTASH_REDIS_REST_TOKEN;

let redis: Redis | any | undefined;

// ── Resolve cache directory (relative to project root) ──────────────
let CACHE_DIR = "";
if (ENABLE_CACHE === "true" && CACHE_PROVIDER === "file") {
  // Try to find project root via __dirname or cwd
  let root: string;
  try {
    const __filename = fileURLToPath(import.meta.url);
    // cache.ts is in src/core/ or dist/core/, so go up 2 levels
    root = resolve(dirname(__filename), "..", "..");
  } catch {
    root = process.cwd();
  }
  CACHE_DIR = env.CACHE_DIR || join(root, "cache");

  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
  Logger.info(`[Cache] File-based cache initialized at ${CACHE_DIR}`);
}

// ── Provider initialization ─────────────────────────────────────────

// cache disabled
if (ENABLE_CACHE !== "true") {
  Logger.info("[Cache] Cache is turned off. serving without cache!");
}

// file-based (works everywhere — perfect for cPanel)
else if (CACHE_PROVIDER === "file") {
  // Already initialized above, no external dependencies needed
  Logger.info("[Cache] File-based cache ready! No Redis required.");
}

// default (Bun native Redis)
else if (CACHE_PROVIDER == "default") {
  if (!isBun) {
    Logger.warn(
      "[Cache] Native Bun RedisClient is only available in Bun. Falling back to no cache for 'default' provider.",
    );
  } else {
    if (!REDIS_URL) throw new Error("`REDIS_URL` is required to use redis cache!");

    import("bun")
      .then(({ RedisClient }) => {
        redis = new RedisClient(REDIS_URL, {
          autoReconnect: true,
          connectionTimeout: 10_000,
          maxRetries: 3,
        });
        Logger.info("[Cache]  Redis (default) successfully initialized, now serving with cache!");
      })
      .catch((err) => {
        Logger.error("[Cache] Failed to initialize Bun RedisClient:", err);
      });
  }
}

// uptash
else {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    throw new Error(
      "`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_URL` is required to use uptash redis cache!",
    );
  }

  redis = new Redis({
    url: UPSTASH_REDIS_REST_URL,
    token: UPSTASH_REDIS_REST_TOKEN,
  });
  Logger.info("[Cache] Uptash Redis successfully initailized, now serving with cache!");
}

// ── File cache helpers ──────────────────────────────────────────────

/** Convert a cache key to a safe filename */
function keyToFilePath(key: string): string {
  const hash = createHash("md5").update(key).digest("hex");
  let parts = key.split(":");
  let fileName = "data";
  let dirPath = CACHE_DIR;

  if (parts.length > 2) {
    // Limit to max 2 subfolders so dynamic parts like search queries don't turn into folders
    const folders = parts.slice(0, 2).map((p) => p.replace(/[^a-zA-Z0-9_-]/g, "_"));
    dirPath = join(CACHE_DIR, ...folders);
    fileName = parts.slice(2).join("_").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  } else if (parts.length === 2) {
    const folder = parts[0].replace(/[^a-zA-Z0-9_-]/g, "_");
    dirPath = join(CACHE_DIR, folder);
    fileName = parts[1].replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  } else {
    // Just 1 part, put it in a folder with its own name to keep root root clean
    const folder = key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 20);
    dirPath = join(CACHE_DIR, folder);
  }

  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }

  return join(dirPath, `${fileName}__${hash}.json`);
}

interface FileCacheEntry {
  value: string;
  ttl: number;       // -1 = forever
  createdAt: number;  // epoch ms
}

function fileGet(key: string): string | null {
  const filePath = keyToFilePath(key);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf-8");
    const entry: FileCacheEntry = JSON.parse(raw);

    // Check TTL expiry
    if (entry.ttl !== -1) {
      const ageSeconds = (Date.now() - entry.createdAt) / 1000;
      if (ageSeconds > entry.ttl) {
        // Expired — delete and return miss
        try { unlinkSync(filePath); } catch {}
        return null;
      }
    }

    return entry.value;
  } catch {
    return null;
  }
}

function fileSet(key: string, value: string, ttl: number): void {
  const filePath = keyToFilePath(key);
  const entry: FileCacheEntry = {
    value,
    ttl,
    createdAt: Date.now(),
  };
  writeFileSync(filePath, JSON.stringify(entry), "utf-8");
}

function fileDelete(key: string): boolean {
  const filePath = keyToFilePath(key);
  if (existsSync(filePath)) {
    try { unlinkSync(filePath); return true; } catch { return false; }
  }
  return false;
}

// Helper for recursive file lookup
function getAllCacheFiles(dir: string): string[] {
  let results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const file of readdirSync(dir)) {
    const fullPath = join(dir, file);
    if (statSync(fullPath).isDirectory()) {
      results = results.concat(getAllCacheFiles(fullPath));
    } else if (file.endsWith(".json")) {
      results.push(fullPath);
    }
  }
  return results;
}

function filePurgePrefix(prefix: string): number {
  if (!existsSync(CACHE_DIR)) return 0;
  // This simplistic approach checks if the stringified key/path happens to contain the prefix
  // It's less exact with subfolders, but prefix matching is rarely used
  const sanitizedPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "_");
  let deleted = 0;

  for (const file of getAllCacheFiles(CACHE_DIR)) {
    // filename or path contains the prefix
    if (file.includes(sanitizedPrefix)) {
      try { unlinkSync(file); deleted++; } catch {}
    }
  }
  return deleted;
}

function filePurgeAll(): number {
  if (!existsSync(CACHE_DIR)) return 0;
  let deleted = 0;

  for (const file of getAllCacheFiles(CACHE_DIR)) {
    try { unlinkSync(file); deleted++; } catch {}
  }
  return deleted;
}

// ── Cache class (unchanged API, now supports file provider) ─────────

export class Cache {
  /**
   *
   * @param key Cache Key
   * @param value string value. use `JSON.stringify` if not a string before passing
   * @param TTL number of seconds the cache is valid for. `default:-1` which means cache is stored forever
   * @returns `true` if successfully set, otherwise `false`
   */

  static async set(key: string, value: string, TTL: number = DEFAULT_CACHE_TTL) {
    // File-based cache
    if (CACHE_PROVIDER === "file") {
      try {
        fileSet(key, value, TTL);
        Logger.info(
          `[Cache] successfully saved cache, key:${key}, ttl:${TTL == -1 ? "forever" : TTL + "seconds"} `,
        );
        return true;
      } catch (err) {
        Logger.error(
          `[Cache] failed to saved cache, key:${key}, ttl:${TTL == -1 ? "forever" : TTL + "seconds"} `,
        );
        console.log(err);
        return false;
      }
    }

    // Redis-based cache
    if (redis === undefined) return;

    try {
      if (TTL == -1) {
        // store forever
        await redis.set(key, value);
      } else {
        // store for TTL seconds
        if (CACHE_PROVIDER === "default") {
          await (redis as any).set(key, value, "EX", TTL);
        } else {
          await redis.set(key, value, { ex: TTL });
        }
      }

      Logger.info(
        `[Cache] successfully saved cache, key:${key}, ttl:${TTL == -1 ? "forever" : TTL + "seconds"} `,
      );
      return true;
    } catch (err) {
      Logger.error(
        `[Cache] failed to saved cache, key:${key}, ttl:${TTL == -1 ? "forever" : TTL + "seconds"} `,
      );
      console.log(err);
      return false;
    }
  }

  /***
   * @param key  retrives the value for the key
   * @returns  value (`string`) associated with the key, otherwise `null`
   */
  static async get(key: string) {
    // File-based cache
    if (CACHE_PROVIDER === "file") {
      try {
        const data = fileGet(key);
        if (data == null) Logger.info(`[Cache] MISS, key:${key}`);
        else Logger.info(`[Cache] HIT, key:${key}`);
        return data;
      } catch (error) {
        Logger.error(`[Cache] FAULT, key:${key} -`, error);
        return null;
      }
    }

    // Redis-based cache
    if (redis === undefined) return;

    try {
      const data: string | null = await redis.get(key);

      if (data == null) Logger.info(`[Cache] MISS, key:${key}`);
      else Logger.info(`[Cache] HIT, key:${key}`);

      return data;
    } catch (error) {
      Logger.error(`[Cache] FAULT, key:${key} -`, error);
      return null;
    }
  }

  /**
   * Purges a singe key/val cache
   * @param key
   * @returns `true` if purge is successfull, otherwise `false`
   */
  static async purgeSingle(key: string) {
    if (CACHE_PROVIDER === "file") {
      try {
        const result = fileDelete(key);
        if (result) Logger.info(`[Cache] DELETE, key:${key}`);
        return result;
      } catch (error) {
        Logger.error(`[Cache] FAULT, key:${key} -`, error);
        return false;
      }
    }

    if (redis === undefined) return;

    try {
      await redis.unlink(key);

      Logger.info(`[Cache] DELETE, key:${key}`);
      return true;
    } catch (error) {
      Logger.error(`[Cache] FAULT, key:${key} -`, error);
      return false;
    }
  }

  /**
   * Purge caches with a prefix. Useful when clearing cache for a cetain provider
   * @param prefix prefix for all the keys
   * @returns `number` number of records been deleted, `false` on error
   */
  static async purgePrefix(prefix: string) {
    if (CACHE_PROVIDER === "file") {
      try {
        const count = filePurgePrefix(prefix);
        Logger.info(`[Cache] Deleted ${count} records with prefix ${prefix}`);
        return count;
      } catch (error) {
        Logger.error(`[Cache] FAULT, purge prefix:${prefix} -`, error);
        return false;
      }
    }

    if (redis === undefined) return;

    try {
      let cursor = "0";
      let totalDeleted = 0;

      do {
        let nextCursor: string;
        let keys: string[];

        if (CACHE_PROVIDER === "default") {
          [nextCursor, keys] = await (redis as any).scan(cursor, "MATCH", `${prefix}*`);
        } else {
          [nextCursor, keys] = await (redis as Redis).scan(cursor, { match: `${prefix}*` });
        }

        cursor = String(nextCursor);

        if (keys.length > 0) {
          await redis.unlink(...keys);
          totalDeleted += keys.length;
          Logger.info(`[Cache] Deleted ${keys.length} records with prefix ${prefix}`);
        }
      } while (cursor !== "0");

      return totalDeleted;
    } catch (error) {
      Logger.error(`[Cache] FAULT, purge prefix:${prefix} -`, error);
      return false;
    }
  }
  /**
   * Purge all caches. Literally empties the all redis cache.
   * @returns `number` number of records been deleted, `false` on error
   */
  static async purgeAll() {
    if (CACHE_PROVIDER === "file") {
      try {
        const count = filePurgeAll();
        Logger.info(`[Cache] Purged ${count} records`);
        return count;
      } catch (error) {
        Logger.error(`[Cache] FAULT, purge all -`, error);
        return false;
      }
    }

    if (redis === undefined) return;

    try {
      let count = 0;

      if (CACHE_PROVIDER === "default") {
        count = await (redis as any).send("DBSIZE", []);
        await (redis as any).send("FLUSHDB", []);
      } else {
        count = await (redis as Redis).dbsize();
        await (redis as Redis).flushdb();
      }
      Logger.info(`[Cache] Purged ${count} records`);
      return count;
    } catch (error) {
      Logger.error(`[Cache] FAULT, purge all -`, error);
      return false;
    }
  }
}
