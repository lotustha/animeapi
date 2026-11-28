import type { ChainEntry } from "./parse.js";

// Which of dramatip's stream kinds we can hand to a player, and how.
//
// dramatip aggregates ~87 apps and its player has a loader per delivery
// scheme. A `chain` lists the ways to play one episode, best first, each with
// a `type`. Some are a plain link. Some only work through dramatip's own
// media proxy, which checks the Origin header. Some are encrypted segment by
// segment and are decrypted in the browser - those cannot be expressed as a
// URL at all, and are refused here rather than returned as a link that plays
// nothing. AN ALLOWLIST, so a type nobody has looked at fails closed.

/** dramatip's media proxy: `<proxy>/https/<host>/<path>`. Wants its Origin. */
export const MEDIA_PROXY = "https://cdn.dramadizilerim.xyz";

export type Playable =
  /** A link the player can open itself. */
  | { how: "direct"; url: string; isM3U8: boolean }
  /** A link that only answers dramatip's origin: it goes through our proxy. */
  | { how: "origin-proxy"; url: string; isM3U8: true };

export type Verdict = Playable | { how: "unsupported"; why: string };

/** `https://host/path` as the media proxy addresses it. */
export function viaMediaProxy(url: string): string {
  const u = new URL(url);
  return `${MEDIA_PROXY}/${u.protocol.replace(":", "")}/${u.host}${u.pathname}${u.search}`;
}

/**
 * How to play one chain entry, given its decrypted [url].
 *
 *   hls        a playlist anyone may fetch (ToonShort, DramaBox's HLS mirror)
 *   goodshort  the same, under its own name, from an extensionless path
 *   mp4        a file - unless its name says `.encrypt.`: DramaBox's signed
 *              MP4s are AES-CBC inside and only the browser player opens them
 *   dramawave  ShortTV / MyDramaWave: the CDN refuses every direct request,
 *              and answers through the media proxy when Origin is dramatip's
 */
export function verdictFor(type: string | undefined, url: string): Verdict {
  if (!/^https?:\/\//i.test(url)) return { how: "unsupported", why: "not a url" };
  switch (type) {
    case "hls":
    case "goodshort":
      return { how: "direct", url, isM3U8: true };
    case "mp4":
      if (/\.encrypt\./i.test(url)) return { how: "unsupported", why: "encrypted mp4" };
      return { how: "direct", url, isM3U8: /\.m3u8(\?|$)/i.test(url) };
    case "dramawave":
      return { how: "origin-proxy", url: viaMediaProxy(url), isM3U8: true };
    default:
      return { how: "unsupported", why: `type ${type ?? "none"}` };
  }
}

/**
 * The first entry of [chain] we can play, in dramatip's own order.
 *
 * [open] decrypts an entry's `enc`. An entry that will not decrypt is skipped
 * like an unsupported one; the reasons are returned so the caller can count
 * what it is missing.
 */
export function choose(
  chain: ChainEntry[] | undefined,
  open: (enc: string) => string,
): { ok: true; entry: ChainEntry; play: Playable } | { ok: false; why: string[] } {
  const { picks, why } = chooseAll(chain, open);
  return picks.length > 0 ? { ok: true, ...picks[0] } : { ok: false, why };
}

/**
 * Every entry of [chain] we could play, in dramatip's own order.
 *
 * The first is not always the one that delivers: DramaBox titles list an mp4
 * on pl.shortdizilab.com first and an HLS mirror after it, and that host
 * refuses some titles outright ("F-Rank Awakening: Zero to Superhero",
 * 2026-11-28). The caller tries them in turn.
 */
export function chooseAll(
  chain: ChainEntry[] | undefined,
  open: (enc: string) => string,
): { picks: { entry: ChainEntry; play: Playable }[]; why: string[] } {
  const picks: { entry: ChainEntry; play: Playable }[] = [];
  const why: string[] = [];
  for (const entry of chain ?? []) {
    if (!entry?.enc) {
      why.push(`type ${entry?.type ?? "none"} (no enc)`);
      continue;
    }
    let url: string;
    try {
      url = open(entry.enc);
    } catch {
      why.push(`type ${entry.type ?? "none"} (undecryptable)`);
      continue;
    }
    const verdict = verdictFor(entry.type, url);
    if (verdict.how !== "unsupported") picks.push({ entry, play: verdict });
    else why.push(verdict.why);
  }
  if (picks.length === 0 && why.length === 0) why.push("empty chain");
  return { picks, why };
}

/**
 * Whether a chain could play, judged by its types alone - no key needed.
 *
 * Used when listing a title: an `mp4` entry is counted as playable here even
 * though an encrypted one is refused at watch time, so this errs towards
 * "maybe". The importer asks `/watch` for episode one before it keeps a title.
 */
export function mightPlay(chain: ChainEntry[] | undefined): boolean {
  return (chain ?? []).some((e) =>
    ["hls", "goodshort", "mp4", "dramawave"].includes(String(e?.type)),
  );
}
