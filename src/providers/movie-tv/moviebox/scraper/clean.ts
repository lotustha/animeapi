import type { MovieBoxItem, MovieBoxSubtitle } from "../types.js";

// Search and trending list a TV show once per season ("Squid Game S1", "S2",
// …, all the same subject) and every dub as a show of its own ("Squid Game
// [English] S1-S3"). Cards are cut down to one per subject, titled without the
// season, and a dub whose original is on the same page is dropped: the
// original's info lists it under `dubs`.
const SEASON_SUFFIX = /\s+S\d+(?:-S\d+)?$/i;
const LANG_TAG = /\s*\[[^\]]+\]/;

const key = (type: string, title: string) => `${type}:${title.trim().toLowerCase()}`;

export const cleanResults = (items: MovieBoxItem[]): MovieBoxItem[] => {
  const seen = new Set<string>();
  const unique: MovieBoxItem[] = [];
  for (const item of items) {
    if (seen.has(item.subjectId)) continue;
    seen.add(item.subjectId);
    unique.push(
      item.type === "tv" ? { ...item, title: item.title.replace(SEASON_SUFFIX, "").trim() } : item,
    );
  }

  const originals = new Set(
    unique.filter((i) => !LANG_TAG.test(i.title)).map((i) => key(i.type, i.title)),
  );
  return unique.filter(
    (i) => !LANG_TAG.test(i.title) || !originals.has(key(i.type, i.title.replace(LANG_TAG, ""))),
  );
};

// Dubs are encoded separately, and some are a different cut: Squid Game's
// English dub runs 73s longer than the original, so the original's subtitles
// would drift. Two versions count as the same cut when some stream of each
// agrees on the runtime to the second (resolutions of one version can differ
// by a few seconds between themselves).
export const sameCut = (a: number[], b: number[]) =>
  a.some((x) => x > 0 && b.some((y) => Math.abs(x - y) <= 1));

/** `own` plus the languages only `borrowed` has, marked as taken from the original. */
export const mergeSubtitles = (
  own: MovieBoxSubtitle[],
  borrowed: MovieBoxSubtitle[],
): MovieBoxSubtitle[] => {
  const have = new Set(own.map((s) => s.langCode));
  return [
    ...own,
    ...borrowed.filter((s) => !have.has(s.langCode)).map((s) => ({ ...s, fromOriginal: true })),
  ];
};
