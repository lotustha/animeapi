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
  close: () => void;
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
    // FIRST, before anything that takes a lock. Zero-downtime deploys
    // (scripts/deploy/handover.sh, 2026-09-26) run two processes on this file
    // for a couple of minutes: the bridge boots while the old pm2 process is
    // still writing, and pm2's new one boots while the bridge is. SQLite's
    // default busy timeout is 0, so the WAL pragma, dropLegacySchema or a
    // CREATE TABLE that meets the other writer's lock throws SQLITE_BUSY at
    // once — the catch below then leaves `db` null and that process scrapes
    // for its whole life. 5s of waiting is far longer than any write here.
    handle.run("PRAGMA busy_timeout = 5000");
    handle.run("PRAGMA journal_mode = WAL");

    // A series is stored PER LOCALE, because upstream returns a different
    // title, description and episode list for each one. Keyed on slug alone,
    // a Polish scrape overwrote the row every other locale then read — and
    // because the caller caches what it reads under its own locale-scoped key,
    // that Polish metadata got served, and imported, as English.
    dropLegacySchema(handle);

    handle.run(`
      CREATE TABLE IF NOT EXISTS series (
        slug           TEXT NOT NULL,
        lang           TEXT NOT NULL,
        title          TEXT NOT NULL,
        url            TEXT,
        poster         TEXT,
        description    TEXT,
        tags           TEXT,
        provider       TEXT,
        total_episodes INTEGER,
        updated_at     INTEGER NOT NULL,
        PRIMARY KEY (slug, lang)
      )`);

    handle.run(`
      CREATE TABLE IF NOT EXISTS episodes (
        slug        TEXT    NOT NULL,
        lang        TEXT    NOT NULL,
        number      INTEGER NOT NULL,
        title       TEXT,
        thumbnail   TEXT,
        is_playable INTEGER DEFAULT 1,
        PRIMARY KEY (slug, lang, number)
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

/**
 * Drop the pre-locale tables so they can be recreated with `lang` in the key.
 *
 * SQLite cannot add a column to a primary key in place, and this is a cache of
 * upstream metadata with nothing authoritative in it — everything dropped is
 * re-scraped on the next request. That is a far better trade than carrying a
 * schema whose rows cannot say which language they are in.
 *
 * Detected by asking for the column rather than tracking a version number:
 * there is exactly one old shape and one new one, so the column's presence is
 * the whole question.
 */
function dropLegacySchema(handle: SqliteDb): void {
  try {
    const columns = handle.query("PRAGMA table_info(series)").all();
    // No table yet — nothing to migrate, CREATE TABLE will do the work.
    if (columns.length === 0) return;
    if (columns.some((c: any) => c.name === "lang")) return;

    Logger.info("nartodrama: store predates per-locale keys — rebuilding cache");
    handle.run("DROP TABLE IF EXISTS episodes");
    handle.run("DROP TABLE IF EXISTS series");
  } catch (err) {
    Logger.error(err);
  }
}

export interface StoredSeries {
  info: DramaInfo;
  stale: boolean;
  updatedAt: number;
}

/**
 * Read one series in one locale.
 *
 * A miss in the requested locale is a miss, never a fall back to another one:
 * answering a Polish request with the English row is what made a locale-scoped
 * cache serve the wrong language.
 */
export function getSeries(slug: string, lang: string): StoredSeries | null {
  const handle = init();
  if (!handle) return null;

  try {
    const row = handle
      .query("SELECT * FROM series WHERE slug = ? AND lang = ?")
      .get(slug, lang);
    if (!row) return null;

    const episodes = handle
      .query(
        "SELECT number, title, thumbnail, is_playable FROM episodes WHERE slug = ? AND lang = ? ORDER BY number",
      )
      .all(slug, lang)
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
        // Carried through deliberately. Leaving it off is not cosmetic: the
        // consumer writes it to drama_series.source_app, and an /info answered
        // from this store — the warm path — reported no provider at all, so a
        // re-import overwrote a known-good value with NULL.
        provider: row.provider || "",
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

/** Insert or refresh one series and its episode list, in one locale. */
export function putSeries(info: DramaInfo, provider = "", lang: string): void {
  const handle = init();
  if (!handle) return;

  try {
    handle
      .query(
        `INSERT INTO series (slug, lang, title, url, poster, description, tags, provider, total_episodes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug, lang) DO UPDATE SET
           title=excluded.title, url=excluded.url, poster=excluded.poster,
           description=excluded.description, tags=excluded.tags,
           provider=excluded.provider, total_episodes=excluded.total_episodes,
           updated_at=excluded.updated_at`,
      )
      .run(
        info.id,
        lang,
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
      `INSERT INTO episodes (slug, lang, number, title, thumbnail, is_playable)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug, lang, number) DO UPDATE SET
         title=excluded.title, thumbnail=excluded.thumbnail,
         is_playable=excluded.is_playable`,
    );

    for (const ep of info.episodes ?? []) {
      upsertEpisode.run(info.id, lang, ep.number, ep.title, ep.thumbnail, ep.isPlayable ? 1 : 0);
    }
  } catch (err) {
    Logger.error(err);
  }
}

/** Search the local catalogue in one locale — no upstream request at all. */
export function searchSeries(query: string, limit = 24, offset = 0, lang: string) {
  const handle = init();
  if (!handle) return null;

  try {
    const rows = handle
      .query(
        `SELECT slug, title, poster, provider, total_episodes
           FROM series
          WHERE lang = ? AND title LIKE ?
          ORDER BY updated_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(lang, `%${query}%`, limit, offset);

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

/**
 * Close the database on shutdown (src/index.ts, after the HTTP drain).
 *
 * Closing the last connection checkpoints the WAL back into the main file,
 * so a clean exit does not leave the next process — or the bridge still
 * running beside it during a deploy — replaying a long -wal file. `initialised`
 * stays true, so anything that still calls in after this gets `null` and
 * falls through to scraping instead of reopening the file mid-exit.
 */
export function closeStore(): void {
  if (!db) return;
  const handle = db;
  db = null;
  try {
    handle.close();
  } catch (err) {
    Logger.error(err);
  }
}
