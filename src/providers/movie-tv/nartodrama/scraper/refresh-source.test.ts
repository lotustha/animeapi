import { describe, expect, it } from "vitest";
import { isUsableSource, signedUrlExpiry } from "./refresh-source.js";
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
    expect(signedUrlExpiry("https://c/f0.mp4?__token__=exp=1784569675~acl=/a/f0.mp4")).toBe(1784569675);
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
    expect(isUsableSource({ ok: false, direct_play_url: "https://c/x.mp4" } as RefreshSource, NOW)).toBe(false);
    expect(isUsableSource(null, NOW)).toBe(false);
  });
});
