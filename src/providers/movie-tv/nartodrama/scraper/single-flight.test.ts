import { describe, expect, it } from "vitest";
import { singleFlight } from "./single-flight.js";

// Two viewers opening the same cold episode used to cost two resolves against
// narto — and on 2026-09-24 the second of them drew narto's 429 while the
// first came back fine five seconds later. One in flight per key; the rest wait
// for it.
describe("singleFlight", () => {
  it("runs one call per key and shares its answer with concurrent askers", async () => {
    let runs = 0;
    let release!: (v: string) => void;
    const slow = () =>
      new Promise<string>((resolve) => {
        runs++;
        release = resolve;
      });
    const a = singleFlight("k", slow);
    const b = singleFlight("k", slow);
    release("link");
    expect(await a).toBe("link");
    expect(await b).toBe("link");
    expect(runs).toBe(1);
  });

  it("keeps keys apart", async () => {
    let runs = 0;
    const fn = async () => ++runs;
    await Promise.all([singleFlight("x", fn), singleFlight("y", fn)]);
    expect(runs).toBe(2);
  });

  it("forgets a finished call, so the next ask runs again", async () => {
    let runs = 0;
    const fn = async () => ++runs;
    await singleFlight("k", fn);
    await singleFlight("k", fn);
    expect(runs).toBe(2);
  });

  it("shares a failure too, and forgets it", async () => {
    let runs = 0;
    const fail = async () => {
      runs++;
      throw new Error("no");
    };
    const a = singleFlight("k", fail);
    const b = singleFlight("k", fail);
    await expect(a).rejects.toThrow("no");
    await expect(b).rejects.toThrow("no");
    expect(runs).toBe(1);
    await expect(singleFlight("k", fail)).rejects.toThrow("no");
    expect(runs).toBe(2);
  });
});
