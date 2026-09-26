import { describe, expect, it } from "vitest";
import {
  alternateSource,
  normaliseTitle,
  readReelAllSearch,
  readReelAllSeries,
  readVibeShortCards,
  readVibeShortEpisodeCount,
  reelAll,
  reelAllDramaBox,
  reelAllFlexTv,
  reelAllTitle,
  vibeShort,
} from "./alternate-source.js";
import type { AlternateSite } from "./alternate-source.js";
import { fileKey } from "./duplicate-episode.js";

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
    expect(await alternateSource("shortmax", "Some Title", 130, 76, "en-US", [s], async () => 206)).toEqual({
      site: s.name,
      url: "https://cdn/ep76.m3u8",
    });
  });

  it("skips a site that does not carry the app", async () => {
    const { s, calls } = site();
    expect(await alternateSource("flextv", "Some Title", 130, 76, "en-US", [s], async () => 206)).toBeNull();
    expect(calls.find).toBe(0);
  });

  it("gives nothing when the site has no matching series", async () => {
    const { s } = site({ find: async () => null });
    expect(await alternateSource("shortmax", "No Such Title", 130, 1, "en-US", [s], async () => 206)).toBeNull();
  });

  it("gives nothing when the site's link does not play", async () => {
    const { s } = site();
    expect(await alternateSource("shortmax", "Other Title", 130, 5, "en-US", [s], async () => 410)).toBeNull();
  });

  it("searches a real title as written, and a slug as words", async () => {
    const asked: string[] = [];
    const { s } = site({ find: async (q) => (asked.push(q), null) });
    await alternateSource("shortmax", "Bow to 10-Year-Old Archmage Aldric", 130, 1, "en-US", [s], async () => 206);
    await alternateSource("shortmax", "bow-to-10-year-old-archmage-aldric", 131, 1, "en-US", [s], async () => 206);
    expect(asked).toEqual(["Bow to 10-Year-Old Archmage Aldric", "bow to 10 year old archmage aldric"]);
  });

  it("gives up at its deadline when a site hangs", async () => {
    const { s } = site({ find: () => new Promise(() => {}) });
    const started = Date.now();
    expect(await alternateSource("shortmax", "Hanging Title", 130, 1, "en-US", [s], async () => 206, 50)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("needs to know the app and the episode count", async () => {
    const { s, calls } = site();
    expect(await alternateSource(null, "T", 130, 1, "en-US", [s], async () => 206)).toBeNull();
    expect(await alternateSource("shortmax", "T", 0, 1, "en-US", [s], async () => 206)).toBeNull();
    expect(calls.find).toBe(0);
  });
});

// ─── ReelAll ────────────────────────────────────────────────────────────────
// Trimmed from reelall.com on 2026-09-26: wp-json/wp/v2/search?search=billionaire
// (entries cut to id/title/url; `—` and `&#8230;`/`&#8217;` as served),
// and the player element + og:title of two series pages.
const REELALL_SEARCH = String.raw`[
{"id":396,"title":"One Night, One Deal, One Billionaire — Watch Full Series All Episodes","url":"https:\/\/reelall.com\/one-night-one-deal-one-billionaire-fr-1306\/"},
{"id":350,"title":"The Hidden Billionaire in First Class — Watch Full Series All Episodes","url":"https:\/\/reelall.com\/the-hidden-billionaire-in-first-class-rs-689b432d58c2b18f9509250d\/"},
{"id":338,"title":"I Divorced the Billionaire — Watch Full Series All Episodes","url":"https:\/\/reelall.com\/i-divorced-the-billionaire-dx-42000024069\/"},
{"id":347,"title":"I Heard It All&#8230; My Cold Billionaire Husband&#8217;s Hidden Heart — Watch Full Series All Episodes","url":"https:\/\/reelall.com\/i-heard-it-all-my-cold-billionaire-husbands-hidden-heart-dx-42000024470\/"},
{"id":299,"title":"Billionaire Dad Returns — Watch Full Series All Episodes","url":"https:\/\/reelall.com\/billionaire-dad-returns-ft-11234\/"}
]`;

const HEARD_IT_ALL = "I Heard It All… My Cold Billionaire Husband's Hidden Heart";
const HEARD_PAGE = `<meta property="og:title" content="I Heard It All&#8230; My Cold Billionaire Husband&#8217;s Hidden Heart Eng Dub — Watch Full Series All Episodes">
<div class="rr-player"						data-post="347"
			data-source="dx"
			data-series="42000024470"
			data-library="42000024470"
			data-episodes="66"
			data-orientation="vertical"
			data-title="I Heard It All... My Cold Billionaire Husband&#039;s Hidden Heart">
<a class="rr-card" data-title="Easy to Fool" data-series="42000099999" data-episodes="80"></a>`;
const DAD_PAGE = `<meta property="og:title" content="Billionaire Dad Returns Eng Sub — Watch Full Series All Episodes">
<div data-source="ft"
	data-series="11234"
	data-episodes="70"
	data-title="Billionaire Dad Returns">`;

describe("reelall pages", () => {
  it("strips every tail form and decodes entities in the title", () => {
    expect(reelAllTitle("Billionaire Dad Returns — Watch Full Series All Episodes")).toBe("Billionaire Dad Returns");
    expect(reelAllTitle("Billionaire Dad Returns Eng Sub — Watch Full Series All Episodes")).toBe("Billionaire Dad Returns");
    expect(
      reelAllTitle(
        "I Heard It All&#8230; My Cold Billionaire Husband&#8217;s Hidden Heart Eng Dub — Watch Full Series All Episodes",
      ),
    ).toBe(HEARD_IT_ALL);
  });

  it("normalises a numeric entity away instead of keeping its digits", () => {
    expect(normaliseTitle("All&#8230; My")).toBe("allmy");
    expect(normaliseTitle("Tom &amp; Jerry&#x2019;s")).toBe("tomjerrys");
  });

  it("keeps only the site's codes, ids from the URL, likely titles first", () => {
    const wanted = normaliseTitle(HEARD_IT_ALL);
    const keys = (codes: string[]) => readReelAllSearch(REELALL_SEARCH, codes, wanted).map((h) => `${h.code}/${h.id}`);
    expect(keys(["db", "dx"])).toEqual(["dx/42000024470", "dx/42000024069"]);
    expect(keys(["ft"])).toEqual(["ft/11234"]);
    expect(readReelAllSearch("<html>not json", ["ft"], wanted)).toEqual([]);
  });

  it("reads the count off this series' player, not a neighbouring card", () => {
    expect(readReelAllSeries(HEARD_PAGE, "42000024470")).toEqual({ title: HEARD_IT_ALL, episodes: 66 });
    expect(readReelAllSeries(HEARD_PAGE, "123")).toBeNull();
  });
});

describe("reelAll site", () => {
  const fixtures: Record<string, string> = {
    "https://reelall.com/i-heard-it-all-my-cold-billionaire-husbands-hidden-heart-dx-42000024470/": HEARD_PAGE,
    "https://reelall.com/billionaire-dad-returns-ft-11234/": DAD_PAGE,
  };
  const make = (codes: string[], apps = ["dramabox"]) => {
    const fetched: string[] = [];
    const site = reelAll("reelall-test", apps, codes, async (url) => {
      fetched.push(url);
      if (url.includes("/wp-json/")) return REELALL_SEARCH;
      return fixtures[url] ?? null;
    });
    return { site, fetched };
  };

  it("finds a series whose title AND episode count match", async () => {
    const { site } = make(["db", "dx"]);
    expect(await site.find(HEARD_IT_ALL, 66)).toBe("dx/42000024470");
    expect(await site.episodeUrl("dx/42000024470", 7)).toBe("https://reelall.com/api/dx/42000024470/7.mp4");
  });

  it("gives each episode its own duplicate-check key despite the shared series id", () => {
    const key = (ep: number) => fileKey(`https://reelall.com/api/dx/42000024470/${ep}.mp4`);
    expect(key(7)).not.toBe(key(8));
  });

  it("rejects a same-titled series cut into a different number of episodes", async () => {
    const { site } = make(["db", "dx"]);
    expect(await site.find(HEARD_IT_ALL, 65)).toBeNull();
  });

  it("never looks at another app's codes", async () => {
    const { site, fetched } = make(["ft"], ["flextv"]);
    expect(await site.find(HEARD_IT_ALL, 66)).toBeNull();
    expect(fetched.some((u) => u.includes("-dx-"))).toBe(false);
    expect(await site.find("Billionaire Dad Returns", 70)).toBe("ft/11234");
  });

  it("fetches at most three series pages per search", async () => {
    const many = JSON.stringify(
      Array.from({ length: 8 }, (_, i) => ({ id: i, title: "X", url: `https://reelall.com/x-db-${i}/` })),
    );
    const fetched: string[] = [];
    const site = reelAll("reelall-many", ["dramabox"], ["db"], async (url) => {
      fetched.push(url);
      return url.includes("/wp-json/") ? many : null;
    });
    expect(await site.find("Y", 10)).toBeNull();
    expect(fetched.filter((u) => !u.includes("/wp-json/"))).toHaveLength(3);
  });

  it("registers DramaBox and FlexTV with lowercase apps, English only", () => {
    expect([...reelAllDramaBox.apps]).toEqual(["dramabox"]);
    expect([...reelAllFlexTv.apps]).toEqual(["flextv"]);
    expect([...(reelAllDramaBox.langs ?? [])]).toEqual(["en-US"]);
    expect([...(reelAllFlexTv.langs ?? [])]).toEqual(["en-US"]);
  });
});

describe("alternateSource — app case and locale", () => {
  const fake = (langs?: string[]) => {
    const calls = { find: 0 };
    const s: AlternateSite = {
      name: `fake-${Math.random()}`,
      apps: new Set(["dramabox"]),
      langs: langs ? new Set(langs) : undefined,
      find: async () => (calls.find++, "dx/1"),
      episodeUrl: async (k, ep) => `https://reelall.com/api/${k}/${ep}.mp4`,
    };
    return { s, calls };
  };

  it("matches the app whatever its case", async () => {
    const { s } = fake();
    expect(await alternateSource("DramaBox", "Some Title", 66, 3, "en-US", [s], async () => 206)).toEqual({
      site: s.name,
      url: "https://reelall.com/api/dx/1/3.mp4",
    });
  });

  it("asks an English-only site for English requests alone — not even its cache", async () => {
    const { s, calls } = fake(["en-US"]);
    expect(await alternateSource("dramabox", "Same Title", 66, 3, "en-US", [s], async () => 206)).not.toBeNull();
    expect(calls.find).toBe(1);
    // Same title and count, so the cached key would match — the gate comes first.
    expect(await alternateSource("dramabox", "Same Title", 66, 3, "tl-PH", [s], async () => 206)).toBeNull();
    expect(await alternateSource("dramabox", "Same Title", 66, 3, "fr-FR", [s], async () => 206)).toBeNull();
  });

  it("keeps VibeShort to English too", () => {
    expect([...(vibeShort.langs ?? [])]).toEqual(["en-US"]);
  });
});
