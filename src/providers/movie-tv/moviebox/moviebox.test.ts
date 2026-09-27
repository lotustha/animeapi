import { describe, expect, it } from "vitest";
import { MovieBox } from "./moviebox.js";
import { cleanResults, mergeSubtitles, sameCut } from "./scraper/clean.js";
import type { MovieBoxDub, MovieBoxInfo, MovieBoxItem, MovieBoxSubtitle } from "./types.js";

const item = (over: Partial<MovieBoxItem>): MovieBoxItem => ({
  id: "x",
  subjectId: "0",
  title: "x",
  type: "tv",
  genres: [],
  ...over,
});

describe("cleanResults", () => {
  // The shape search returns for "squid game": one card per season, then the
  // English dub as its own show, then an unrelated movie of the same name.
  const page = [
    item({ subjectId: "1", title: "Squid Game S3", id: "squid-game-4CyZm1LfdG3" }),
    item({ subjectId: "1", title: "Squid Game S2", id: "squid-game-4CyZm1LfdG3" }),
    item({ subjectId: "1", title: "Squid Game S1", id: "squid-game-4CyZm1LfdG3" }),
    item({ subjectId: "2", title: "Squid Game [English] S3", id: "squid-game-english-GHjy8KnzyU" }),
    item({ subjectId: "2", title: "Squid Game [English] S1", id: "squid-game-english-GHjy8KnzyU" }),
    item({ subjectId: "3", title: "SQUID GAME", type: "movie", id: "squid-game-6Z3QVm79tA4" }),
  ];

  it("keeps one card per subject, without the season suffix", () => {
    const out = cleanResults(page);
    expect(out.map((i) => [i.subjectId, i.title])).toEqual([
      ["1", "Squid Game"],
      ["3", "SQUID GAME"],
    ]);
  });

  it("keeps a dub whose original is not on the page", () => {
    const out = cleanResults(page.slice(3));
    expect(out.map((i) => i.title)).toEqual(["Squid Game [English]", "SQUID GAME"]);
  });

  it("leaves movie titles alone", () => {
    const movie = item({ subjectId: "9", title: "Rocky S2", type: "movie" });
    expect(cleanResults([movie])[0].title).toBe("Rocky S2");
  });
});

describe("sameCut", () => {
  it("matches runtimes within a second", () => {
    expect(sameCut([6724, 6724], [6724])).toBe(true);
    expect(sameCut([11554, 11558], [11557])).toBe(true);
  });

  it("rejects a different cut, and unknown runtimes", () => {
    expect(sameCut([3655], [3582])).toBe(false);
    expect(sameCut([0], [0])).toBe(false);
  });
});

describe("mergeSubtitles", () => {
  const sub = (langCode: string): MovieBoxSubtitle => ({
    label: langCode,
    langCode,
    url: `https://sub/${langCode}.srt`,
    format: "srt",
  });

  it("adds only the languages the dub lacks, marked fromOriginal", () => {
    const out = mergeSubtitles([sub("fr")], [sub("en"), sub("fr"), sub("ar")]);
    expect(out.map((s) => [s.langCode, s.fromOriginal ?? false])).toEqual([
      ["fr", false],
      ["en", true],
      ["ar", true],
    ]);
  });
});

describe("MovieBox.pickDub", () => {
  const dub = (langCode: string, subjectId: string, over: Partial<MovieBoxDub> = {}) => ({
    id: `title-${subjectId}`,
    subjectId,
    language: langCode,
    langCode,
    original: false,
    kind: "audio" as const,
    ...over,
  });
  const info = {
    id: "title-1",
    subjectId: "1",
    dubs: [
      dub("ko", "1", { original: true }),
      dub("es", "2", { kind: "hardsub" }),
      dub("es", "3"),
      dub("hi", "4"),
    ],
  } as MovieBoxInfo;

  it("defaults to the title's own version", () => {
    expect(MovieBox.pickDub(info)?.subjectId).toBe("1");
  });

  it("picks by langCode, case-insensitively", () => {
    expect(MovieBox.pickDub(info, "HI")?.subjectId).toBe("4");
  });

  it("prefers dubbed audio over a hardsub of the same language", () => {
    expect(MovieBox.pickDub(info, "es")?.subjectId).toBe("3");
  });

  it("picks by dub id", () => {
    expect(MovieBox.pickDub(info, "title-2")?.kind).toBe("hardsub");
  });

  it("returns null for a language the title lacks", () => {
    expect(MovieBox.pickDub(info, "zz")).toBeNull();
  });
});
