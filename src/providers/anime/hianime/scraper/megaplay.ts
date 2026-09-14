import { USER_AGENT } from "../../animepahe/scraper/utils.js";

// hianime.at doesn't host or encrypt anything itself: every server in
// /api/theme/episode/servers is a base64 `data-hash` that decodes straight to a
// third-party embed URL. Three families show up:
//
//   megaplay.buzz / vidwish.live / vidtube.site  → same player, extractable
//   zokoanime.video                              → unknown player, iframe only
//
// For the megaplay family the chain is:
//   1. GET <embed>                      → scrape data-id="<fileId>"
//   2. GET <origin>/stream/getSources?id=<fileId>
//        → { enc, server, tracks, intro, outro }
//
// `sources` used to be plaintext in that payload; it is now an encrypted `enc`
// blob, so the m3u8 comes back only if the shared enc-dec.app helper (already a
// repo-wide dependency — anigo/animekai use the same service) can decrypt it.
// That call is UA-bound: the User-Agent sent to getSources must be the one
// handed to dec-mega, so both use USER_AGENT and neither may be overridden.
// When decryption fails we still return tracks/intro/outro and let the caller
// surface the embed as an iframe, which players can load directly.

const MEGAPLAY_HOSTS = ["megaplay.buzz", "vidwish.live", "vidtube.site"];

export interface EmbedSources {
  sources: { url: string; isM3U8: boolean }[];
  subtitles: { kind: string; url: string; lang: string }[];
  intro: { start: number; end: number } | null;
  outro: { start: number; end: number } | null;
  /** Referer the CDN hard-checks; clients must replay it or the m3u8 403s. */
  referer: string | null;
}

export class MegaPlay {
  private static decApi = "https://enc-dec.app/api";

  static isExtractable(url: string): boolean {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      return MEGAPLAY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    } catch {
      return false;
    }
  }

  private static toInt(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  // megaplay.buzz serves a "We can't find the file … Error Code: 410" body
  // (with HTTP 200) to requests that arrive with no Referer. Any non-empty
  // Referer satisfies it; Origin alone does not. Same gate documented in
  // anizen.ts — a browser <iframe> sends it automatically, a bare fetch doesn't.
  private static embedHeaders(referer: string): Record<string, string> {
    return { "User-Agent": USER_AGENT, Referer: referer };
  }

  private static async decrypt(enc: string): Promise<{ file: string }[] | null> {
    try {
      const res = await fetch(`${this.decApi}/dec-mega`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: enc, agent: USER_AGENT }),
      });
      const data = (await res.json()) as { result?: any };
      const sources = data?.result?.sources;
      if (!Array.isArray(sources)) return null;
      return sources.filter((s: any) => typeof s?.file === "string");
    } catch {
      return null;
    }
  }

  static async extract(embedUrl: string, siteOrigin: string): Promise<EmbedSources | null> {
    try {
      if (!this.isExtractable(embedUrl)) return null;

      const pageRes = await fetch(embedUrl, { headers: this.embedHeaders(`${siteOrigin}/`) });
      if (!pageRes.ok) return null;
      const html = await pageRes.text();

      const fileId =
        /id="megaplay-player"[^>]*data-id\s*=\s*"(\d+)"/i.exec(html)?.[1] ??
        /data-id\s*=\s*"(\d+)"/i.exec(html)?.[1];
      if (!fileId) return null;

      const origin = new URL(embedUrl).origin;
      const srcRes = await fetch(`${origin}/stream/getSources?id=${fileId}`, {
        headers: {
          "User-Agent": USER_AGENT,
          Referer: embedUrl,
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      if (!srcRes.ok) return null;
      const data = (await srcRes.json()) as any;

      // Plaintext `sources` (older payloads) is still honoured; otherwise decrypt.
      const plain = Array.isArray(data?.sources)
        ? data.sources
        : data?.sources?.file
          ? [{ file: data.sources.file }]
          : null;
      const files = plain ?? (typeof data?.enc === "string" ? await this.decrypt(data.enc) : null);

      const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
      const subtitles = tracks
        .filter((t: any) => t?.kind !== "thumbnails" && typeof t?.file === "string")
        .map((t: any) => ({
          kind: typeof t.kind === "string" ? t.kind : "captions",
          url: t.file as string,
          lang: typeof t.label === "string" ? t.label : "Unknown",
        }));

      return {
        sources: (files ?? []).map((s) => ({
          url: s.file,
          isM3U8: s.file.includes(".m3u8"),
        })),
        subtitles,
        intro:
          data?.intro && typeof data.intro.start === "number"
            ? { start: this.toInt(data.intro.start), end: this.toInt(data.intro.end) }
            : null,
        outro:
          data?.outro && typeof data.outro.start === "number"
            ? { start: this.toInt(data.outro.start), end: this.toInt(data.outro.end) }
            : null,
        referer: `${origin}/`,
      };
    } catch {
      return null;
    }
  }
}
