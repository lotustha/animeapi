import { Logger } from "../../../core/logger.js";
import { env, isBun } from "../../../core/runtime.js";

import type { DramaEpisode, DramaInfo } from "./types.js";

/**
 * Local series catalogue, backed by SQLite.
 *
 * Purpose is to answer /info and search from our own disk instead of scraping
 * narto-drama on every request. Only stable metadata lives here — series
 * identity and episode listings. Stream URLs are deliberately never stored:
 * they are signed, short-lived and (for some upstreams) region-bound, so a
 * persisted one is guaranteed to be dead on arrival.
 *
 * bun:sqlite exists only under Bun. Production runs Bun, but this repo also
 * targets Node (cPanel) and Deno, so every entry point degrades to a no-op
 * there and callers simply fall through to scraping.
 */

const DB_PATH = env.NARTODRAMA_DB || "./data/nartodrama.db";

/** A stored series older than this is returned but refreshed in the background. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

type SqliteDb = {
  run: (sql: string) => void;
  query: (sql: string) => {
    get: (...params: unknown[]) => any;
    all: (...params: unknown[]) => any[];
    run: (...params: unknown[]) => void;
  };
};

let db: SqliteDb | null = null;
let initialised = false;

function init(): SqliteDb | null {
  if (initialised) return db;
  initialised = true;

  if (!isBun) {
    Logger.info("nartodrama: SQLite store unavailable on this runtime — scraping only");
    return null;
  }

  try {
    // Resolved at runtime so bundlers targeting Node never try to follow it.
    const { Database } = require("bun:sqlite");

    const dir = DB_PATH.replace(/[^/\\]+$/, "");
    if (dir) require("node:fs").mkdirSync(dir, { recursive: true });

    const handle = new Database(DB_PATH, { create: true });
    handle.run("PRAGMA journal_mode = WAL");

    handle.run(`
      CREATE TABLE IF NOT EXISTS series (
        slug           TEXT PRIMARY KEY,
        title          TEXT NOT NULL,
        url            TEXT,
        poster         TEXT,
        description    TEXT,
        tags           TEXT,
        provider       TEXT,
        total_episodes INTEGER,
        updated_at     INTEGER NOT NULL
      )`);

    handle.run(`
      CREATE TABLE IF NOT EXISTS episodes (
        slug        TEXT    NOT NULL,
        number      INTEGER NOT NULL,
        title       TEXT,
        thumbnail   TEXT,
        is_playable INTEGER DEFAULT 1,
        PRIMARY KEY (slug, number)
      )`);

    handle.run("CREATE INDEX IF NOT EXISTS idx_series_title ON series(title)");
    handle.run("CREATE INDEX IF NOT EXISTS idx_series_updated ON series(updated_at)");

    db = handle as SqliteDb;
    Logger.success(`nartodrama: SQLite store ready at ${DB_PATH}`);
    return db;
  } catch (err) {
    Logger.error(err);
    return null;
  }
}

export interface StoredSeries {
  info: DramaInfo;
  stale: boolean;
  updatedAt: number;
}

/** Read one series. Returns null on a miss, or when the store is unavailable. */
export function getSeries(slug: string): StoredSeries | null {
  const handle = init();
  if (!handle) return null;

  try {
    const row = handle.query("SELECT * FROM series WHERE slug = ?").get(slug);
    if (!row) return null;

    const episodes = handle
      .query(
        "SELECT number, title, thumbnail, is_playable FROM episodes WHERE slug = ? ORDER BY number",
      )
      .all(slug)
      .map(
        (e: any): DramaEpisode => ({
          id: `${slug}$${e.number}`,
          number: e.number,
          title: e.title || `Episode ${e.number}`,
          thumbnail: e.thumbnail || "",
          isPlayable: e.is_playable !== 0,
        }),
      );

    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags || "[]");
    } catch {
      /* stored tags unreadable — not worth failing the read over */
    }

    return {
      updatedAt: row.updated_at,
      stale: Date.now() - row.updated_at > STALE_AFTER_MS,
      info: {
        id: row.slug,
        title: row.title,
        url: row.url || "",
        poster: row.poster || "",
        description: row.description || "",
        totalEpisodes: row.total_episodes ?? episodes.length,
        tags,
        episodes,
      },
    };
  } catch (err) {
    Logger.error(err);
    return null;
  }
}

/** Insert or refresh one series and its episode list. */
export function putSeries(info: DramaInfo, provider = ""): void {
  const handle = init();
  if (!handle) return;

  try {
    handle
      .query(
        `INSERT INTO series (slug, title, url, poster, description, tags, provider, total_episodes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           title=excluded.title, url=excluded.url, poster=excluded.poster,
           description=excluded.description, tags=excluded.tags,
           provider=excluded.provider, total_episodes=excluded.total_episodes,
           updated_at=excluded.updated_at`,
      )
      .run(
        info.id,
        info.title,
        info.url,
        info.poster,
        info.description,
        JSON.stringify(info.tags ?? []),
        provider,
        info.totalEpisodes,
        Date.now(),
      );

    const upsertEpisode = handle.query(
      `INSERT INTO episodes (slug, number, title, thumbnail, is_playable)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(slug, number) DO UPDATE SET
         title=excluded.title, thumbnail=excluded.thumbnail,
         is_playable=excluded.is_playable`,
    );

    for (const ep of info.episodes ?? []) {
      upsertEpisode.run(info.id, ep.number, ep.title, ep.thumbnail, ep.isPlayable ? 1 : 0);
    }
  } catch (err) {
    Logger.error(err);
  }
}

/** Search the local catalogue — no upstream request at all. */
export function searchSeries(query: string, limit = 24, offset = 0) {
  const handle = init();
  if (!handle) return null;

  try {
    const rows = handle
      .query(
        `SELECT slug, title, poster, provider, total_episodes
           FROM series
          WHERE title LIKE ?
          ORDER BY updated_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(`%${query}%`, limit, offset);

    return rows.map((r: any) => ({
      id: r.slug,
      title: r.title,
      poster: r.poster || "",
      provider: r.provider || "",
      totalEpisodes: r.total_episodes ?? 0,
    }));
  } catch (err) {
    Logger.error(err);
    return null;
  }
}

/** How much of the catalogue we hold locally. */
export function storeStats() {
  const handle = init();
  if (!handle) return { available: false, series: 0, episodes: 0 };

  try {
    return {
      available: true,
      path: DB_PATH,
      series: handle.query("SELECT COUNT(*) AS n FROM series").get()?.n ?? 0,
      episodes: handle.query("SELECT COUNT(*) AS n FROM episodes").get()?.n ?? 0,
    };
  } catch (err) {
    Logger.error(err);
    return { available: false, series: 0, episodes: 0 };
  }
}
