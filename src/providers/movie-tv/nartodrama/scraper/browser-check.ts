/**
 * narto-drama's "Checking your browser" wall.
 *
 * On or before 2026-09-17 narto put its listing pages (home, search, genre,
 * tag) behind a ~1.5 KB stub that sets an `nd_ck` cookie and reloads. A
 * browser passes it without noticing. This scraper did not: it parsed the
 * stub, found no cards, and answered every listing with an empty page — and
 * the daily discover job read that as "nothing new upstream" for a week.
 *
 * The wall checks only that the cookie is present, so one value per process,
 * sent on every page request, is what a browser would do. Watch pages were not
 * walled at the time; they get it too, so the next wall costs nothing.
 */
const value =
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10).padEnd(8, "0");

/** The `Cookie` header value that passes the wall. Stable for the process. */
export function browserCheckCookie(): string {
  return `nd_ck=${value}`;
}

/**
 * Whether [html] is the wall rather than a page.
 *
 * Small AND sets `nd_ck`: a real listing is hundreds of KB, so a large page
 * that merely mentions the cookie is not the stub. Used to fail loudly if the
 * wall changes shape and the cookie stops being enough — an empty result is
 * exactly how the last one went unnoticed.
 */
export function isBrowserCheck(html: string): boolean {
  return html.length < 20_000 && html.includes("nd_ck");
}
