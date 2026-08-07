import * as cheerio from "cheerio";
import { Cache } from "../lib/cache.js";
import { EPISODE_IFRAMES_TTL, TOONSTREAM_BASE, UserAgent } from "../lib/const.js";
import { absolute, parseCard, parsePagination, slugOf } from "../lib/parse.js";
import { AnimeCard, Cast, Episode, Genre, Season, Tag } from "../lib/types.js";
import { getDirectSources, getPlayerIframeUrls } from "./source.js";

export async function ScrapeSeries(page: number = 1) {
  const url = TOONSTREAM_BASE + "/series" + (page === 1 ? "" : `/page/${page}`);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UserAgent } });
    if (!res.ok) throw new Error("Failed to fetch " + url);

    const $ = cheerio.load(await res.text());

    const data: AnimeCard[] = [];
    $("section.movies ul.post-lst li").each((_, item) => {
      const card = parseCard($, item);
      if (card) data.push(card);
    });

    return { pagination: parsePagination($, page), data };
  } catch (err) {
    console.log("ERROR", err);
  }
}

/** Shared detail-page parser — /series/<slug> and /movies/<slug> use one template. */
export function parseDetail($: cheerio.CheerioAPI) {
  const article = $("article.post, #aa-wp article").first();

  const title = article.find(".entry-title").first().text().trim();
  if (!title) return null;

  const year = article.find(".year").first().text().trim();
  const description = article.find(".description p").first().text().trim();
  const tmdbRating = Number(article.find(".vote .num").first().text().trim()) || 0;

  const genres: Genre[] = [];
  article.find(".genres a").each((_, el) => {
    const href = $(el).attr("href");
    const name = $(el).text().trim();
    if (!href || !name) return;
    genres.push({ name, slug: slugOf(href), url: absolute(href) });
  });

  const tags: Tag[] = [];
  article.find(".tag a, span.tag a").each((_, el) => {
    const href = $(el).attr("href");
    const name = $(el).text().trim();
    if (!href || !name) return;
    tags.push({ name, url: absolute(href) });
  });

  // Cast is injected client-side into <p class="loadactor"> on some pages, so
  // it can legitimately come back empty.
  const casts: Cast[] = [];
  article.find(".cast-lst a").each((_, el) => {
    const href = $(el).attr("href");
    const name = $(el).text().trim();
    if (!href || !name) return;
    casts.push({ name, url: absolute(href) });
  });

  return { title, year, description, tmdbRating, genres, tags, casts };
}

export async function ScrapeSeriesInfo(slug: string) {
  const url = `${TOONSTREAM_BASE}/series/${slug}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UserAgent } });
    if (!res.ok) throw new Error("Failed to fetch " + url);

    const $ = cheerio.load(await res.text());
    const base = parseDetail($);
    if (!base) throw new Error("title not found for " + url);

    // Season buttons carry the AJAX path:
    //   <a class="season-btn" data-season="1" data-url="/series/<slug>/season/1">
    const seasonRefs: { no: number; url: string }[] = [];
    $(".season-btn, [data-season]").each((_, el) => {
      const no = Number($(el).attr("data-season"));
      const dataUrl = $(el).attr("data-url");
      if (!Number.isFinite(no) || no <= 0) return;
      if (seasonRefs.some((s) => s.no === no)) return;
      seasonRefs.push({ no, url: absolute(dataUrl || `/series/${slug}/season/${no}`) });
    });

    // Single-season shows render the episode list inline with no buttons.
    if (seasonRefs.length === 0) seasonRefs.push({ no: 1, url: `${url}/season/1` });

    const seasons: Season[] = [];
    for (const ref of seasonRefs) {
      const episodes = await fetchSeasonEpisodes(ref.url, url);
      seasons.push({ label: `Season ${ref.no}`, season_no: ref.no, episodes });
    }

    const totalEpisodes = seasons.reduce((n, s) => n + s.episodes.length, 0);

    return {
      ...base,
      totalSeasons: seasons.length,
      totalEpisodes,
      languages: [] as string[],
      qualities: [] as string[],
      runtime: "",
      seasons,
    };
  } catch (err) {
    console.log("ERROR", err);
  }
}

/** The season endpoint returns bare <li> episode fragments, not a full page. */
async function fetchSeasonEpisodes(seasonUrl: string, referer: string): Promise<Episode[]> {
  const episodes: Episode[] = [];
  try {
    const res = await fetch(seasonUrl, {
      headers: {
        "User-Agent": UserAgent,
        Referer: referer,
        "X-Requested-With": "XMLHttpRequest",
        Accept: "text/html, */*; q=0.01",
      },
    });
    if (!res.ok) {
      console.log("Error: failed to fetch season at " + seasonUrl);
      return episodes;
    }

    const $ = cheerio.load(await res.text());
    $("li").each((i, ep) => {
      const href = $(ep).find("a[href*='/episode/']").attr("href") ?? $(ep).find("a").attr("href");
      if (!href) return;
      const thumbnail = $(ep).find("img").first().attr("src") ?? "";

      episodes.push({
        episode_no: i + 1,
        slug: slugOf(href),
        title: $(ep).find(".entry-title1, .entry-title").first().text().trim(),
        url: absolute(href),
        epXseason: $(ep).find(".num-epi").first().text().trim(),
        thumbnail,
      });
    });
  } catch (err) {
    console.log("ERROR fetching season", seasonUrl, err);
  }
  return episodes;
}

export async function ScrapeEpisodeSources(slug: string, req: Request) {
  const urlObj = new URL(req.url);
  const season = urlObj.searchParams.get("season");
  const episode = urlObj.searchParams.get("episode");

  // Episode slugs are "<series-slug>-<season>x<episode>". Accept a slug that
  // already carries the suffix so callers can pass what /series/info returned.
  const hasSuffix = /-\d+x\d+$/.test(slug);
  const epSlug = hasSuffix ? slug : `${slug}-${season ?? 1}x${episode ?? 1}`;
  const url = `${TOONSTREAM_BASE}/episode/${epSlug}/`;

  const key = `episode:iframes:${epSlug}`;
  const cachedIframes = await Cache.get(key, true);

  if (cachedIframes) {
    const directSources = await getDirectSources(cachedIframes);
    return {
      hash: hashOf(cachedIframes),
      embeds: cachedIframes,
      sources: directSources,
    };
  }

  try {
    const res = await fetch(url, { headers: { "User-Agent": UserAgent } });
    if (!res.ok) throw new Error("Failed to fetch " + url);

    const html = await res.text();
    const playerIframeUrls = await getPlayerIframeUrls(html, url);
    if (playerIframeUrls.length > 0) {
      Cache.set(key, true, playerIframeUrls, EPISODE_IFRAMES_TTL);
    }

    const directSources = await getDirectSources(playerIframeUrls);

    return {
      hash: hashOf(playerIframeUrls),
      embeds: playerIframeUrls,
      sources: directSources,
    };
  } catch (err) {
    console.log("ERROR", err);
  }
}

/** as-cdn player id, kept for clients that relied on this field. */
function hashOf(urls: string[]): string | null {
  const target = urls.find((u) => u.includes("as-cdn21.top/video/"));
  return target?.match(/\/video\/([^/?#]+)/)?.[1] ?? null;
}
