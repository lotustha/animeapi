import { describe, expect, it } from "vitest";
import {
  alternateSource,
  normaliseTitle,
  readVibeShortCards,
  readVibeShortEpisodeCount,
} from "./alternate-source.js";
import type { AlternateSite } from "./alternate-source.js";

// Shapes copied from vibeshort.org on 2026-09-25.
const SEARCH = `
<a href="/detail/bow-to-10-year-old-archmage-aldric-vibeshort_853878" class="drama-card" style="display:block"> <div>
 <img src="https://cdn.vibeshort.org/covers/vb/853878_fb3d7f24.webp" alt="Bow to 10-Year-Old Archmage Aldric" loading="lazy"></div></a>
<a href="/detail/submitting-to-my-bestie-s-dad-vibeshort-860001" class="drama-card"><img alt="Submitting to My Bestie&#39;s Dad"></a>`;

describe("vibeshort pages", () => {
  it("reads each search card's key and title", () => {
    expect(readVibeShortCards(SEARCH)).toEqual([
      ["bow-to-10-year-old-archmage-aldric-vibeshort_853878", "Bow to 10-Year-Old Archmage Aldric"],
      ["submitting-to-my-bestie-s-dad-vibeshort-860001", "Submitting to My Bestie's Dad"],
    ]);
  });

  it("counts episodes by the last one the detail page links", () => {
    const key = "bow-vibeshort_853878";
    const html = `<a href="/watch/${key}/1"></a><a href="/watch/${key}/130"></a><a href="/watch/${key}/12"></a><a href="/watch/other/999"></a>`;
    expect(readVibeShortEpisodeCount(html, key)).toBe(130);
  });
});

describe("normaliseTitle", () => {
  it("makes a narto slug and its title compare equal", () => {
    expect(normaliseTitle("bow-to-10-year-old-archmage-aldric")).toBe(normaliseTitle("Bow to 10-Year-Old Archmage Aldric"));
    expect(normaliseTitle("submitting-to-my-besties-dad")).toBe(normaliseTitle("Submitting to My Bestie&#39;s Dad"));
  });
});

describe("alternateSource", () => {
  const site = (over: Partial<AlternateSite> = {}) => {
    const calls = { find: 0 };
    const s: AlternateSite = {
      name: `fake-${Math.random()}`,
      apps: new Set(["shortmax"]),
      find: async () => (calls.find++, "key-1"),
      episodeUrl: async (_k, ep) => `https://cdn/ep${ep}.m3u8`,
      ...over,
    };
    return { s, calls };
  };

  it("serves the episode from a site carrying the app", async () => {
    const { s } = site();
    expect(await alternateSource("shortmax", "Some Title", 130, 76, [s], async () => 206)).toEqual({
      site: s.name,
      url: "https://cdn/ep76.m3u8",
    });
  });

  it("skips a site that does not carry the app", async () => {
    const { s, calls } = site();
    expect(await alternateSource("flextv", "Some Title", 130, 76, [s], async () => 206)).toBeNull();
    expect(calls.find).toBe(0);
  });

  it("gives nothing when the site has no matching series", async () => {
    const { s } = site({ find: async () => null });
    expect(await alternateSource("shortmax", "No Such Title", 130, 1, [s], async () => 206)).toBeNull();
  });

  it("gives nothing when the site's link does not play", async () => {
    const { s } = site();
    expect(await alternateSource("shortmax", "Other Title", 130, 5, [s], async () => 410)).toBeNull();
  });

  it("searches a real title as written, and a slug as words", async () => {
    const asked: string[] = [];
    const { s } = site({ find: async (q) => (asked.push(q), null) });
    await alternateSource("shortmax", "Bow to 10-Year-Old Archmage Aldric", 130, 1, [s], async () => 206);
    await alternateSource("shortmax", "bow-to-10-year-old-archmage-aldric", 131, 1, [s], async () => 206);
    expect(asked).toEqual(["Bow to 10-Year-Old Archmage Aldric", "bow to 10 year old archmage aldric"]);
  });

  it("gives up at its deadline when a site hangs", async () => {
    const { s } = site({ find: () => new Promise(() => {}) });
    const started = Date.now();
    expect(await alternateSource("shortmax", "Hanging Title", 130, 1, [s], async () => 206, 50)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("needs to know the app and the episode count", async () => {
    const { s, calls } = site();
    expect(await alternateSource(null, "T", 130, 1, [s], async () => 206)).toBeNull();
    expect(await alternateSource("shortmax", "T", 0, 1, [s], async () => 206)).toBeNull();
    expect(calls.find).toBe(0);
  });
});
