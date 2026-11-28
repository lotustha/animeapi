import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCard, parseInfo, parseList } from "./nartodramas.js";

const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, "fixtures", name), "utf8"));

describe("nartodramas parsing", () => {
  it("reads a search page, and knows when there is another", () => {
    const page = parseList(fixture("search.json"), 1);
    expect(page.results.length).toBe(3);
    expect(page.results[0]).toMatchObject({ id: "the-bride-s-deadly-rematch", provider: "ShortPeak", totalEpisodes: 30 });
    expect(page.results[0].poster).toMatch(/^https:\/\//);
    expect(page.hasNextPage).toBe(true); // total 121, 24 a page
    expect(parseList({ items: [], total: 24, pageSize: 24 }, 1).hasNextPage).toBe(false);
  });

  it("drops a card without a usable slug or title", () => {
    expect(parseCard({ slug: "../x", title: "t" })).toBeNull();
    expect(parseCard({ slug: "ok", title: " " })).toBeNull();
  });

  it("keeps only available episodes that carry a link, but counts all for the total", () => {
    const info = parseInfo(fixture("info.json"))!;
    expect(info.id).toBe("the-bride-s-deadly-rematch");
    expect(info.episodes.map((e) => e.number)).toEqual([1, 2, 3]);
    expect(info.totalEpisodes).toBe(4);
    expect(info.tags).toEqual(["Revenge", "Strong"]);
  });

  it("is null for a title with nothing to play", () => {
    expect(parseInfo({ item: { slug: "x", title: "X", episodes: [{ episode_number: 1, video_url: "", available: true }] } })).toBeNull();
    expect(parseInfo({ error: "Not found" })).toBeNull();
  });
});
