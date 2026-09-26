import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// node:fs passes straight through unless a test arms one of these faults,
// so the atomic write and the readdir/stat race are exercised for real
// (review 2026-09-26: the first three tests below also passed on the old
// plain-writeFileSync code).
const faults = vi.hoisted(() => ({
  tearNextWrite: false, // write half the payload, then throw (a crash / ENOSPC mid-write)
  statGone: "" as string, // statSync of this path throws ENOENT (renamed/unlinked since readdir)
}));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    writeFileSync: (path: any, data: any, opts?: any) => {
      if (faults.tearNextWrite) {
        faults.tearNextWrite = false;
        real.writeFileSync(path, String(data).slice(0, Math.floor(String(data).length / 2)), opts);
        throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      }
      return real.writeFileSync(path, data, opts);
    },
    statSync: (path: any, opts?: any) => {
      if (faults.statGone && String(path) === faults.statGone) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${path}'`), { code: "ENOENT" });
      }
      return real.statSync(path, opts);
    },
  };
});

// The file cache resolves its provider and directory when the module loads,
// so the env is set first and the module imported fresh.
let dir: string;
let Cache: typeof import("./cache.js").Cache;
const saved = { ...process.env };

function walk(d: string): string[] {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mugen-cache-"));
  process.env.ENABLE_CACHE = "true";
  process.env.CACHE_PROVIDER = "file";
  process.env.CACHE_DIR = dir;
  vi.resetModules();
  ({ Cache } = await import("./cache.js"));
});

afterAll(() => {
  process.env = saved;
  rmSync(dir, { recursive: true, force: true });
});

describe("file cache — atomic writes (2026-09-26, two processes share cache/ during a deploy)", () => {
  it("round-trips and leaves no temp file behind", async () => {
    expect(await Cache.set("anime:info:one-piece", JSON.stringify({ a: 1 }), -1)).toBe(true);
    expect(JSON.parse((await Cache.get("anime:info:one-piece"))!)).toEqual({ a: 1 });

    const files = walk(dir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });

  it("an overwrite replaces the whole entry", async () => {
    await Cache.set("anime:info:one-piece", "x".repeat(10_000), -1);
    await Cache.set("anime:info:one-piece", "short", -1);
    expect(await Cache.get("anime:info:one-piece")).toBe("short");

    const [file] = walk(dir).filter((f) => f.endsWith(".json"));
    expect(JSON.parse(readFileSync(file, "utf-8")).value).toBe("short");
  });

  it("purges never touch another process's in-flight temp file", async () => {
    const [file] = walk(dir).filter((f) => f.endsWith(".json"));
    const foreignTmp = `${file}.999999.tmp`;
    writeFileSync(foreignTmp, "{half a wri");

    await Cache.set("anime:search:naruto", "v", -1);
    expect(await Cache.purgePrefix("search")).toBe(1);
    expect(existsSync(foreignTmp)).toBe(true);

    expect(await Cache.purgeAll()).toBe(1); // the one-piece .json only
    expect(existsSync(foreignTmp)).toBe(true);
    expect(existsSync(dirname(foreignTmp))).toBe(true);
  });

  it("a write that dies half-way leaves the previous entry intact and no temp file", async () => {
    await Cache.set("anime:info:bleach", JSON.stringify({ ep: 366 }), -1);
    faults.tearNextWrite = true;
    expect(await Cache.set("anime:info:bleach", JSON.stringify({ ep: 367, big: "y".repeat(5_000) }), -1)).toBe(false);
    expect(JSON.parse((await Cache.get("anime:info:bleach"))!)).toEqual({ ep: 366 });
    expect(walk(dir).filter((f) => f.endsWith(".tmp") && !f.includes(".999999."))).toEqual([]);
  });

  it("a purge survives an entry vanishing between readdir and stat", async () => {
    await Cache.purgeAll();
    await Cache.set("anime:info:a", "1", -1);
    await Cache.set("anime:info:b", "2", -1);
    const [gone] = walk(dir).filter((f) => f.endsWith(".json"));
    faults.statGone = gone;
    try {
      expect(await Cache.purgeAll()).toBe(1); // the other entry; the old code threw and returned false
    } finally {
      faults.statGone = "";
    }
  });
});
