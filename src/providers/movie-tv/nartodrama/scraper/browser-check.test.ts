import { describe, expect, it } from "vitest";
import { browserCheckCookie, isBrowserCheck } from "./browser-check.js";

// narto put its listing pages behind a "Checking your browser" stub on or
// before 2026-09-17: a page that sets `nd_ck` and reloads. The scraper got the
// stub, found no cards, and answered every listing with an empty page. The
// daily discover job read that as "nothing new upstream" for a week.
const STUB =
  '<!doctype html><html><head><meta charset="utf-8"><title>Loading</title></head>' +
  '<body>Checking your browser...<script>try{document.cookie="nd_ck="+Date.now().toString(36);location.reload();}catch(e){}</script></body></html>';

describe("browserCheckCookie", () => {
  it("is an nd_ck cookie with a value", () => {
    expect(browserCheckCookie()).toMatch(/^nd_ck=[a-z0-9]{12,}$/);
  });

  it("is stable within the process, like a browser's", () => {
    expect(browserCheckCookie()).toBe(browserCheckCookie());
  });
});

describe("isBrowserCheck", () => {
  it("recognises the stub", () => {
    expect(isBrowserCheck(STUB)).toBe(true);
  });

  it("does not mistake a real page for it", () => {
    const real = `<html><head><title>Narto Drama</title></head><body>${'<article class="card"></article>'.repeat(3)}</body></html>`;
    expect(isBrowserCheck(real)).toBe(false);
  });

  it("does not flag a large page that happens to mention nd_ck", () => {
    expect(isBrowserCheck("x".repeat(50_000) + "nd_ck")).toBe(false);
  });
});
