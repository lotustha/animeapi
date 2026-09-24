import { describe, expect, it } from "vitest";
import { NartoBudget } from "./narto-budget.js";

// 2026-09-24: with discover and stream-check running, 73% of viewers' stream
// lookups got narto's "busy". Background callers now yield to viewers.
describe("NartoBudget", () => {
  it("never holds a viewer back", () => {
    const b = new NartoBudget({ backgroundPerMinute: 1, quietAfterBusyMs: 60_000 });
    b.noteBusy(0);
    expect(b.admit("viewer", 1)).toEqual({ ok: true });
  });

  it("stops background callers for a while after narto says busy", () => {
    const b = new NartoBudget({ backgroundPerMinute: 100, quietAfterBusyMs: 60_000 });
    b.noteBusy(1_000);
    const held = b.admit("background", 30_000);
    expect(held.ok).toBe(false);
    expect(held.ok === false && held.retryAfterSec).toBe(31);
    expect(b.admit("background", 61_001)).toEqual({ ok: true });
  });

  it("caps background calls per minute, sliding", () => {
    const b = new NartoBudget({ backgroundPerMinute: 2, quietAfterBusyMs: 60_000 });
    expect(b.admit("background", 0).ok).toBe(true);
    expect(b.admit("background", 10_000).ok).toBe(true);
    const third = b.admit("background", 20_000);
    expect(third.ok).toBe(false);
    expect(third.ok === false && third.retryAfterSec).toBe(40);
    expect(b.admit("background", 60_001).ok).toBe(true);
  });

  it("does not count a refused call against the cap", () => {
    const b = new NartoBudget({ backgroundPerMinute: 1, quietAfterBusyMs: 60_000 });
    expect(b.admit("background", 0).ok).toBe(true);
    expect(b.admit("background", 1_000).ok).toBe(false);
    expect(b.admit("background", 60_001).ok).toBe(true);
  });
});

describe("callerLane", () => {
  it("reads the x-mugen-caller header; anything named is background", async () => {
    const { callerLane } = await import("./narto-budget.js");
    expect(callerLane(null)).toBe("viewer");
    expect(callerLane("")).toBe("viewer");
    expect(callerLane("discover")).toBe("background");
    expect(callerLane("stream-check")).toBe("background");
    expect(callerLane("viewer")).toBe("viewer");
  });
});
