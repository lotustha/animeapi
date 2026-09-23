import { absoluteUrl } from "./refresh-source.js";

/**
 * Upstream sometimes hands two episodes the SAME video.
 *
 * Measured 2026-09-23 on "(Dubbed) The Little Pool God" (netshort): episodes 9
 * and 10 resolve to one file — same object id, same signature, only the CDN
 * host differs — and `force=1` returns the same pair again. The viewer watches
 * episode 9 twice and never learns that episode 10 is missing. Nothing here can
 * recover the real file, but a repeat served as "the next episode" is worse
 * than an honest "unavailable" card with a Skip button, which the app already
 * draws for a gone answer.
 *
 * The rule: episode N is the copy when it shares a file with episode N-1. The
 * earlier episode keeps it, so exactly one of the pair is withheld and a run of
 * three identical episodes loses the second and third.
 */

/** A file-name segment that is an id rather than a generic name like `index`. */
const LONG_ID = /[A-Za-z0-9_-]{16,}/;

/**
 * What identifies the video behind a URL, ignoring the host and the signature.
 *
 * The host is dropped because the same object is served from several CDN
 * hostnames (video., txvideo., ns-aws-cdn.). The query is dropped because it
 * carries the signature, which is re-issued — but ONLY when the file name is an
 * id of its own. `/hls/index.m3u8?id=…` names nothing by its path, and keying
 * that on the path would call every episode of such a provider the same file.
 * A false positive hides a real episode from every viewer, so the fallback is
 * the full path and query, which two different episodes cannot share.
 *
 * Null when there is nothing to compare — never a key that could match.
 */
export function fileKey(raw: string | null | undefined): string | null {
  const abs = absoluteUrl(String(raw ?? "").trim());
  if (!abs) return null;
  let url: URL;
  try {
    url = new URL(abs);
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (!path) return null;
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.[A-Za-z0-9]{2,5}$/, "");
  return LONG_ID.test(name) ? path : path + url.search;
}

/** Every distinct key among a source's URLs. */
export function fileKeys(urls: Array<string | null | undefined>): string[] {
  const keys = new Set<string>();
  for (const url of urls) {
    const key = fileKey(url);
    if (key) keys.add(key);
  }
  return [...keys];
}

// Files seen per `slug#episode`, from resolves this process has made. The app
// resolves the next two episodes as soon as one starts, so N-1 is usually here
// by the time N is asked for. Bounded: the oldest entries go first.
const MEMO_MAX = 20_000;
const MEMO_TTL_MS = 12 * 60 * 60_000;
const memo = new Map<string, { keys: string[]; at: number }>();

export function rememberEpisodeFiles(slug: string, episode: number, keys: string[]): void {
  if (keys.length === 0) return;
  const tag = `${slug}#${episode}`;
  memo.delete(tag);
  memo.set(tag, { keys, at: Date.now() });
  while (memo.size > MEMO_MAX) {
    const oldest = memo.keys().next().value;
    if (oldest === undefined) break;
    memo.delete(oldest);
  }
}

function remembered(slug: string, episode: number): string[] {
  const hit = memo.get(`${slug}#${episode}`);
  if (!hit) return [];
  if (Date.now() - hit.at > MEMO_TTL_MS) {
    memo.delete(`${slug}#${episode}`);
    return [];
  }
  return hit.keys;
}

export function forgetEpisodeFiles(): void {
  memo.clear();
}

/** The files the watch page's own episode list gives for one episode. */
function listed(episodes: unknown[], episode: number): string[] {
  for (const item of episodes) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (Number(e.number) !== episode) continue;
    return fileKeys([e.play_url as string, e.direct_play_url as string]);
  }
  return [];
}

/**
 * The episode this one repeats, or null.
 *
 * Compared against N-1 only, from two free sources: the watch page's episode
 * list (it carries URLs for the first dozen or so episodes) and the resolves
 * this process has already made. No extra upstream request — the edge rate-
 * limits, and doubling every resolve to catch a rare upstream error would cost
 * more viewers than it saves. An episode whose predecessor is unknown plays.
 */
export function duplicateOfPrevious(
  slug: string,
  episode: number,
  keys: string[],
  episodes: unknown[] = [],
): number | null {
  if (episode <= 1 || keys.length === 0) return null;
  const previous = new Set([...listed(episodes, episode - 1), ...remembered(slug, episode - 1)]);
  return keys.some((k) => previous.has(k)) ? episode - 1 : null;
}
