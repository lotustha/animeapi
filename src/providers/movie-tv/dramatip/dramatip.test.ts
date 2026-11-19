import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KNOWN_KEY, decrypt, keyInBundle } from "./crypto.js";
import {
  appKey,
  balanced,
  cleanPoster,
  lastPage,
  localePath,
  parseCards,
  parseInfo,
  parseSources,
  siteLocale,
  type Descriptor,
} from "./parse.js";
import { choose, mightPlay, verdictFor, viaMediaProxy } from "./playback.js";

// Pages and API answers saved from dramatip.net on 2026-11-19, cut down to the
// parts these functions read.
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const descriptor = (name: string) =>
  (JSON.parse(fixture(name)) as { descriptor: Descriptor }).descriptor;
const open = (enc: string) => decrypt(enc, KNOWN_KEY);

describe("locales", () => {
  it("maps ours to the site's, and knows which it lacks", () => {
    expect(siteLocale("en-US")).toBe("en");
    expect(siteLocale("hi-IN")).toBe("hi");
    expect(siteLocale("tl-PH")).toBe("fil");
    expect(siteLocale("zh-TW")).toBeNull();
    expect(siteLocale(undefined)).toBe("en");
  });

  it("English has no path prefix; the others do", () => {
    expect(localePath("en", "/series")).toBe("/series");
    expect(localePath("hi", "/series")).toBe("/hi/series");
  });
});

describe("parseCards", () => {
  it("reads a grid page", () => {
    const cards = parseCards(fixture("cards-grid.html"));
    expect(cards).toHaveLength(4);
    expect(cards[0]).toMatchObject({
      id: "your-loser-husband-is-a-big-shot",
      title: "Your Loser Husband Is A Big Shot",
      totalEpisodes: 50,
    });
    expect(cards[0].poster).toMatch(/^https:\/\/.+\.jpg$/);
  });

  // Every page has a "trending" rail of list links beside the grid. Read with
  // it, every search opened on the same six titles whatever was searched.
  it("reads a search page's results, not the trending rail beside them", () => {
    const html = fixture("cards-search.html");
    expect(html).toContain("the-secret-girl-s-four-beast-players"); // the rail
    const cards = parseCards(html);
    expect(cards).toHaveLength(4);
    for (const c of cards) expect(c.title).toMatch(/billionaire/i);
    expect(cards.map((c) => c.id)).not.toContain(
      "the-secret-girl-s-four-beast-players-31001956291",
    );
  });

  it("is not fooled by the menu's own /series links", () => {
    const html = '<article><a href="/series">Series</a><a href="/series/page/2">2</a></article>';
    expect(parseCards(html)).toEqual([]);
  });

  it("drops the image loader's width from a poster", () => {
    expect(cleanPoster("https://a.b/c.jpg?w=3840")).toBe("https://a.b/c.jpg");
    expect(cleanPoster("https://a.b/c.jpg@w=3840")).toBe("https://a.b/c.jpg");
    expect(cleanPoster("https://a.b/c.jpg?x=1")).toBe("https://a.b/c.jpg?x=1");
  });
});

describe("lastPage", () => {
  it("reads path and query pagination", () => {
    expect(lastPage(fixture("cards-grid.html"))).toBe(250);
    expect(lastPage(fixture("cards-search.html"))).toBe(371);
    expect(lastPage("<a href='/x'>no pages</a>")).toBe(1);
  });
});

describe("parseInfo", () => {
  const info = parseInfo(fixture("info.html"), "flash-marriage-sweet-love-3")!;

  it("reads title and synopsis from the JSON-LD", () => {
    expect(info.title).toBe("Flash Marriage Sweet Love");
    expect(info.description).toMatch(/^To save her late grandmother's bakery/);
  });

  it("reads every episode from the flight payload, in order", () => {
    expect(info.episodes).toHaveLength(35);
    expect(info.episodes.map((e) => e.number)).toEqual(
      Array.from({ length: 35 }, (_, i) => i + 1),
    );
    expect(info.episodes[0].thumbnail).toMatch(/^https:\/\//);
    expect(info.episodes.every((e) => e.isPlayable)).toBe(true);
  });

  it("names the upstream app and carries episode one's descriptor", () => {
    expect(info.sourceName).toBe("ToonShort");
    expect(info.first?.chain?.[0]?.type).toBe("hls");
    expect(mightPlay(info.first?.chain)).toBe(true);
  });

  it("answers null for a page with no title", () => {
    expect(parseInfo("<html><body></body></html>", "x")).toBeNull();
  });
});

describe("parseSources", () => {
  it("reads key, label and count, largest first", () => {
    const sources = parseSources(fixture("sources.html"));
    expect(sources.map((s) => s.key)).toEqual(["shorttv", "dramabox", "goodshort"]);
    expect(sources[1]).toEqual({ key: "dramabox", label: "DramaBox", count: 5977 });
  });

  it("files an app under a plain key", () => {
    expect(appKey("DramaBox")).toBe("dramabox");
    expect(appKey("My Drama-Wave")).toBe("mydramawave");
  });
});

describe("balanced", () => {
  it("is not ended by a brace inside a string", () => {
    const text = 'x{"a":"}{","b":[1,{"c":2}]}y';
    expect(balanced(text, 1)).toBe('{"a":"}{","b":[1,{"c":2}]}');
  });
});

describe("the key", () => {
  it("is found in the player's chunk", () => {
    expect(keyInBundle(fixture("player-chunk.txt"))).toBe(KNOWN_KEY);
    expect(keyInBundle("let x = 1;")).toBeNull();
  });

  it("opens a real blob, and a wrong key throws rather than returning junk", () => {
    const d = descriptor("api-toonshort.json");
    expect(open(d.chain![0].enc!)).toMatch(/^https:\/\/video\.toonshort\.com\/.+\.m3u8$/);
    const wrong = Buffer.alloc(32, 7).toString("base64");
    expect(() => decrypt(d.chain![0].enc!, wrong)).toThrow();
  });
});

describe("choosing a source", () => {
  it("ToonShort: a plain playlist, played directly", () => {
    const picked = choose(descriptor("api-toonshort.json").chain, open);
    expect(picked.ok).toBe(true);
    if (picked.ok === true) expect(picked.play).toMatchObject({ how: "direct", isM3U8: true });
  });

  it("GoodShort: HLS from an extensionless path", () => {
    const picked = choose(descriptor("api-goodshort.json").chain, open);
    if (picked.ok === false) throw new Error("expected a source");
    expect(picked.play.how).toBe("direct");
    expect(picked.play.isM3U8).toBe(true);
    expect(picked.play.url).toMatch(/^https:\/\/goodshort\./);
  });

  // DramaBox lists its signed, content-encrypted MP4 first and a plain HLS
  // mirror second. Taking the first entry returns a file no player can open.
  it("DramaBox: skips the encrypted mp4 for the HLS mirror", () => {
    const picked = choose(descriptor("api-dramabox.json").chain, open);
    if (picked.ok === false) throw new Error("expected a source");
    expect(picked.entry.type).toBe("hls");
    expect(picked.play.url).toMatch(/\.m3u8$/);
    expect(picked.play.url).not.toMatch(/encrypt/);
  });

  it("ShortTV: only through the media proxy, which wants the origin", () => {
    const picked = choose(descriptor("api-shorttv.json").chain, open);
    if (picked.ok === false) throw new Error("expected a source");
    expect(picked.play.how).toBe("origin-proxy");
    expect(picked.play.url).toMatch(/^https:\/\/cdn\.dramadizilerim\.xyz\/https\/.+\.m3u8/);
  });

  it("a type nobody has looked at fails closed", () => {
    expect(verdictFor("hls-enc", "https://a.b/c.m3u8").how).toBe("unsupported");
    expect(verdictFor(undefined, "https://a.b/c.m3u8").how).toBe("unsupported");
    expect(verdictFor("hls", "not a url").how).toBe("unsupported");
    expect(mightPlay([{ type: "storyreel", enc: "x" }])).toBe(false);
  });

  it("a chain that will not decrypt says so, entry by entry", () => {
    const wrong = Buffer.alloc(32, 7).toString("base64");
    const picked = choose(descriptor("api-toonshort.json").chain, (e) => decrypt(e, wrong));
    expect(picked.ok).toBe(false);
    if (picked.ok === false) expect(picked.why.every((w) => w.includes("undecryptable"))).toBe(true);
  });

  it("addresses a CDN url the way the media proxy expects", () => {
    expect(viaMediaProxy("https://h.example/a/b.m3u8?x=1")).toBe(
      "https://cdn.dramadizilerim.xyz/https/h.example/a/b.m3u8?x=1",
    );
  });
});
