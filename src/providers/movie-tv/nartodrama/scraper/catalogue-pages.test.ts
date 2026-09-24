import { describe, expect, it } from "vitest";
import { collectTabPages } from "./catalogue-pages.js";

// narto shows a provider tab 24 titles at a time. Only page 1 was ever read,
// so AnyReel looked like 48 titles when it has ~190 (2026-09-24).
const item = (id: string) => ({ bookId: id });

describe("collectTabPages", () => {
  it("keeps asking until a page adds nothing new", async () => {
    const pages: Record<number, string[]> = { 2: ["c", "d"], 3: ["e"], 4: [] };
    const asked: number[] = [];
    const out = await collectTabPages([item("a"), item("b")], async (p) => {
      asked.push(p);
      return (pages[p] ?? []).map(item);
    }, { maxPages: 10 });
    expect(out.map((i) => i.bookId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(asked).toEqual([2, 3, 4]);
  });

  it("stops when a page only repeats what it already has", async () => {
    const asked: number[] = [];
    const out = await collectTabPages([item("a")], async (p) => {
      asked.push(p);
      return [item("a")];
    }, { maxPages: 10 });
    expect(out).toHaveLength(1);
    expect(asked).toEqual([2]);
  });

  it("never walks past maxPages", async () => {
    let n = 0;
    const out = await collectTabPages([item("p1")], async (p) => [item(`p${p}`), item(`x${n++}`)], { maxPages: 3 });
    expect(out.map((i) => i.bookId)).toEqual(["p1", "p2", "x0", "p3", "x1"]);
  });

  it("keeps what it has when a later page fails", async () => {
    const out = await collectTabPages([item("a")], async () => {
      throw new Error("429");
    }, { maxPages: 5 });
    expect(out.map((i) => i.bookId)).toEqual(["a"]);
  });
});
