import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

// A fake puppeteer-real-browser: records the options connect() was given and
// hands back a browser whose close() fires 'disconnected' like the real one.
const calls = vi.hoisted(() => ({ opts: [] as any[], closed: 0 }));
vi.mock("puppeteer-real-browser", () => ({
  connect: vi.fn(async (opts: any) => {
    calls.opts.push(opts);
    const listeners: Array<() => void> = [];
    const browser = {
      once: (ev: string, fn: () => void) => ev === "disconnected" && listeners.push(fn),
      close: vi.fn(async () => {
        calls.closed++;
        listeners.forEach((fn) => fn());
      }),
    };
    return { browser, page: {} };
  }),
}));

const { launchBrowser, closeAllBrowsers, openBrowserCount } = await import("./browser.js");

describe("launchBrowser (2026-09-26: chrome-launcher's SIGINT listener exited mid-drain)", () => {
  it("turns chrome-launcher's handleSIGINT off, keeping caller options", async () => {
    await launchBrowser({ headless: false, turnstile: true, customConfig: { chromePath: "/x" } });
    const opts = calls.opts.at(-1);
    expect(opts.customConfig.handleSIGINT).toBe(false);
    expect(opts.customConfig.chromePath).toBe("/x");
    expect(opts.turnstile).toBe(true);
  });

  it("closeAllBrowsers closes every launched browser", async () => {
    await launchBrowser({});
    expect(openBrowserCount()).toBe(2);
    await closeAllBrowsers(1_000);
    expect(calls.closed).toBe(2);
    expect(openBrowserCount()).toBe(0);
  });

  it("closeAllBrowsers returns at its ceiling when a close() hangs", async () => {
    const { connect } = await import("puppeteer-real-browser");
    vi.mocked(connect).mockResolvedValueOnce({
      browser: { once: () => {}, close: () => new Promise(() => {}) },
      page: {},
    } as any);
    await launchBrowser({});
    const t = Date.now();
    await closeAllBrowsers(50);
    expect(Date.now() - t).toBeLessThan(1_000);
    expect(openBrowserCount()).toBe(0);
  });

  it("no other file in src/ imports puppeteer-real-browser directly", () => {
    const root = join(__dirname, "..", "..");
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : [],
      );
    const offenders = walk(root)
      .filter((f) => !/[\\/]core[\\/]lib[\\/]browser(\.test)?\.ts$/.test(f))
      .filter((f) => /from\s+["']puppeteer-real-browser["']/.test(readFileSync(f, "utf-8")))
      .map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });
});
