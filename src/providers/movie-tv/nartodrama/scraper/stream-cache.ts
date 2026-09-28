import type { DramaStream } from "../types.js";
import { signedUrlExpiry } from "./refresh-source.js";

// How long a resolved episode link is kept on this server and handed to every
// viewer who asks for that episode.
//
// It used to be five minutes for everything. Every viewer's request reaches
// narto through this one server's IP, so narto sees a single very busy client
// and rate-limits it: 16% of the app's episode requests came back "busy" on
// 2026-09-28, with one real viewer. A link that is still good for an hour
// answered from here is one narto call instead of twelve — and the popular
// episodes, which is where viewers overlap, cost narto nothing at all.
//
// The danger is the other way round: a dead link kept for hours. So the TTL
// follows the deadline written in the link itself, never runs into its last
// few minutes, and is short whenever the deadline cannot be read.

/**
 * Never hand out a link with less than this left. Every range request and
 * segment is checked against the signature, so a link given out with one
 * minute to go dies mid-episode, or after a pause.
 */
export const EXPIRY_MARGIN_SEC = 10 * 60;

/** The most a link is kept, however far away its deadline. */
export const MAX_TTL_SEC = 3 * 60 * 60;

/**
 * For a link whose deadline cannot be read — an opaque token (Melolo), or a
 * stamp that is really the import time (flextv's `auth_key`, months old and
 * still playing). Long enough to spare narto, short enough that a link that
 * does die is not served for long; `?fresh=1` from the player replaces it.
 */
export const UNKNOWN_TTL_SEC = 30 * 60;

/**
 * A link borrowed from a fallback rung (narto's own listing, an alternate
 * site). The listing comes from a watch context that may itself be hours old,
 * so these are kept as briefly as before.
 */
export const BORROWED_TTL_SEC = 5 * 60;

/**
 * The deadline inside a narto subtitle proxy link, `/e/s/<base64url json>.<sig>`,
 * whose payload carries `exp`. Null when the URL is not one of those.
 */
export function subtitleTokenExpiry(url: string | null | undefined): number | null {
  // Usually wrapped in our own proxy (`/proxy/fetch?url=https%3A%2F%2F…`), so
  // the path is percent-encoded until it is decoded.
  let text = String(url ?? "");
  try {
    text = decodeURIComponent(text);
  } catch {
    // A stray `%` — read it as it is.
  }
  const match = text.match(/\/e\/s\/([A-Za-z0-9_-]+)\./);
  if (!match) return null;
  try {
    const payload = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    return typeof payload?.exp === "number" && payload.exp > 0 ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Seconds to keep [stream] cached, or 0 for "do not cache".
 *
 * The earliest readable deadline across the video and its subtitles wins, less
 * [EXPIRY_MARGIN_SEC], capped at [MAX_TTL_SEC]. A deadline already in the past
 * is treated as unreadable, not as dead: the resolver has just checked the link
 * is servable, so a past stamp there is some other date (flextv's import time).
 */
export function streamCacheTtl(stream: DramaStream, nowSec = Date.now() / 1000): number {
  if (stream.servedBy) return BORROWED_TTL_SEC;

  const deadlines: number[] = [];
  for (const s of stream.sources) {
    for (const url of [s.directUrl, s.url]) {
      const at = signedUrlExpiry(url) ?? subtitleTokenExpiry(url);
      if (at !== null && at > nowSec) deadlines.push(at);
    }
  }
  for (const sub of stream.subtitles) {
    const at = subtitleTokenExpiry(sub.url) ?? signedUrlExpiry(sub.url);
    if (at !== null && at > nowSec) deadlines.push(at);
  }

  if (deadlines.length === 0) return UNKNOWN_TTL_SEC;
  const left = Math.min(...deadlines) - nowSec - EXPIRY_MARGIN_SEC;
  if (left <= 0) return 0;
  return Math.min(Math.floor(left), MAX_TTL_SEC);
}
