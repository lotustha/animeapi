import * as cheerio from "cheerio";
import { Cache } from "../lib/cache.js";
import { MOVIE_IFRAMES_TTL, TOONSTREAM_BASE, UserAgent } from "../lib/const.js";
import { parseCard, parsePagination } from "../lib/parse.js";
import { AnimeCard } from "../lib/types.js";
import { parseDetail } from "./series.js";
import { getDirectSources, getPlayerIframeUrls } from "./source.js";

// There is no bare /movies index on the rebuilt site — that path 500s. The
// browsable movie listing is the "movies" category, which is paginated by
// query string rather than a /page/N path segment. It mixes in a handful of
// series, so filter by the link type to keep this endpoint's contract.
export async function ScrapeMovies(page: number = 1) {
  const url = `${TOONSTREAM_BASE}/category/movies?type=all&page=${page}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UserAgent } });
    if (!res.ok) throw new Error("Failed to fetch " + url);

    const $ = cheerio.load(await res.text());

    const data: AnimeCard[] = [];
    $("section.movies ul.post-lst li, article.post").each((_, item) => {
      const card = parseCard($, item);
      if (card && card.type === "movie" && !data.some((d) => d.slug === card.slug)) {
        data.push(card);
      }
    });

    return { pagination: parsePagination($, page), data };
  } catch (err) {
    console.log("ERROR", err);
  }
}

export async function ScrapeMovieInfo(slug: string) {
  const url = `${TOONSTREAM_BASE}/movies/${slug}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UserAgent } });
    if (!res.ok) throw new Error("Failed to fetch " + url);

    const $ = cheerio.load(await res.text());
    const base = parseDetail($);
    if (!base) throw new Error("title not found for " + url);

    // Runtime shows in the meta row; the rebuild dropped the separate
    // language/quality paragraphs the old WordPress template carried.
    const duration = $("article .runtime, article .entry-meta .time").first().text().trim();

    return {
      ...base,
      duration,
      languages: [] as string[],
      qualities: [] as string[],
    };
  } catch (err) {
    console.log("ERROR", err);
  }
}

export async function ScrapeMovieSources(slug: string) {
  const url = `${TOONSTREAM_BASE}/movies/${slug}`;

  const key = `movie:iframes:${slug}`;
  const cachedIframes = await Cache.get(key, true);

  if (cachedIframes) {
    const directSources = await getDirectSources(cachedIframes);
    return { embeds: cachedIframes, sources: directSources };
  }

  try {
    const res = await fetch(url, { headers: { "User-Agent": UserAgent } });
    if (!res.ok) throw new Error("Failed to fetch " + url);

    const html = await res.text();
    const playerIframeUrls = await getPlayerIframeUrls(html, url);
    if (playerIframeUrls.length > 0) {
      Cache.set(key, true, playerIframeUrls, MOVIE_IFRAMES_TTL);
    }

    const directSources = await getDirectSources(playerIframeUrls);

    return { embeds: playerIframeUrls, sources: directSources };
  } catch (err) {
    console.log("ERROR", err);
  }
}
