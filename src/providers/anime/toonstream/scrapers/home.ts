import * as cheerio from "cheerio";
import { TOONSTREAM_BASE, UserAgent } from "../lib/const.js";
import { absolute, parseCard, slugOf } from "../lib/parse.js";
import { AnimeCard, LastEpisode, MainSection, SidebarSection } from "../lib/types.js";

export async function ScrapeHomePage() {
  try {
    const url = TOONSTREAM_BASE + "/home";
    const res = await fetch(url, { headers: { "User-Agent": UserAgent } });
    if (!res.ok) throw new Error("Failed to fetch " + url);

    const html = await res.text();
    // NOTE: parsed as HTML, not xml:true — the rebuilt pages contain unclosed
    // tags that htmlparser2's xml mode drops, which silently emptied the rails.
    const $ = cheerio.load(html);

    // Home rails render as swiper carousels (.swiper-slide > article.post),
    // while list pages use <ul class="post-lst"><li>. Match article.post
    // directly so one selector covers both.
    const CARD = "article.post";

    /* SIDEBAR */
    const sidebarSections: SidebarSection[] = [];
    $("aside.sidebar section").each((_, section) => {
      const label = $(section).find(".section-title").first().text().trim();
      if (!label) return;

      const data: AnimeCard[] = [];
      $(section)
        .find(CARD)
        .each((_, item) => {
          const card = parseCard($, item);
          if (card) data.push(card);
        });

      if (data.length > 0) sidebarSections.push({ label, data });
    });

    /* LAST EPISODES */
    // The "latest episodes" rail uses the same card markup as everything else;
    // an /episode/ href is what distinguishes it.
    const lastEpisodes: LastEpisode[] = [];
    const seenEpisodes = new Set<string>();
    $(`${CARD}:has(a[href*='/episode/'])`).each((_, ep) => {
      const href = $(ep).find("a[href*='/episode/']").attr("href");
      if (!href) return;
      const slug = slugOf(href);
      if (!slug || seenEpisodes.has(slug)) return;
      seenEpisodes.add(slug);

      lastEpisodes.push({
        title: $(ep).find(".entry-title, .entry-title1").first().text().trim(),
        slug,
        url: absolute(href),
        epXseason: $(ep).find(".num-epi").first().text().trim(),
        ago: $(ep).find(".time").first().text().trim(),
        thumbnail: $(ep).find("img").first().attr("src") ?? "",
      });
    });

    /* MAIN RAILS */
    // Each rail is its own <section> carrying a .section-title; the markup
    // class varies (wdgt-home / widget / movies), so key off the title instead.
    const mainSections: MainSection[] = [];
    $("section").each((_, sect) => {
      if ($(sect).closest("aside.sidebar").length > 0) return; // counted above
      const label = $(sect).find(".section-title").first().text().trim();
      if (!label) return;

      const data: AnimeCard[] = [];
      $(sect)
        .find(CARD)
        .each((_, item) => {
          const card = parseCard($, item);
          if (card) data.push(card);
        });

      if (data.length === 0) return;
      const viewMore = $(sect).find("header a").attr("href");
      mainSections.push({ label, viewMore: viewMore ? absolute(viewMore) : undefined, data });
    });

    return { main: mainSections, sidebar: sidebarSections, lastEpisodes };
  } catch (err) {
    console.log("Error", err);
  }
}
