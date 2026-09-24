import { describe, expect, it } from "vitest";
import {
  classifyEdgeResponse,
  isServable,
  isUsableSource,
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
    const answer = await resolveSourceResult(ctx, "dead-cache", 1, {}, call);
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
