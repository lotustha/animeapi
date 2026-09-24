/**
 * Walk the rest of one provider tab, page by page.
 *
 * narto shows each tab 24 titles at a time and loads more with
 * `only_tab=<tab>&tab_pages[<tab>]=<n>`. Only page 1 used to be read, so
 * AnyReel looked like 48 titles when it had ~190, and discover missed most of
 * every catalogue (measured 2026-09-24).
 *
 * Stops at the first page that adds nothing new (narto repeats the last page
 * rather than answering empty), at [maxPages], or at the first failure,
 * keeping everything gathered so far: a partial catalogue beats none.
 */
export async function collectTabPages<T extends { bookId: string }>(
  firstPage: T[],
  fetchPage: (page: number) => Promise<T[]>,
  { maxPages, pauseMs = 0 }: { maxPages: number; pauseMs?: number },
): Promise<T[]> {
  const seen = new Set(firstPage.map((i) => i.bookId));
  const out = [...firstPage];
  for (let page = 2; page <= maxPages; page++) {
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    let items: T[];
    try {
      items = await fetchPage(page);
    } catch {
      break;
    }
    const fresh = items.filter((i) => !seen.has(i.bookId));
    if (fresh.length === 0) break;
    for (const i of fresh) {
      seen.add(i.bookId);
      out.push(i);
    }
  }
  return out;
}
