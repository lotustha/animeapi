import * as cheerio from "cheerio";
import { Cache } from "../../../core/cache.js";
import { Logger } from "../../../core/logger.js";
import { ANIME_SALT_BASE } from "./constants.js";
import { getAsCdnSource } from "./scraper/as-cdn.js";
import { getRubystmSource } from "./scraper/rubystm.js";

import type { AnimeCard, LastEpisode, Season, Episode, DirectSource } from "./types.js";

export class AnimeSalt {
  private static async fetchHtml(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Fetch failed: " + url);
    return cheerio.load(await res.text());
  }

  static async home() {
    const key = "home";
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);

    try {
      const $ = await this.fetchHtml(ANIME_SALT_BASE + "/");

      const lastEpisodes: LastEpisode[] = [];

      $(".widget_list_episodes li").each((_, el) => {
        const url = $(el).find("a.lnk-blk").attr("href") || "";
        const img = $(el).find("img");

        let poster = img.attr("data-src") || img.attr("src") || "";
        if (poster.startsWith("//")) poster = "https:" + poster;

        lastEpisodes.push({
          title: img.attr("alt") || "",
          slug: url.split("/").pop() || "",
          url,
          thumbnail: poster,
          epXseason: "",
          ago: "",
        });
      });

      const result = { lastEpisodes };
      Cache.set(key, JSON.stringify(result), 43200);
      return result;
    } catch (err) {
      Logger.error(err);
      return null;
    }
  }

  static async search(query: string, page = 1) {
    const key = `search:${query}:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);

    try {
      const url =
        page === 1
          ? `${ANIME_SALT_BASE}/?s=${query}`
          : `${ANIME_SALT_BASE}/page/${page}/?s=${query}`;

      const $ = await this.fetchHtml(url);

      const data: AnimeCard[] = [];

      $(".aa-cn li").each((_, el) => {
        const link = $(el).find("a.lnk-blk");
        const url = link.attr("href") || "";

        const img = $(el).find("img");
        let poster = img.attr("data-src") || img.attr("src") || "";
        if (poster.startsWith("//")) poster = "https:" + poster;

        data.push({
          title: img.attr("alt") || "",
          slug: url.split("/").pop() || "",
          poster,
          url,
          type: url.includes("/series/") ? "series" : "movie",
        });
      });

      const result = { data };
      Cache.set(key, JSON.stringify(result), 43200);
      return result;
    } catch (err) {
      Logger.error(err);
      return null;
    }
  }

  static async category(type: string, page = 1, filter?: string) {
    const key = `category:${type}:${filter || "all"}:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);

    try {
      const url =
        ANIME_SALT_BASE +
        "/category/" +
        type +
        "/" +
        (page === 1 ? "" : `page/${page}/`) +
        (filter ? `?type=${filter}` : "");

      const $ = await this.fetchHtml(url);

      const data: AnimeCard[] = [];

      $(".aa-cn li").each((_, el) => {
        const link = $(el).find("a.lnk-blk");
        const url = link.attr("href") || "";

        const img = $(el).find("img");
        let poster = img.attr("data-src") || img.attr("src") || "";
        if (poster.startsWith("//")) poster = "https:" + poster;

        data.push({
          title: img.attr("alt") || "",
          slug: url.split("/").pop() || "",
          poster,
          url,
          type: url.includes("/series/") ? "series" : "movie",
        });
      });

      const current = page;
      const end = Number($("nav.pagination a.page-link").last().text() || 1);

      const result = {
        pagination: { current, start: 1, end },
        data,
      };

      Cache.set(key, JSON.stringify(result), 604800);
      return result;
    } catch (err) {
      Logger.error(err);
      return null;
    }
  }

  static async movies(page = 1) {
    const key = `movies:${page}`;
    const cached = await Cache.get(key);
    if (cached) return JSON.parse(cached);

    try {
      const url = `${ANIME_SALT_BASE}/movies/${page === 1 ? "" : `page/${page}/`}`;
      const $ = await this.fetchHtml(url);

      const data: AnimeCard[] = [];

      $(".aa-cn li").each((_, el) => {
        const link = $(el).find("a.lnk-blk");
        const url = link.attr("href") || "";

        const img = $(el).find("img");
        let poster = img.attr("data-src") || img.attr("src") || "";
        if (poster.startsWith("//")) poster = "https:" + poster;

        data.push({
          title: img.attr("alt") || "",
          slug: url.split("/").pop() || "",
          poster,
          url,
          type: "movie",
        });
      });

      const result = { data };
      Cache.set(key, JSON.stringify(result), 2592000);
      return result;
    } catch (err) {
      Logger.error(err);
      return null;
    }
  }

  static async movieInfo(slug: string) {
    try {
      const $ = await this.fetchHtml(`${ANIME_SALT_BASE}/movies/${slug}/`);

      const title = $("h1").text().trim();

      const poster = $(".bd img").attr("data-src") || $(".bd img").attr("src") || "";

      const description = $("#overview-text p").text().trim();

      const downloadLinks: any[] = [];

      $("table tbody tr").each((_, el) => {
        const row = $(el);
        downloadLinks.push({
          server: row.find("td").eq(0).text(),
          quality: row.find("td").eq(2).text(),
          url: row.find("a").attr("href"),
        });
      });

      const sources = await this.getSourcesFromPage($);

      return {
        title,
        poster,
        description,
        downloadLinks,
        ...sources,
      };
    } catch (err) {
      Logger.error(err);
      return null;
    }
  }

  static async seriesInfo(slug: string) {
    try {
      const $ = await this.fetchHtml(`${ANIME_SALT_BASE}/series/${slug}/`);

      const title = $("h1").text().trim();

      const bodyClass = $("body").attr("class") || "";
      const postId = bodyClass.match(/postid-(\d+)/)?.[1];

      const seasons = postId ? await this.getSeasons(postId) : [];

      return { title, seasons };
    } catch (err) {
      Logger.error(err);
      return null;
    }
  }

  static async *streams(slug: string) {
    try {
      const $ = await this.fetchHtml(`${ANIME_SALT_BASE}/episode/${slug}/`);

      const iframeUrls = $("iframe")
        .map((_, el) => $(el).attr("src"))
        .get()
        .filter(Boolean);

      const players = await this.extractPlayers(iframeUrls);

      for (const player of players) {
        try {
          const source = await this.extractSource(player);
          if (!source) continue;

          yield {
            id: player,
            title: "Auto",
            url: player,
            directUrl: source.url,
            quality: source.label || "auto",
            type: source.type || "hls",
          };
        } catch (_err) {}
      }
    } catch (err) {
      Logger.error(err);
    }
  }

  private static async getSeasons(postId: string) {
    const seasons: Season[] = [];

    for (let i = 1; i <= 20; i++) {
      try {
        const res = await fetch(`${ANIME_SALT_BASE}/wp-admin/admin-ajax.php`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
          body: `action=action_select_season&season=${i}&post=${postId}`,
        });

        const html = await res.text();
        const $ = cheerio.load(html);

        const episodes: Episode[] = [];

        $("li").each((_, el) => {
          const url = $(el).find("a").attr("href");
          if (!url) return;

          episodes.push({
            episode_no: episodes.length + 1,
            slug: url.split("/").pop() || "",
            title: $(el).text().trim(),
            epXseason: "",
            url,
            thumbnail: "",
          });
        });

        if (episodes.length === 0) break;

        seasons.push({
          label: `Season ${i}`,
          season_no: i,
          episodes,
        });
      } catch {
        break;
      }
    }

    return seasons;
  }

  private static async extractPlayers(urls: string[]) {
    const results: string[] = [];

    for (let url of urls) {
      if (url.startsWith("//")) url = "https:" + url;

      try {
        const $ = await this.fetchHtml(url);
        const iframe = $("iframe").attr("src");

        if (iframe) {
          results.push(iframe.startsWith("//") ? "https:" + iframe : iframe);
        }
      } catch (_err) {}
    }

    return results;
  }

  private static async extractSource(url: string): Promise<DirectSource | null> {
    if (url.includes("as-cdn")) return await getAsCdnSource(url);
    if (url.includes("rubystream")) return await getRubystmSource(url);
    return null;
  }

  private static async getSourcesFromPage($: cheerio.CheerioAPI) {
    const iframeUrls = $("iframe")
      .map((_, el) => $(el).attr("src"))
      .get()
      .filter(Boolean);

    const players = await this.extractPlayers(iframeUrls);

    const sources: DirectSource[] = [];

    for (const p of players) {
      const src = await this.extractSource(p);
      if (src) sources.push(src);
    }

    return { embeds: players, sources };
  }
}
