/**
 * Normalise an anime title into animelok's URL slug.
 * e.g. "Re:ZERO -Starting Life in Another World- Season 4"
 *        → "re-zero-starting-life-in-another-world-season-4"
 *
 * animelok keys its API on `${titleToSlug(title)}-${anilistId}` and returns an
 * empty payload when the slug text doesn't match — verified that the canonical
 * title is AniList's English title (romaji is the fallback).
 */
export function titleToSlug(title: string): string {
  return title
    .replace(/[^\w\s-]/g, " ") // brackets/colons/commas → space
    .toLowerCase()
    .replace(/[\s_]+/g, "-") // whitespace/underscores → single dash
    .replace(/-+/g, "-") // collapse repeated dashes
    .replace(/^-+|-+$/g, ""); // trim leading/trailing dashes
}

/** Build the full animelok slug from a title + AniList ID. */
export function buildFullSlug(title: string, anilistId: string | number): string {
  return `${titleToSlug(title)}-${anilistId}`;
}
