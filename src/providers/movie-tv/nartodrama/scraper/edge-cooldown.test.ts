import { beforeEach, describe, expect, it } from "vitest";
import { edgeCooldownLeft, noteEdgeCooldown, resetEdgeCooldowns } from "./refresh-source.js";

// narto restarts an episode's cooldown every time it is asked, so an episode
// viewers keep retrying never got out of it. Inside the wait we answer for it.
describe("edge cooldown memo", () => {
  beforeEach(() => resetEdgeCooldowns());

  it("an episode never told to wait may be asked", () => {
    expect(edgeCooldownLeft("love-is-near#2", 1_000)).toBe(0);
  });

  it("inside the wait it reports the seconds left, rounded up", () => {
    noteEdgeCooldown("love-is-near#2", 20, 1_000);
    expect(edgeCooldownLeft("love-is-near#2", 1_000)).toBe(20);
    expect(edgeCooldownLeft("love-is-near#2", 11_500)).toBe(10);
  });

  it("once the wait is over it may be asked again", () => {
    noteEdgeCooldown("love-is-near#2", 20, 1_000);
    expect(edgeCooldownLeft("love-is-near#2", 21_000)).toBe(0);
  });

  it("one episode's wait does not hold back its neighbours", () => {
    noteEdgeCooldown("love-is-near#2", 20, 1_000);
    expect(edgeCooldownLeft("love-is-near#1", 1_000)).toBe(0);
    expect(edgeCooldownLeft("love-is-near#3", 1_000)).toBe(0);
  });
});
