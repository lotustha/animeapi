import { describe, expect, it } from "vitest";
import {
  classifyEdgeResponse,
  isFakePlaylist,
  isServable,
  isUsableSource,
  LANG,
  LOCALISED,
  listedSource,
  prefersListing,
  missVerdict,
  resolveSourceResult,
  signedUrlExpiry,
} from "./refresh-source.js";
import type { EdgeAnswer, WatchPageContext } from "./refresh-source.js";
import type { RefreshSource } from "../types.js";

// The cached answer from narto can be `ok: true` with a link whose signature
// lapsed weeks ago. These pin the check that sends such an answer to the repair
// rung instead of to a viewer — and that it never condemns a link it cannot read.
const NOW = 1_790_000_000;

const source = (url: string, extra: Partial<RefreshSource> = {}) =>
  ({ ok: true, direct_play_url: url, ...extra }) as RefreshSource;

describe("signedUrlExpiry", () => {
  it("reads CloudFront, Aliyun and token spellings", () => {
    expect(signedUrlExpiry("https://c/x.m3u8?Expires=1786281610&Signature=abc")).toBe(1786281610);
    expect(signedUrlExpiry("https://c/x.m3u8?auth_key=1789621076-0-0-7179e8")).toBe(1789621076);
    expect(signedUrlExpiry("https://c/f0.mp4?__token__=exp=1784569675~acl=/a/f0.mp4")).toBe(
      1784569675,
    );
  });

  it("is null when the URL does not say", () => {
    expect(signedUrlExpiry("https://stream-e1.narto-drama.com/e/m/eyJ2IjoxfQ")).toBeNull();
    expect(signedUrlExpiry("")).toBeNull();
    expect(signedUrlExpiry(undefined)).toBeNull();
  });

  it("ignores a number that is not a unix time in seconds", () => {
    expect(signedUrlExpiry("https://c/x.mp4?exp=1784569675123")).toBeNull();
    expect(signedUrlExpiry("https://c/x.mp4?exp=30")).toBeNull();
  });
});

describe("isUsableSource", () => {
  it("rejects a link that has already expired", () => {
    expect(isUsableSource(source(`https://c/x.mp4?Expires=${NOW - 86_400}`), NOW)).toBe(false);
  });

  it("rejects one about to expire while the player opens it", () => {
    expect(isUsableSource(source(`https://c/x.mp4?Expires=${NOW + 10}`), NOW)).toBe(false);
  });

  it("accepts a live link", () => {
    expect(isUsableSource(source(`https://c/x.mp4?Expires=${NOW + 3600}`), NOW)).toBe(true);
  });

  it("accepts a link it cannot date — not knowing is not a reason to force", () => {
    expect(isUsableSource(source("https://stream-e1.narto-drama.com/e/m/abc"), NOW)).toBe(true);
  });

  it("checks the wrapped play_url too", () => {
    const s = source("https://c/live.mp4", { play_url: `https://c/x.mp4?Expires=${NOW - 5}` });
    expect(isUsableSource(s, NOW)).toBe(false);
  });

  it("rejects an answer with no URL, or not ok, as before", () => {
    expect(isUsableSource({ ok: true } as RefreshSource, NOW)).toBe(false);
    expect(
      isUsableSource({ ok: false, direct_play_url: "https://c/x.mp4" } as RefreshSource, NOW),
    ).toBe(false);
    expect(isUsableSource(null, NOW)).toBe(false);
  });
});

// "No source" used to mean "anything went wrong". A burst of ~50 resolves made
// 17 of 25 providers answer it, and the same episode resolved 2s later; the app
// believed the 404 and showed "unavailable" until someone tapped Try again.
// These pin which answers are upstream saying NO and which are us not knowing.
const LIVE = `https://c/x.mp4?Expires=${Math.floor(Date.now() / 1000) + 86_400}`;
const DEAD = `https://c/x.mp4?Expires=${Math.floor(Date.now() / 1000) - 86_400}`;

describe("classifyEdgeResponse", () => {
  it("calls a rate limit busy, and keeps upstream's Retry-After within reason", () => {
    expect(classifyEdgeResponse(429, undefined, "30")).toEqual({
      kind: "busy",
      reason: "rate-limited",
      retryAfterSec: 30,
    });
    expect(classifyEdgeResponse(429, undefined, "1")).toMatchObject({ retryAfterSec: 5 });
    expect(classifyEdgeResponse(429, undefined, "86400")).toMatchObject({ retryAfterSec: 120 });
    expect(classifyEdgeResponse(429, undefined, null)).toMatchObject({ retryAfterSec: 20 });
    expect(classifyEdgeResponse(429, undefined, "soon")).toMatchObject({ retryAfterSec: 20 });
  });

  it("calls a server error, a refused token and an unreadable body busy", () => {
    expect(classifyEdgeResponse(502, undefined)).toMatchObject({
      kind: "busy",
      reason: "upstream-5xx",
    });
    expect(classifyEdgeResponse(403, undefined)).toMatchObject({
      kind: "busy",
      reason: "token-refused",
    });
    // A challenge page on a 200: could not find out, not nothing there.
    expect(classifyEdgeResponse(200, undefined)).toMatchObject({
      kind: "busy",
      reason: "bad-body",
    });
    expect(classifyEdgeResponse(200, { ok: "yes" })).toMatchObject({
      kind: "busy",
      reason: "bad-body",
    });
  });

  it("believes upstream when it says retryable", () => {
    expect(classifyEdgeResponse(200, { ok: false, retryable: true })).toMatchObject({
      kind: "busy",
    });
  });

  it("calls it gone only when upstream answered and had nothing", () => {
    expect(classifyEdgeResponse(404, undefined)).toEqual({
      kind: "gone",
      reason: "upstream-refused",
    });
    expect(classifyEdgeResponse(200, { ok: false })).toEqual({
      kind: "gone",
      reason: "upstream-refused",
    });
    expect(classifyEdgeResponse(200, { ok: true })).toEqual({ kind: "gone", reason: "no-url" });
  });

  it("passes a link through", () => {
    expect(classifyEdgeResponse(200, { ok: true, play_url: LIVE })).toMatchObject({ kind: "ok" });
  });
});

describe("missVerdict", () => {
  const gone: EdgeAnswer = { kind: "gone", reason: "upstream-refused" };
  const busy: EdgeAnswer = { kind: "busy", reason: "fetch-failed", retryAfterSec: 10 };

  it("lets the last rung asked decide", () => {
    expect(missVerdict([gone, busy]).kind).toBe("busy");
    expect(missVerdict([busy, gone]).kind).toBe("gone");
  });

  it("is busy when nothing was learned at all", () => {
    expect(missVerdict([]).kind).toBe("busy");
  });
});

describe("resolveSourceResult", () => {
  const ctx = {
    refreshBase: "https://n/detail/watch/s",
    contextToken: null,
    edgeBase: "https://e",
    app: null,
    episodes: [],
  } as WatchPageContext;
  const ok = (url: string): EdgeAnswer => ({
    kind: "ok",
    source: { ok: true, direct_play_url: url },
  });
  const limited: EdgeAnswer = { kind: "busy", reason: "rate-limited", retryAfterSec: 20 };

  // Records which rungs were asked: false is the cheap call, true the forced one.
  const ladder = (answers: EdgeAnswer[]) => {
    const asked: boolean[] = [];
    const call = async (_c: WatchPageContext, _s: string, _e: number, force: boolean) => {
      asked.push(force);
      return answers[asked.length - 1];
    };
    return { asked, call };
  };

  it("never answers a rate limit with a forced call", async () => {
    const { asked, call } = ladder([limited]);
    const answer = await resolveSourceResult(ctx, "burst", 1, {}, call);
    expect(answer).toEqual(limited);
    expect(asked).toEqual([false]);
  });

  it("still forces a refresh when the cached link is dead", async () => {
    const { asked, call } = ladder([ok(DEAD), ok(LIVE)]);
    const answer = await resolveSourceResult(ctx, "dead-cache", 1, {}, call, async () => 403);
    expect(answer).toEqual(ok(LIVE));
    expect(asked).toEqual([false, true]);
  });

  it("is busy, not gone, when the forced rung could not be reached", async () => {
    const { call } = ladder([
      { kind: "gone", reason: "upstream-refused" },
      { kind: "busy", reason: "fetch-failed", retryAfterSec: 10 },
    ]);
    expect((await resolveSourceResult(ctx, "unreachable", 1, {}, call)).kind).toBe("busy");
  });

  it("is gone when both rungs say so", async () => {
    const gone: EdgeAnswer = { kind: "gone", reason: "upstream-refused" };
    const { call } = ladder([gone, gone]);
    expect((await resolveSourceResult(ctx, "really-gone", 1, {}, call)).kind).toBe("gone");
  });
});

// A link whose signature reads as lapsed is not always dead. FlexTV stamps
// every link with its import time (`auth_key=1784842668-…`, July) and the CDN
// still serves it two months on; measured 2026-09-24 on "Die vorübergehende
// Braut des CEOs": each cold resolve was called dead, forced against narto,
// and got the very same link back. These pin the rule that the CDN, not the
// date alone, has the last word on a lapsed link.
describe("isServable", () => {
  const probe = (status: number | Error) => {
    const asked: string[] = [];
    const fn = async (url: string) => {
      asked.push(url);
      if (status instanceof Error) throw status;
      return status;
    };
    return { asked, fn };
  };

  it("does not probe a link that is still in date", async () => {
    const { asked, fn } = probe(403);
    expect(await isServable(source(LIVE), "s", 1, fn)).toBe(true);
    expect(asked).toEqual([]);
  });

  it("asks the CDN about a lapsed link and believes a 206", async () => {
    const { asked, fn } = probe(206);
    expect(await isServable(source(DEAD), "s", 1, fn)).toBe(true);
    expect(asked).toEqual([DEAD]);
  });

  it("calls a lapsed link dead when the CDN refuses it", async () => {
    expect(await isServable(source(DEAD), "s", 1, probe(403).fn)).toBe(false);
    expect(await isServable(source(DEAD), "s", 1, probe(410).fn)).toBe(false);
  });

  it("calls a lapsed link dead when the CDN cannot be asked", async () => {
    expect(await isServable(source(DEAD), "s", 1, probe(new Error("timeout")).fn)).toBe(false);
    expect(await isServable(source(DEAD), "s", 1, probe(503).fn)).toBe(false);
  });

  it("rejects an answer with nothing to play without asking", async () => {
    const { asked, fn } = probe(200);
    expect(await isServable(null, "s", 1, fn)).toBe(false);
    expect(await isServable({ ok: true } as RefreshSource, "s", 1, fn)).toBe(false);
    expect(asked).toEqual([]);
  });
});

describe("resolveSourceResult with a lapsed link the CDN still serves", () => {
  const ctx = {
    refreshBase: "https://n/detail/watch/s",
    contextToken: null,
    edgeBase: "https://e",
    app: null,
    episodes: [],
  } as WatchPageContext;
  const ok = (url: string): EdgeAnswer => ({ kind: "ok", source: { ok: true, direct_play_url: url } });

  it("hands the cached link out and spends no forced call", async () => {
    const asked: boolean[] = [];
    const call = async (_c: WatchPageContext, _s: string, _e: number, force: boolean) => {
      asked.push(force);
      return ok(DEAD);
    };
    const answer = await resolveSourceResult(ctx, "flextv-title", 1, {}, call, async () => 206);
    expect(answer).toEqual(ok(DEAD));
    expect(asked).toEqual([false]);
  });

  it("still forces when the CDN refuses the lapsed link", async () => {
    const asked: boolean[] = [];
    const call = async (_c: WatchPageContext, _s: string, _e: number, force: boolean) => {
      asked.push(force);
      return force ? ok(LIVE) : ok(DEAD);
    };
    const answer = await resolveSourceResult(ctx, "netshort-title", 1, {}, call, async () => 403);
    expect(answer).toEqual(ok(LIVE));
    expect(asked).toEqual([false, true]);
  });
});

// Seen 2026-09-25 on every AnyReel title: narto answers 429 for an episode
// whose provider fetch failed on its side, to every caller alike. The wait is
// in the body. It is not a rate limit on this server, but it still must not be
// answered with a forced call, which narto refuses the same way.
describe("an episode cooling down on narto's side", () => {
  it("is told apart from a rate limit, and takes the wait from the body", () => {
    expect(
      classifyEdgeResponse(429, { ok: false, message: "refresh_source_recently_failed", retry_after_seconds: 45 }),
    ).toEqual({ kind: "busy", reason: "upstream-cooldown", retryAfterSec: 45 });
    expect(
      classifyEdgeResponse(429, { ok: false, message: "refresh_source_cooldown_active", retry_after_seconds: 20 }),
    ).toEqual({ kind: "busy", reason: "upstream-cooldown", retryAfterSec: 20 });
    expect(classifyEdgeResponse(429, { ok: false, message: "refresh_source_cooldown_active" }, "30")).toMatchObject({
      reason: "upstream-cooldown",
      retryAfterSec: 30,
    });
    expect(classifyEdgeResponse(429, { ok: false, message: "slow down" })).toMatchObject({ reason: "rate-limited" });
  });

  it("ends the ladder without a forced call", async () => {
    const ctx = { refreshBase: "https://n/detail/watch/s", contextToken: null, edgeBase: "https://e", app: null, episodes: [] };
    const cooling: EdgeAnswer = { kind: "busy", reason: "upstream-cooldown", retryAfterSec: 45 };
    const asked: boolean[] = [];
    const call = async (_c: WatchPageContext, _s: string, _e: number, force: boolean) => {
      asked.push(force);
      return cooling;
    };
    expect(await resolveSourceResult(ctx, "anyreel-title", 1, {}, call)).toEqual(cooling);
    expect(asked).toEqual([false]);
  });
});

describe("listedSource", () => {
  const M3U8 = "https://videoint.anyreel.app/x/y/adp.1936796.m3u8";
  const episodes = [
    { id: 1, number: 1, play_url: M3U8, is_playable: true },
    { id: 7, number: 7, play_url: "", is_playable: false },
    { id: 8, number: 8, play_url: M3U8.replace("y", "z"), is_playable: false },
  ];

  it("serves the listed link when the CDN serves it", async () => {
    expect(await listedSource(episodes, 1, async () => 206)).toEqual({ ok: true, play_url: M3U8 });
  });

  it("never serves a link the CDN refuses or cannot be asked about", async () => {
    expect(await listedSource(episodes, 1, async () => 403)).toBeNull();
    expect(
      await listedSource(episodes, 1, async () => {
        throw new Error("timeout");
      }),
    ).toBeNull();
  });

  it("has nothing for an empty, unplayable or missing episode, and asks no CDN", async () => {
    let probed = 0;
    const probe = async () => (probed++, 200);
    expect(await listedSource(episodes, 7, probe)).toBeNull();
    expect(await listedSource(episodes, 8, probe)).toBeNull();
    expect(await listedSource(episodes, 99, probe)).toBeNull();
    expect(await listedSource(undefined, 1, probe)).toBeNull();
    expect(probed).toBe(0);
  });
});

describe("prefersListing", () => {
  it("takes the listed link first only for providers that list complete, unsigned links", () => {
    expect(prefersListing("anyreel")).toBe(true);
    expect(prefersListing(" AnyReel ")).toBe(true);
    expect(prefersListing("reelshort")).toBe(false);
    expect(prefersListing(null)).toBe(false);
  });
});

// Measured 2026-09-25: all 22 locales upstream advertises carry their own
// catalogue (it used to be nine). readLang honours exactly this set, so pin it:
// every one accepted, and anything else - junk or a wrong-cased real locale -
// still falls back instead of keying the cache under a bogus name.
describe("LOCALISED", () => {
  it("honours all 22 upstream locales", () => {
    expect(LOCALISED.size).toBe(22);
    for (const lang of ["en-US", "hi-IN", "ko-KR", "bn-BD", "ta-IN", "tl-PH", "zh-TW", "pl-PL"]) {
      expect(LOCALISED.has(lang)).toBe(true);
    }
    expect(LOCALISED.has(LANG)).toBe(true);
  });

  it("rejects junk and wrong-cased locales", () => {
    for (const lang of ["xx-XX", "en-us", "EN-US", "hi", "", "all"]) {
      expect(LOCALISED.has(lang)).toBe(false);
    }
  });
});

// Seen 2026-09-25 on "Bow to 10-Year-Old Archmage Aldric" (ShortMax) eps 75–76:
// narto's relay answered 206 with a one-line "playlist" wrapping the origin's
// `410 link expired`, forced refreshes returned the same wrapper, and the
// status-only probe let it through to every viewer.
describe("a link narto can no longer re-sign", () => {
  const ctx = { refreshBase: "https://n/detail/watch/s", contextToken: null, edgeBase: "https://e", app: null, episodes: [] };
  // Opaque token, no readable date: judged by the probe alone.
  const WRAPPED: EdgeAnswer = { kind: "ok", source: { ok: true, direct_play_url: "https://relay/e/m/opaque" } };
  const WORKING: EdgeAnswer = { kind: "ok", source: { ok: true, direct_play_url: "https://relay/e/m/working" } };
  const recorder = (answer: EdgeAnswer) => {
    const asked: boolean[] = [];
    const call = async (_c: WatchPageContext, _s: string, _e: number, force: boolean) => {
      asked.push(force);
      return answer;
    };
    return { asked, call };
  };

  it("tells a fake playlist from a real one", () => {
    expect(isFakePlaylist("/e/s/ey")).toBe(true);
    expect(isFakePlaylist("shortmax-edge: link expired")).toBe(true);
    expect(isFakePlaylist("#EXTM3U")).toBe(false);
    expect(isFakePlaylist("﻿#EXTM3U\n#EXT")).toBe(false);
  });

  it("is gone, not a dead link, when the forced refresh is also refused with 410", async () => {
    const { asked, call } = recorder(WRAPPED);
    expect(await resolveSourceResult(ctx, "archmage", 76, {}, call, async () => 410)).toEqual({
      kind: "gone",
      reason: "expired",
    });
    expect(asked).toEqual([false, true]);
  });

  it("stays gone inside the cooldown without forcing again", async () => {
    const { asked, call } = recorder(WRAPPED);
    await resolveSourceResult(ctx, "archmage-2", 76, {}, call, async () => 410);
    expect(await resolveSourceResult(ctx, "archmage-2", 76, {}, call, async () => 410)).toMatchObject({ kind: "gone" });
    expect(asked.filter(Boolean)).toHaveLength(1);
  });

  it("is gone when a player's fresh demand gets the dead link back", async () => {
    const { asked, call } = recorder(WRAPPED);
    expect(await resolveSourceResult(ctx, "archmage-3", 76, { fresh: true }, call, async () => 410)).toMatchObject({
      kind: "gone",
      reason: "expired",
    });
    expect(asked).toEqual([true]);
  });

  it("is gone when a fresh demand gets no link and the cached one is refused with 410", async () => {
    const asked: boolean[] = [];
    const call = async (_c: WatchPageContext, _s: string, _e: number, force: boolean): Promise<EdgeAnswer> => {
      asked.push(force);
      return force ? { kind: "busy", reason: "fetch-failed", retryAfterSec: 10 } : WRAPPED;
    };
    expect(await resolveSourceResult(ctx, "archmage-4", 76, { fresh: true }, call, async () => 410)).toMatchObject({
      kind: "gone",
      reason: "expired",
    });
    expect(asked).toEqual([true, false]);
  });

  it("still hands out a forced link refused only with 403 — that may be this server, not the viewer", async () => {
    const { call } = recorder(WRAPPED);
    expect(await resolveSourceResult(ctx, "geo", 1, {}, call, async () => 403)).toEqual(WRAPPED);
  });

  it("serves an episode whose link plays", async () => {
    const { asked, call } = recorder(WORKING);
    expect(await resolveSourceResult(ctx, "archmage-ep40", 40, {}, call, async () => 206)).toEqual(WORKING);
    expect(asked).toEqual([false]);
  });
});
