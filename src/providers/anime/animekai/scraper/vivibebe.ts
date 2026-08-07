import { Logger } from "../../../../core/logger.js";
import { USER_AGENT } from "../../animepahe/scraper/index.js";

// vivibebe.site is anikai's default "HD-1" player and the only one of its
// embed hosts that exposes a plain HLS source — the embed page feeds jwplayer
// a bare URL:
//   <script> … src = "https://vivibebe.site/public/stream/<id>/master.m3u8" …
//   sources: [{ file: src }]
// The other hosts (otakuhg, otakuvid, playmogo) hide theirs behind a
// Dean-Edwards-packed script and stay iframe-only.
//
// The playlist needs no Referer and carries a real 360p/720p/1080p ladder.

export function isVivibebeUrl(url: string): boolean {
  return /^https?:\/\/[^/]*\bvivibebe\.[a-z]+/i.test(url);
}

export async function getVivibebeSource(embedUrl: string): Promise<string | null> {
  try {
    const res = await fetch(embedUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: `${new URL(embedUrl).origin}/`,
      },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const inline = /https?:\/\/[^"'\s\\)]+\.m3u8[^"'\s\\)]*/.exec(html)?.[0];
    if (inline) return inline;

    // Fallback: the playlist path is derivable from the embed id, so a markup
    // tweak that hides the literal URL doesn't necessarily break extraction.
    const id = new URL(embedUrl).pathname.split("/").filter(Boolean).pop();
    if (!id) return null;
    const guess = `${new URL(embedUrl).origin}/public/stream/${id}/master.m3u8`;
    const probe = await fetch(guess, { headers: { "User-Agent": USER_AGENT } });
    if (!probe.ok) return null;
    const body = await probe.text();
    return body.trimStart().startsWith("#EXTM3U") ? guess : null;
  } catch (err) {
    Logger.error(`Vivibebe extractor error for ${embedUrl}: ${String(err)}`);
    return null;
  }
}
