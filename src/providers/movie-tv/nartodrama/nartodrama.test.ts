import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshot } from "../../../core/counters.js";
import type { EdgeAnswer, WatchPageContext } from "./scraper/refresh-source.js";

// The fallback rungs of watchResult are wired by three lines each — pass the
// request's locale on, tag the stream, bump a counter — and the scraper tests
// cover what they call, never the call itself. Reverting any of them left all
// 129 tests green (review of the ReelAll change, 2026-09-26): dropping `lang`
// would reopen the tl-PH → English-ReelAll leak the gate exists to stop, and
// dropping an inc() would make /health quietly stop counting saves. These pin
// the wiring with the network pieces stubbed out.
const edge = vi.hoisted(() => ({
  answer: null as unknown as EdgeAnswer,
  listed: null as { ok: true; play_url: string } | null,
}));
vi.mock("./scraper/refresh-source.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./scraper/refresh-source.js")>();
  const ctx: WatchPageContext = {
    refreshBase: "https://n/detail/watch/s",
    contextToken: null,
    edgeBase: "https://e",
    app: "dramabox",
    episodes: [],
    title: "Billionaire Dad Returns",
  };
  return {
    ...real,
    getWatchContextResult: vi.fn(async () => ({ ctx })),
    resolveSourceResult: vi.fn(async () => edge.answer),
    listedSource: vi.fn(async () => edge.listed),
    prefersListing: () => false,
  };
});
const alternate = vi.hoisted(() => vi.fn());
vi.mock("./scraper/alternate-source.js", () => ({ alternateSource: alternate }));

const { NartoDrama } = await import("./nartodrama.js");

const count = (name: string) => snapshot()[name] ?? 0;

beforeEach(() => {
  edge.answer = { kind: "gone", reason: "upstream-refused" };
  edge.listed = null;
  alternate.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("watchResult fallback rungs", () => {
  it("asks the alternate sites in the request's own locale", async () => {
    alternate.mockResolvedValue(null);
    await NartoDrama.watchResult("wiring-lang", 3, "tl-PH");
    expect(alternate).toHaveBeenCalledWith("dramabox", "Billionaire Dad Returns", 0, 3, "tl-PH");
  });

  it("tags an alternate's stream with the site and counts it", async () => {
    alternate.mockResolvedValue({ site: "reelall-dramabox", url: "https://reelall.com/api/db/42000000001/2.mp4" });
    const before = count("alt_served_reelall-dramabox");
    const stream = await NartoDrama.watchResult("wiring-alt", 2, "en-US");
    expect(stream).toMatchObject({ servedBy: "reelall-dramabox" });
    expect(count("alt_served_reelall-dramabox")).toBe(before + 1);
  });

  it("tags the listing rung's stream and counts it, without asking the alternates", async () => {
    edge.listed = { ok: true, play_url: "https://cdn.example/listed/ep4-0123456789abcdef.m3u8" };
    const before = count("listing_served");
    const stream = await NartoDrama.watchResult("wiring-listing", 4, "en-US");
    expect(stream).toMatchObject({ servedBy: "listing" });
    expect(count("listing_served")).toBe(before + 1);
    expect(alternate).not.toHaveBeenCalled();
  });

  it("leaves servedBy unset when narto answered", async () => {
    edge.answer = { kind: "ok", source: { ok: true, play_url: "https://cdn.example/narto/ep5-0123456789abcdef.mp4" } };
    const stream = await NartoDrama.watchResult("wiring-narto", 5, "en-US");
    expect(stream).toMatchObject({ provider: "dramabox" });
    expect((stream as { servedBy?: string }).servedBy).toBeUndefined();
    expect(alternate).not.toHaveBeenCalled();
  });

  it("never asks the alternates on busy", async () => {
    edge.answer = { kind: "busy", reason: "rate-limited", retryAfterSec: 20 };
    expect(await NartoDrama.watchResult("wiring-busy", 6, "en-US")).toMatchObject({ kind: "busy" });
    expect(alternate).not.toHaveBeenCalled();
  });
});
