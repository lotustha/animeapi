import * as cheerio from "cheerio";
import { TOONSTREAM_BASE, UserAgent } from "../lib/const.js";
import { parseCard } from "../lib/parse.js";
import { AnimeCard } from "../lib/types.js";

// Search moved from WordPress's `/?s=` to `/s?q=` and is NOT paginated — the
// endpoint returns every match in one response. The `page` argument is kept for
// route compatibility; pagination is reported as a single page so existing
// clients don't loop forever asking for page 2.
export async function ScrapeSearch(query: string, page: number = 1) {
  const q = encodeURIComponent(decodeURIComponent(query));
  const url = `${TOONSTREAM_BASE}/s?q=${q}`;

  try {
    const res = await fetch(url, { headers: { "User-Agent": UserAgent } });
    if (!res.ok) throw new Error("Failed to fetch " + url);

    const html = await res.text();
    const $ = cheerio.load(html);

    const data: AnimeCard[] = [];
    $("section.movies ul.post-lst li").each((_, item) => {
      const card = parseCard($, item);
      if (card) data.push(card);
    });

    const pagination = { current: 1, start: 1, end: 1 };
    return { query, pagination, data, page };
  } catch (err) {
    console.log("ERROR", err);
  }
}
