import { beforeEach, describe, expect, it } from "vitest";
import {
  duplicateOfPrevious,
  fileKey,
  fileKeys,
  forgetEpisodeFiles,
  rememberEpisodeFiles,
} from "./duplicate-episode.js";

// The pair measured on "(Dubbed) The Little Pool God": one object id, two hosts.
const EP9 =
  "https://video.netshort.com/oUBHmMgg4eWtBDP8UVyfzgQCbqbfvfIIQRgFAt?a=0&auth_key=1791172739-a897-0-8a09&eid=2041";
const EP10 =
  "https://txvideo.netshort.com/oUBHmMgg4eWtBDP8UVyfzgQCbqbfvfIIQRgFAt?a=0&auth_key=1791172739-a897-0-8a09&eid=2041";
const EP11 =
  "https://ns-aws-cdn.netshort.com/o09EuWLtAMC1fNRerrkf9ff4g8ZPpECQhpRxaB?a=0&auth_key=1790801668-f23e-0-9af0";

describe("fileKey", () => {
  it("ignores the host and the signature when the file name is an id", () => {
    expect(fileKey(EP9)).toBe(fileKey(EP10));
    expect(fileKey(EP9)).not.toBe(fileKey(EP11));
    expect(fileKey(`${EP9.split("?")[0]}?auth_key=1800000000-other`)).toBe(fileKey(EP9));
  });

  it("keeps the query when the file name is generic", () => {
    const a = fileKey("https://cdn.x.com/hls/index.m3u8?id=101");
    const b = fileKey("https://cdn.x.com/hls/index.m3u8?id=102");
    expect(a).not.toBe(b);
  });

  it("reads a hashed file name with an extension as an id", () => {
    expect(fileKey("https://a.cdn.com/resource/625c67bb08b7cb4ac3b70218ad2e5cdc.mp4?sign=1")).toBe(
      fileKey("https://b.cdn.com/resource/625c67bb08b7cb4ac3b70218ad2e5cdc.mp4?sign=2"),
    );
  });

  it("is null when there is nothing to compare", () => {
    expect(fileKey("")).toBeNull();
    expect(fileKey(undefined)).toBeNull();
    expect(fileKeys(["", null, undefined])).toEqual([]);
  });
});

describe("duplicateOfPrevious", () => {
  beforeEach(() => forgetEpisodeFiles());

  const listing = [
    { number: 9, play_url: EP9 },
    { number: 10, play_url: EP10 },
    { number: 11, play_url: EP11 },
    // Past the first dozen or so the listing carries no URL at all.
    { number: 16, play_url: "" },
    { number: 17 },
  ];

  it("flags the later episode of a pair, never the earlier", () => {
    expect(duplicateOfPrevious("s", 10, fileKeys([EP10]), listing)).toBe(9);
    expect(duplicateOfPrevious("s", 9, fileKeys([EP9]), listing)).toBeNull();
    expect(duplicateOfPrevious("s", 11, fileKeys([EP11]), listing)).toBeNull();
  });

  it("never matches on a missing URL", () => {
    expect(duplicateOfPrevious("s", 17, [], listing)).toBeNull();
    expect(duplicateOfPrevious("s", 17, fileKeys(["https://c.com/abcdefghijklmnopqrst"]), listing)).toBeNull();
  });

  it("uses resolves already made when the listing has no URL", () => {
    const keys = fileKeys(["https://c.com/abcdefghijklmnopqrst.mp4?t=1"]);
    rememberEpisodeFiles("s", 16, keys);
    expect(duplicateOfPrevious("s", 17, fileKeys(["https://d.com/abcdefghijklmnopqrst.mp4?t=2"]), listing)).toBe(16);
    // Another series with the same numbers is not this one.
    expect(duplicateOfPrevious("other", 17, keys, [])).toBeNull();
  });

  it("catches a run of three once each copy is remembered", () => {
    const keys = fileKeys([EP9]);
    rememberEpisodeFiles("s", 20, keys);
    expect(duplicateOfPrevious("s", 21, keys)).toBe(20);
    rememberEpisodeFiles("s", 21, keys);
    expect(duplicateOfPrevious("s", 22, keys)).toBe(21);
  });

  it("never flags the first episode", () => {
    expect(duplicateOfPrevious("s", 1, fileKeys([EP9]), [{ number: 0, play_url: EP9 }])).toBeNull();
  });
});
