import { describe, expect, it } from "vitest";
import { ImageCache } from "./imageCache.js";

const bytes = (n: number) => new Uint8Array(n);

describe("image cache", () => {
  it("keeps images and nothing else", () => {
    const cache = new ImageCache(1000, 400);
    cache.set("a", bytes(100), "image/jpeg");
    cache.set("b", bytes(100), "text/vtt");
    cache.set("c", bytes(500), "image/png"); // over the per-item limit
    expect(cache.get("a")?.type).toBe("image/jpeg");
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")).toBeNull();
  });

  it("drops the least recently used when full", () => {
    const cache = new ImageCache(300, 200);
    cache.set("a", bytes(100), "image/jpeg");
    cache.set("b", bytes(100), "image/jpeg");
    cache.set("c", bytes(100), "image/jpeg");
    cache.get("a"); // a is now the most recently used
    cache.set("d", bytes(100), "image/jpeg");
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")).not.toBeNull();
    expect(cache.size).toBe(3);
  });

  it("forgets an image after its time", () => {
    const cache = new ImageCache(1000, 400, 1000);
    cache.set("a", bytes(100), "image/jpeg", 0);
    expect(cache.get("a", 500)).not.toBeNull();
    expect(cache.get("a", 1501)).toBeNull();
    expect(cache.size).toBe(0);
  });
});
