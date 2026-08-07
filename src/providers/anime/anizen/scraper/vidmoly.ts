import { Logger } from "../../../../core/logger.js";
import { USER_AGENT } from "../../animepahe/scraper/index.js";

// Vidmoly ("VMoly") is the one anizen Hindi mirror that exposes a plain HLS
// source — the embed page inlines a jwplayer setup block:
//   sources: [{ file: 'https://<prx-host>/hls2/.../master.m3u8?t=…&s=…&asn=…' }]
//   tracks:  [{ file: 'https://srt.vidmoly.me/srt/.../<Lang>.vtt', label: 'English' }]
// The other three Hindi servers can't be reduced to HLS: Abyss (ryzex.top) is
// abyss.to/hydrax with an AES-encrypted `media` blob behind obfuscated player
// JS, and Default/Mirror are the same gdmirrorbot redirector whose payload is
// likewise base64+obfuscated. Those stay iframe-only.
//
// IMPORTANT — the master.m3u8 URL is signed AND bound to the resolving network
// (the `asn=` param encodes it). A URL resolved on the server 403s when a
// client on another network plays it, so the caller MUST route this through
// the internal m3u8 proxy rather than handing the raw URL to the client.
//
// The host rotates TLDs within a single response (vidmoly.net 302s to
// vidmoly.biz; subtitles come off vidmoly.me), so match the brand, not a host.

export interface VidmolySource {
  m3u8: string;
  referer: string;
  subtitles: { file: string; label?: string }[];
}

export function isVidmolyUrl(url: string): boolean {
  return /^https?:\/\/[^/]*\bvidmoly\.[a-z]+/i.test(url);
}

export async function getVidmolySource(embedUrl: string): Promise<VidmolySource | null> {
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

    const m3u8 = /sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i.exec(html)?.[1];
    if (!m3u8) {
      Logger.warn(`Vidmoly: no m3u8 in embed page ${embedUrl}`);
      return null;
    }

    // tracks: [{ file: '…vtt', label: 'English', kind: 'captions' }]
    const subtitles: { file: string; label?: string }[] = [];
    for (const m of html.matchAll(
      /\{\s*file\s*:\s*["'](https?:\/\/[^"']+\.vtt)["']\s*(?:,\s*label\s*:\s*["']([^"']*)["'])?/gi,
    )) {
      subtitles.push({ file: m[1]!, label: m[2] || undefined });
    }

    // Follow-on segment requests are validated against the embed's own origin
    // (res.url reflects the vidmoly.net → vidmoly.biz redirect).
    const referer = `${new URL(res.url || embedUrl).origin}/`;
    return { m3u8, referer, subtitles };
  } catch (err) {
    Logger.error(`Vidmoly extractor error for ${embedUrl}: ${String(err)}`);
    return null;
  }
}
