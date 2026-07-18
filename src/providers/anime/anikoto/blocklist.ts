// Titles removed from every anikoto response due to DMCA takedown notices.
// A title is blocked when either its /watch/<slug> slug or any of its display
// titles matches, so the block survives upstream slug or title changes.
// To lift a takedown, delete its entries here and purge the anikoto cache:
//   POST /admin/cache/purge?prefix=anikoto:  (x-admin-token header)
const BLOCKED_SLUG_PARTS: string[] = ["tomb-raider-king"];

const BLOCKED_TITLE_PATTERNS: RegExp[] = [/tomb\s*raider\s*king/i];

/** Accepts a bare slug or a composite episode id (`<slug>$ep=..$id=..`). */
export function isBlockedSlug(slugOrEpisodeId: string | null | undefined): boolean {
  if (!slugOrEpisodeId) return false;
  const slug = slugOrEpisodeId.split("$")[0]!.toLowerCase();
  return BLOCKED_SLUG_PARTS.some((part) => slug.includes(part));
}

export function isBlockedTitle(...titles: (string | null | undefined)[]): boolean {
  return titles.some((t) => t && BLOCKED_TITLE_PATTERNS.some((re) => re.test(t)));
}

export function isBlocked(
  slugOrEpisodeId: string | null | undefined,
  ...titles: (string | null | undefined)[]
): boolean {
  return isBlockedSlug(slugOrEpisodeId) || isBlockedTitle(...titles);
}
