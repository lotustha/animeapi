import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { imageRefererFor } from "../../../core/helper.js";
import {
  buildSearchUrl,
  chapterNumber,
  parseDetail,
  parseGenres,
  parseHome,
  parseRead,
  parseSearch,
} from "./mangapill.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "__fixtures__", name), "utf8");

describe("mangapill search", () => {
  it("reads cards, badges by value, alt titles and the next page", () => {
    const data = parseSearch(fixture("search.html"), 1);
    expect(data.provider).toBe("MangaPill");
    expect(data.page).toBe(1);
    expect(data.hasNextPage).toBe(true);
    expect(data.results).toEqual([
      {
        id: "2",
        slug: "one-piece",
        title: "One Piece",
        altTitle: null,
        cover:
          "https://cdn.readdetectiveconan.com/file/mangapill/i/2.webp?h=01971742-5d7f-7f32-8d2b-d038279f8a73",
        type: "manga",
        status: "publishing",
        year: 1997,
      },
      {
        id: "5035",
        slug: "sousou-no-frieren",
        title: "Sousou no Frieren",
        altTitle: "Frieren - Beyond Journey's End",
        cover: "https://cdn.readdetectiveconan.com/file/mangapill/i/5035.jpeg",
        type: "manga",
        status: "on hiatus",
        year: 2020,
      },
    ]);
  });

  it("has no next page when only Previous / Next Chapter links exist", () => {
    const html = `<a class="btn btn-sm" href="/search?page=1">Previous</a>
      <a class="btn" href="/chapters/1-10001000/x"><div>Next Chapter</div></a>`;
    const data = parseSearch(html, 2);
    expect(data.hasNextPage).toBe(false);
    expect(data.results).toEqual([]);
  });

  it("lists genres from the filter form", () => {
    expect(parseGenres(fixture("search.html"))).toEqual(["Action", "Slice of Life", "Shounen"]);
  });

  it("builds browse URLs with repeated genres and encoded statuses", () => {
    const url = new URL(
      buildSearchUrl({
        q: "",
        status: "on hiatus",
        type: "manga",
        genres: ["Action", "Slice of Life"],
        page: 3,
      }),
    );
    expect(url.origin + url.pathname).toBe("https://mangapill.com/search");
    expect(url.searchParams.get("q")).toBe("");
    expect(url.searchParams.get("status")).toBe("on hiatus");
    expect(url.searchParams.getAll("genre")).toEqual(["Action", "Slice of Life"]);
    expect(url.searchParams.get("page")).toBe("3");
  });
});

describe("mangapill home", () => {
  it("takes trending and New Chapters, skipping Featured Chapters", () => {
    const { trending, recent } = parseHome(fixture("home.html"));
    expect(trending).toEqual([
      {
        id: "1",
        slug: "berserk",
        title: "Berserk",
        altTitle: null,
        cover: "https://cdn.readdetectiveconan.com/file/mangapill/i/1.jpeg",
        type: "manga",
        status: "publishing",
        year: 1989,
      },
    ]);
    expect(recent.map((r) => r.chapterId)).toEqual(["10544-10001000", "2085-10271500"]);
    expect(recent[0]).toMatchObject({
      id: "10544",
      slug: "hoshikita-kirara-wa-kiramekitai",
      title: "Hoshikita Kirara wa Kiramekitai!",
      altTitle: "Kirara Hoshikita Wants to Shine!",
      type: null,
      status: null,
      year: null,
      chapterNumber: 1,
      chapterTitle: "Chapter 1",
    });
    expect(recent[1]).toMatchObject({
      altTitle: null,
      chapterNumber: 271.5,
      chapterTitle: "Chapter 271.5",
    });
  });
});

describe("mangapill detail", () => {
  it("reads the header, labelled fields, scoped genres and chapters", () => {
    const d = parseDetail(fixture("detail.html"), "5035");
    expect(d).not.toBeNull();
    expect(d).toMatchObject({
      id: "5035",
      slug: "sousou-no-frieren",
      title: "Sousou no Frieren",
      altTitle: "Frieren - Beyond Journey's End",
      cover: "https://cdn.readdetectiveconan.com/file/mangapill/i/5035.jpeg",
      type: "manga",
      status: "on hiatus",
      year: 2020,
      genres: ["Adventure", "Drama", "Slice of Life"],
    });
    expect(d!.description).toBe(
      'The demon king has been defeated.\n\nFrieren "the Slayer" outlives her party.\n\n[Written by MAL Rewrite]',
    );
    expect(d!.chapters).toEqual([
      { id: "5035-10147000", number: 147, title: "Chapter 147" },
      { id: "5035-10146500", number: 146.5, title: "Chapter 146.5" },
      { id: "5035-10001000", number: 1, title: "Chapter 1" },
    ]);
  });

  it("returns null for a page that is not a manga", () => {
    expect(parseDetail("<html><body><p>nope</p></body></html>", "1")).toBeNull();
  });
});

describe("mangapill read", () => {
  it("takes only js-page images, in order, with the Referer header", () => {
    const r = parseRead(fixture("read.html"), "2085-10271500");
    expect(r).toEqual({
      id: "2085-10271500",
      mangaId: "2085",
      number: 271.5,
      title: "Chapter 271.5",
      pages: [
        {
          index: 1,
          url: "https://cdn.readdetectiveconan.com/file/mangap/2085/10271500/0197848f-614d-7deb-9012-fc1f1554165b/1.jpeg",
        },
        {
          index: 2,
          url: "https://cdn.readdetectiveconan.com/file/mangap/2085/10271500/0197848f-614d-7deb-9012-fc1f1554165b/2.jpeg",
        },
      ],
      imageHeaders: { Referer: "https://mangapill.com/" },
    });
  });

  it("returns null for a page that is not a chapter", () => {
    expect(parseRead("<html><body></body></html>", "1-10001000")).toBeNull();
  });
});

describe("chapter numbers", () => {
  it("prefers the label and falls back to the chapter code", () => {
    expect(chapterNumber("Chapter 1199")).toBe(1199);
    expect(chapterNumber("#262.2")).toBe(262.2);
    expect(chapterNumber("", "11199000")).toBe(1199);
    expect(chapterNumber("", "10262200")).toBe(262.2);
    expect(chapterNumber("Oneshot")).toBeNull();
  });
});

describe("image referer map", () => {
  it("gives the MangaPill CDN its Referer and leaves other hosts alone", () => {
    expect(imageRefererFor("https://cdn.readdetectiveconan.com/file/mangap/1.jpeg")).toBe(
      "https://mangapill.com/",
    );
    expect(imageRefererFor("https://example.com/a.jpg")).toBeNull();
    expect(imageRefererFor("https://notreaddetectiveconan.com/a.jpg")).toBeNull();
    expect(imageRefererFor("not a url")).toBeNull();
  });
});
