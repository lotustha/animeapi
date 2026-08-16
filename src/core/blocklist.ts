// Global DMCA blocklist, enforced for every anime provider at the /anime router
// (see src/providers/anime/route.ts). Blocking happens in two places:
//   1. onBeforeHandle — direct requests whose id/slug param matches are refused
//      with HTTP 451 before any upstream fetch.
//   2. onAfterHandle — every JSON response (cached responses included, so no
//      cache purge is needed on deploy) is deep-filtered: blocked items are
//      dropped from arrays and nulled out of objects.
//
// A title is blocked when its display title, slug, or AniList/MAL numeric id
// matches, so the block survives upstream slug or title changes.
//
// Current takedowns:
//   - Demon Slayer: Kimetsu no Yaiba (all seasons/movies) — MarkScan on behalf
//     of Crunchyroll, LLC (notice received 2026-08-16).
//   - Tomb Raider King — anikoto also blocks this at scrape time in
//     src/providers/anime/anikoto/blocklist.ts.

// "kimetsu" alone is intentional: it also catches franchise spin-offs like
// "Kimetsu Academy" (Kimetsu Gakuen), and no unrelated title uses the word.
const BLOCKED_TITLE_PATTERNS: RegExp[] = [/demon\W*slayer/i, /kimetsu/i, /鬼滅/];

// Matched against ids/slugs with all non-alphanumerics stripped, so any
// separator style ("demon-slayer", "demon_slayer", "demonslayer") is caught.
const BLOCKED_SQUASHED_SLUGS: string[] = ["demonslayer", "kimetsu"];

// AniList + MAL ids for every Demon Slayer entry (S1, Mugen Train movie + TV,
// Entertainment District, Swordsmith Village, Hashira Training, Infinity
// Castle movies 1-3, MLB collab). Used by providers keyed on numeric ids
// (anivid, animelok) and matched against idMal/malId fields in responses.
const BLOCKED_NUMERIC_IDS = new Set<string>([
  // AniList
  "101922",
  "112151",
  "129874",
  "142329",
  "145139",
  "166240",
  "178788",
  "187383",
  "195200",
  "195201",
  // MAL
  "38000",
  "40456",
  "47778",
  "49926",
  "51019",
  "55701",
  "59192",
  "61179",
  "62546",
  "62547",
]);

const TITLE_KEY_RE =
  /^(title|name|jname|jtitle|japanese.?title|english.?title|alt.?titles?|other.?names?|synonyms|english|romaji|native|user.?preferred)$/i;

const ID_KEY_RE = /^(id|slug|anime.?id|episode.?id|mal.?id|id.?mal|anilist.?id|al.?id)$/i;

export const DMCA_BLOCKED_RESPONSE = {
  error: "Unavailable For Legal Reasons",
  message: "This title has been removed from this API in response to a DMCA takedown notice.",
} as const;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isBlockedTitle(...titles: (string | null | undefined)[]): boolean {
  return titles.some((t) => t && BLOCKED_TITLE_PATTERNS.some((re) => re.test(t)));
}

/** Accepts a bare slug, numeric id, or composite episode id (`<id>$ep=..$..`). */
export function isBlockedId(idOrEpisodeId: string | number | null | undefined): boolean {
  if (idOrEpisodeId === null || idOrEpisodeId === undefined) return false;
  const s = String(idOrEpisodeId).toLowerCase();
  const squashed = s.replace(/[^a-z0-9]/g, "");
  if (BLOCKED_SQUASHED_SLUGS.some((part) => squashed.includes(part))) return true;
  const head = s.split("$")[0]!.trim();
  return /^\d+$/.test(head) && BLOCKED_NUMERIC_IDS.has(head);
}

/** True when any title-ish or id-ish field of the object matches the blocklist. */
export function isBlockedRecord(obj: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(obj)) {
    if (TITLE_KEY_RE.test(key)) {
      if (typeof value === "string" && isBlockedTitle(value)) return true;
      if (Array.isArray(value) && value.some((v) => typeof v === "string" && isBlockedTitle(v)))
        return true;
      // AniList-style nested title objects: { romaji, english, native }
      if (
        isPlainObject(value) &&
        Object.values(value).some((v) => typeof v === "string" && isBlockedTitle(v))
      )
        return true;
    }
    if (ID_KEY_RE.test(key)) {
      if (typeof value === "string" && isBlockedId(value)) return true;
      if (typeof value === "number" && BLOCKED_NUMERIC_IDS.has(String(value))) return true;
    }
  }
  return false;
}

/**
 * Recursively strips blocked entries from a JSON response: blocked objects are
 * removed from arrays (search results, spotlight, schedules, recommendations)
 * and replaced with null when they sit directly on an object property.
 */
export function deepFilterBlocked<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(isPlainObject(item) && isBlockedRecord(item)))
      .map((item) => deepFilterBlocked(item)) as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = isPlainObject(child) && isBlockedRecord(child) ? null : deepFilterBlocked(child);
    }
    return out as T;
  }
  return value;
}
