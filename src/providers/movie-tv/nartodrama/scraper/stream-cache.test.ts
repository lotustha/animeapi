import { describe, expect, it } from "vitest";
import type { DramaStream } from "../types.js";
import {
  BORROWED_TTL_SEC,
  EXPIRY_MARGIN_SEC,
  MAX_TTL_SEC,
  UNKNOWN_TTL_SEC,
  streamCacheTtl,
  subtitleTokenExpiry,
} from "./stream-cache.js";

const NOW = 1_790_600_000;

function stream(url: string, extra: Partial<DramaStream> = {}): DramaStream {
  return {
    id: "x",
    episode: 1,
    provider: "test",
    sources: [{ url, directUrl: url } as DramaStream["sources"][number]],
    subtitles: [],
    ...extra,
  };
}

const signed = (at: number) => `https://cdn.example/v.mp4?auth_key=${at}-abc-0-def`;

function subtitleToken(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, t: "prov", exp })).toString("base64url");
  const inner = `https://narto-drama.com/e/s/${payload}.sig`;
  return `https://api.mugenstream.fun/proxy/fetch?url=${encodeURIComponent(inner)}`;
}

describe("streamCacheTtl", () => {
  it("keeps a link until ten minutes before its deadline", () => {
    expect(streamCacheTtl(stream(signed(NOW + 3600)), NOW)).toBe(3600 - EXPIRY_MARGIN_SEC);
  });

  it("never past the cap, however far away the deadline", () => {
    expect(streamCacheTtl(stream(signed(NOW + 86_400)), NOW)).toBe(MAX_TTL_SEC);
  });

  it("does not cache a link inside its last ten minutes", () => {
    expect(streamCacheTtl(stream(signed(NOW + 300)), NOW)).toBe(0);
  });

  it("an unreadable deadline gets the short default", () => {
    expect(streamCacheTtl(stream("https://cdn.example/opaque/token.m3u8"), NOW)).toBe(UNKNOWN_TTL_SEC);
  });

  it("a stamp in the past is read as some other date, not as dead", () => {
    // flextv: auth_key is the import time — months old, and the link plays.
    expect(streamCacheTtl(stream(signed(NOW - 90 * 86_400)), NOW)).toBe(UNKNOWN_TTL_SEC);
  });

  it("a borrowed link is kept briefly whatever it says", () => {
    expect(streamCacheTtl(stream(signed(NOW + 3600), { servedBy: "listing" }), NOW)).toBe(BORROWED_TTL_SEC);
  });

  it("the subtitles' deadline counts too, when it comes first", () => {
    const s = stream(signed(NOW + 7200), {
      subtitles: [{ label: "Default", url: subtitleToken(NOW + 1800) } as DramaStream["subtitles"][number]],
    });
    expect(streamCacheTtl(s, NOW)).toBe(1800 - EXPIRY_MARGIN_SEC);
  });
});

describe("subtitleTokenExpiry", () => {
  it("reads exp from a proxied narto subtitle link", () => {
    expect(subtitleTokenExpiry(subtitleToken(NOW + 60))).toBe(NOW + 60);
  });

  it("null for anything else", () => {
    expect(subtitleTokenExpiry("https://cdn.example/sub.vtt")).toBeNull();
    expect(subtitleTokenExpiry("https://narto-drama.com/e/s/!!!.sig")).toBeNull();
  });
});
