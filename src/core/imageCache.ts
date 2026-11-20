// A small in-memory cache of images served through /proxy/fetch.
//
// Posters of some drama apps only reach viewers through this proxy (their CDN
// refuses some countries). Every request used to download the picture from
// its origin again: 1.3-2.3 seconds for a 116 KB cover, measured 2026-11-20,
// on every card of every viewer. A cover is the same bytes for everyone, so
// the first viewer pays for it and the rest are answered from memory.
//
// Bounded twice: by one picture's size and by the total. Oldest-used goes
// first (a Map keeps insertion order; a hit re-inserts).

export type CachedImage = { body: Uint8Array; type: string; at: number };

export class ImageCache {
  private readonly items = new Map<string, CachedImage>();
  private bytes = 0;

  constructor(
    private readonly maxBytes = 128 * 1024 * 1024,
    private readonly maxItemBytes = 1024 * 1024,
    private readonly ttlMs = 24 * 60 * 60 * 1000,
  ) {}

  /** Whether a response of [type] and [length] bytes is worth keeping. */
  accepts(type: string | null, length: number): boolean {
    return /^image\//i.test(type ?? "") && length > 0 && length <= this.maxItemBytes;
  }

  get(key: string, now = Date.now()): CachedImage | null {
    const hit = this.items.get(key);
    if (!hit) return null;
    if (now - hit.at > this.ttlMs) {
      this.drop(key);
      return null;
    }
    // Most recently used goes to the back of the queue.
    this.items.delete(key);
    this.items.set(key, hit);
    return hit;
  }

  set(key: string, body: Uint8Array, type: string, now = Date.now()): void {
    if (!this.accepts(type, body.byteLength)) return;
    this.drop(key);
    this.items.set(key, { body, type, at: now });
    this.bytes += body.byteLength;
    for (const oldest of this.items.keys()) {
      if (this.bytes <= this.maxBytes) break;
      this.drop(oldest);
    }
  }

  get size(): number {
    return this.items.size;
  }

  private drop(key: string): void {
    const had = this.items.get(key);
    if (!had) return;
    this.bytes -= had.body.byteLength;
    this.items.delete(key);
  }
}
