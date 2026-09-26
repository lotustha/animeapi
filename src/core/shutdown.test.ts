import { afterEach, describe, expect, it, vi } from "vitest";
import { createShutdown, type ShutdownDeps } from "./shutdown.js";

function fakes(over: Partial<ShutdownDeps> = {}) {
  const order: string[] = [];
  const deps: ShutdownDeps = {
    stop: vi.fn(async () => void order.push("stop")),
    closeBrowsers: vi.fn(async () => void order.push("browsers")),
    closeStore: vi.fn(() => void order.push("store")),
    exit: vi.fn((code: number) => void order.push(`exit:${code}`)),
    log: () => {},
    ceilingMs: 125_000,
    ...over,
  };
  return { deps, order };
}

afterEach(() => vi.useRealTimers());

describe("createShutdown (graceful deploy stop, 2026-09-26)", () => {
  it("drains, then closes browsers, then the store, then exits 0", async () => {
    const { deps, order } = fakes();
    await createShutdown(deps)("SIGTERM");
    expect(order).toEqual(["stop", "browsers", "store", "exit:0"]);
  });

  it("runs once when pm2 escalates with a second signal", async () => {
    const { deps } = fakes();
    const shutdown = createShutdown(deps);
    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
    await shutdown("SIGTERM");
    expect(deps.stop).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it("still cleans up and exits 0 when stop() rejects", async () => {
    const { deps, order } = fakes({ stop: vi.fn(async () => Promise.reject(new Error("boom"))) });
    await createShutdown(deps)("SIGTERM");
    expect(order).toEqual(["browsers", "store", "exit:0"]);
  });

  it("does not exit before the drain resolves", async () => {
    let release!: () => void;
    const { deps } = fakes({ stop: vi.fn(() => new Promise<void>((r) => (release = r))) });
    const done = createShutdown(deps)("SIGTERM");
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.exit).not.toHaveBeenCalled();
    expect(deps.closeBrowsers).not.toHaveBeenCalled();
    release();
    await done;
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it("at the ceiling, closes browsers and exits even though the drain never ends", async () => {
    vi.useFakeTimers();
    const { deps, order } = fakes({ stop: vi.fn(() => new Promise<void>(() => {})) });
    void createShutdown(deps)("SIGTERM");
    await vi.advanceTimersByTimeAsync(124_999);
    expect(deps.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual(["browsers", "exit:0"]);
  });
});
