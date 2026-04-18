import * as cheerio from "cheerio";

export function parseItems($: cheerio.CheerioAPI, selector: string) {
  const items: any[] = [];
  $(selector).each((_, element) => {
    const type = $(element).find("span.float-right.fdi-type").text().trim();
    const baseData = {
      id:
        $(element)
          .find("a.film-poster-ahref.flw-item-tip")
          .attr("href")
          ?.slice(1)
          .replace("/", "-") || null,
      name: $(element).find("h3.film-name").text().trim() || null,
      posterImage: $(element).find("img.film-poster-img.lazyload").attr("data-src") || null,
      quality: $(element).find("div.pick.film-poster-quality").text().trim() || null,
      type,
    };
    if (type === "Movie") {
      items.push({
        ...baseData,
        type: "Movie",
        releaseDate: $(element).find("div.fd-infor > span.fdi-item:first").text().trim() || null,
        duration: $(element).find("div.fd-infor > span.fdi-duration").text().trim() || null,
      });
    } else if (type === "TV") {
      const seasonText = $(element).find("div.fd-infor > span.fdi-item:first").text().trim();
      const episodesText = $(element).find("div.fd-infor > span.fdi-item").eq(1).text().trim();
      let seasons = null;
      if (seasonText && seasonText.startsWith("SS")) {
        const seasonNum = parseInt(seasonText.replace(/\D+/g, ""), 10);
        seasons = Number.isNaN(seasonNum) ? null : seasonNum;
      }
      let totalEpisodes = null;
      if (episodesText && episodesText.startsWith("EPS")) {
        const episodesNum = parseInt(episodesText.replace(/\D+/g, ""), 10);
        totalEpisodes = Number.isNaN(episodesNum) ? null : episodesNum;
      }
      items.push({
        ...baseData,
        type: "TV",
        seasons,
        totalEpisodes,
      });
    }
  });
  return items;
}

export function parseMixedSection($: cheerio.CheerioAPI, selector: string) {
  const items: any[] = [];
  $(selector).each((_, element) => {
    const type = $(element).find("span.float-right.fdi-type").text().trim();
    const baseData = {
      id:
        $(element)
          .find("a.film-poster-ahref.flw-item-tip")
          .attr("href")
          ?.slice(1)
          .replace("/", "-") || null,
      name: $(element).find("h3.film-name").text().trim() || null,
      posterImage: $(element).find("img.film-poster-img.lazyload").attr("data-src") || null,
      quality: $(element).find("div.pick.film-poster-quality").text().trim() || null,
      type,
    };
    if (type === "Movie") {
      items.push({
        ...baseData,
        type: "Movie",
        releaseDate: $(element).find("div.fd-infor > span.fdi-item:first").text().trim() || null,
        duration: $(element).find("div.fd-infor > span.fdi-duration").text().trim() || null,
      });
    } else if (type === "TV") {
      const releaseDate =
        $(element).find("div.fd-infor > span.fdi-item:first").text().trim() || null;
      const seasonText = $(element).find("div.fd-infor > span.fdi-item").eq(1).text().trim();
      const episodesText = $(element).find("div.fd-infor > span.fdi-item").eq(2).text().trim();
      let seasons = null;
      if (seasonText && seasonText.startsWith("SS")) {
        const seasonNum = parseInt(seasonText.replace(/\D+/g, ""), 10);
        seasons = Number.isNaN(seasonNum) ? null : seasonNum;
      }
      let totalEpisodes = null;
      if (episodesText && episodesText.startsWith("EPS")) {
        const episodesNum = parseInt(episodesText.replace(/\D+/g, ""), 10);
        totalEpisodes = Number.isNaN(episodesNum) ? null : episodesNum;
      }
      items.push({
        ...baseData,
        type: "TV",
        releaseDate,
        seasons,
        totalEpisodes,
      });
    }
  });
  return items;
}

export function parseHome($: cheerio.CheerioAPI) {
  const trendingMoviesSelector = "div.tab-content div#trending-movies div.flw-item";
  const trendingTvSelector = "div.tab-content div#trending-tv div.flw-item";
  const trending = {
    Movies: parseItems($, trendingMoviesSelector),
    Tv: parseItems($, trendingTvSelector),
  };
  const recentMoviesSelector =
    "section.block_area.block_area_home.section-id-02:first div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item";
  const recentTvSelector =
    "section.block_area.block_area_home.section-id-02:eq(1) div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item";
  const recentReleases = {
    Movies: parseItems($, recentMoviesSelector),
    Tv: parseItems($, recentTvSelector),
  };
  const upcomingSelector =
    "section.block_area.block_area_home.section-id-02:eq(2) div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item";
  const upcoming = parseMixedSection($, upcomingSelector);
  return {
    trending,
    recentReleases,
    upcoming,
  };
}

export function parsePaginatedResults($: cheerio.CheerioAPI, selector: string) {
  const paginationElement = $("div.pre-pagination:last ul.pagination-lg.justify-content-center");
  const hasNextPage =
    ($(".pagination > li").length > 0 &&
      $(".pagination li.active").length > 0 &&
      !$(".pagination > li").last().hasClass("active")) ||
    false;
  const currentPage = Number(
    $(paginationElement).find('li[class="page-item active"]').text().trim() || 1,
  );
  const lastPageAttr = paginationElement.find('a.page-link[title="Last"]').attr("href");
  const lastPage = Number(
    lastPageAttr?.split("page=").at(-1) ||
      paginationElement.find("a.page-link:last").text().trim() ||
      currentPage,
  );

  const items: any[] = [];
  $(selector).each((_, element) => {
    const type = $(element).find("span.float-right.fdi-type").text().trim();
    const baseData = {
      id:
        $(element)
          .find("a.film-poster-ahref.flw-item-tip")
          .attr("href")
          ?.slice(1)
          .replace("/", "-") || null,
      name: $(element).find("h2.film-name").text().trim() || null,
      posterImage: $(element).find("img.film-poster-img.lazyload").attr("data-src") || null,
      quality: $(element).find("div.pick.film-poster-quality").text().trim() || null,
      type,
    };
    if (type === "Movie") {
      items.push({
        ...baseData,
        type: "Movie",
        releaseDate: $(element).find("div.fd-infor > span.fdi-item:first").text().trim() || null,
        duration: $(element).find("div.fd-infor > span.fdi-duration").text().trim() || null,
      });
    } else if (type === "TV") {
      const seasonText =
        $(element).find("div.fd-infor > span.fdi-item:first").text().trim() || null;
      const episodesText = $(element).find("div.fd-infor > span.fdi-item").eq(1).text().trim();
      let seasons = null;
      if (seasonText && seasonText.startsWith("SS")) {
        const seasonNum = parseInt(seasonText.replace(/\D+/g, ""), 10);
        seasons = Number.isNaN(seasonNum) ? null : seasonNum;
      }
      let totalEpisodes = null;
      if (episodesText && episodesText.startsWith("EPS")) {
        const episodesNum = parseInt(episodesText.replace(/\D+/g, ""), 10);
        totalEpisodes = Number.isNaN(episodesNum) ? null : episodesNum;
      }
      items.push({
        ...baseData,
        type: "TV",
        seasons,
        totalEpisodes,
      });
    }
  });

  return { hasNextPage, currentPage, lastPage, data: items };
}

export function parseSearchSuggestions($: cheerio.CheerioAPI) {
  const selector = "a.nav-item";
  const items: any[] = [];
  $(selector).each((_, element) => {
    const type = $(element).find("div.film-infor span:last").text().trim();
    const baseData = {
      id: $(element).attr("href")?.slice(1).replace("/", "-") || null,
      name: $(element).find("h3.film-name").text().trim() || null,
      posterImage: $(element).find("img.film-poster-img").attr("src") || null,
      quality: $(element).find("div.pick.film-poster-quality").text().trim() || null,
      type,
    };
    if (type === "Movie") {
      items.push({
        ...baseData,
        type: "Movie",
        releaseDate: $(element).find("div.film-infor > span:first").text().trim() || null,
        duration: $(element).find("div.film-infor > span").eq(1).text().trim() || null,
      });
    } else if (type === "TV") {
      const seasonText = $(element).find("div.film-infor > span:first").text().trim() || null;
      const episodesText = $(element).find("div.film-infor> span").eq(1).text().trim();
      let seasons = null;
      if (seasonText && seasonText.startsWith("SS")) {
        const seasonNum = parseInt(seasonText.replace(/\D+/g, ""), 10);
        seasons = Number.isNaN(seasonNum) ? null : seasonNum;
      }
      let totalEpisodes = null;
      if (episodesText && episodesText.startsWith("EPS")) {
        const episodesNum = parseInt(episodesText.replace(/\D+/g, ""), 10);
        totalEpisodes = Number.isNaN(episodesNum) ? null : episodesNum;
      }
      items.push({
        ...baseData,
        type: "TV",
        seasons,
        totalEpisodes,
      });
    }
  });
  return { data: items };
}

export function parseInfoRecommendedSection($: cheerio.CheerioAPI) {
  const items: any[] = [];
  const selector = "div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item";
  $(selector).each((_, element) => {
    const type = $(element).find("span.float-right.fdi-type").text().trim();
    const baseData = {
      id:
        $(element)
          .find("a.film-poster-ahref.flw-item-tip")
          .attr("href")
          ?.slice(1)
          .replace("/", "-") || null,
      name: $(element).find("h3.film-name").text().trim() || null,
      posterImage: $(element).find("img.film-poster-img.lazyload").attr("data-src") || null,
      quality: $(element).find("div.pick.film-poster-quality").text().trim() || null,
      type,
    };
    if (type === "Movie") {
      items.push({
        ...baseData,
        type: "Movie",
        releaseDate: $(element).find("div.fd-infor > span.fdi-item:first").text().trim() || null,
        duration: $(element).find("div.fd-infor > span.fdi-duration").text().trim() || null,
      });
    } else if (type === "TV") {
      const seasonText =
        $(element).find("div.fd-infor > span.fdi-item:first").text().trim() || null;
      const episodesText = $(element).find("div.fd-infor > span.fdi-item").eq(1).text().trim();
      let seasons = null;
      if (seasonText && seasonText.startsWith("SS")) {
        const seasonNum = parseInt(seasonText.replace(/\D+/g, ""), 10);
        seasons = Number.isNaN(seasonNum) ? null : seasonNum;
      }
      let totalEpisodes = null;
      if (episodesText && episodesText.startsWith("EPS")) {
        const episodesNum = parseInt(episodesText.replace(/\D+/g, ""), 10);
        totalEpisodes = Number.isNaN(episodesNum) ? null : episodesNum;
      }
      items.push({
        ...baseData,
        type: "TV",
        seasons,
        totalEpisodes,
      });
    }
  });
  return items;
}

export function parseInfo($: cheerio.CheerioAPI) {
  const recommended = parseInfoRecommendedSection($);
  const id = $("h2.heading-name > a").attr("href")?.slice(1).replace("/", "-") || null;
  const type = id?.includes("tv") ? "TV" : "Movie";
  const mediaInfo = {
    id,
    name: $("h2.heading-name > a").text().trim() || null,
    posterImage: $("div.film-poster.mb-2 > img.film-poster-img").attr("src") || null,
    type: type || null,
    quality: $("span.item.mr-1 > button.btn.btn-sm.btn-quality > strong").text().trim() || null,
    releaseDate:
      $('.row-line:has(strong:contains("Released:"))').text().replace("Released:", "").trim() ||
      null,
    genre:
      $('.row-line:has(strong:contains("Genre:")) a')
        .map((i, el) => $(el).text().split("&"))
        .get()
        .map((v) => v.trim()) || null,
    casts:
      $('.row-line:has(strong:contains("Casts:")) a')
        .map((i, el) => $(el).text().trim())
        .get() || null,
    duration:
      $('.row-line:has(strong:contains("Duration:"))')
        .text()
        .replace("Duration:", "")
        .replace(/\s+/g, " ")
        .trim() || null,
    score:
      Number($("span.item.mr-2 > button.btn.btn-sm.btn-imdb").text().replace("IMDB:", "").trim()) ||
      null,
    country:
      $('.row-line:has(strong:contains("Country:")) a')
        .map((i, el) => $(el).text().trim())
        .get() || null,
    production:
      $('.row-line:has(strong:contains("Production:"))')
        .text()
        .replace("Production:", "")
        .replace(/\s+/g, " ")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean) || null,
    trailer: $("iframe#iframe-trailer").attr("data-src") || null,
    synopsis: $(".description").text().trim() || null,
  };
  return { data: mediaInfo, recommended };
}

export function parseSeasons($: cheerio.CheerioAPI) {
  return $(".dropdown-menu > a")
    .map((_, el) => {
      const seasonId = $(el).attr("data-id");
      const label = $(el).text().trim();
      const seasonNumber = parseInt(label.replace(/\D/g, ""), 10) || 1;
      return { seasonId, seasonNumber };
    })
    .get();
}

export function parseEpisodes(
  $: cheerio.CheerioAPI,
  seasonNumber: number,
  tvId: string,
  mediaId: string,
) {
  return $(".nav > li")
    .map((_, el) => {
      const anchor = $(el).find("a");
      const rawId = anchor.attr("id");
      const title = anchor.attr("title");
      const episodeTitle = title.split(":").at(1)?.trim() || null;
      return {
        episodeId: tvId
          ? `${tvId.replace("watch-", "")}-episode-${rawId.split("-")[1]}`
          : `${mediaId.replace("watch-", "")}-episode-${rawId.split("-")[1]}`,
        title: episodeTitle,
        episodeNumber: parseInt(title.split(":")[0].slice(3).trim(), 10) || null,
        seasonNumber: seasonNumber || null,
      };
    })
    .get();
}

export function parseServers($: cheerio.CheerioAPI) {
  const servers: any[] = [];
  $("ul.nav > li.nav-item").each((_, element) => {
    servers.push({
      serverId: $(element).find("a").attr("data-id") || null,
      serverName: $(element).find("a").text().trim().toLowerCase() || null,
    });
  });
  return servers;
}
