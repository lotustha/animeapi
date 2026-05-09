import { USER_AGENT } from "../../animepahe/scraper/index.js";

// hianime.ws shares the enc-dec.app `enc-kai` token scheme with anigo / animekai
// for /ajax/links/list, /ajax/links/view, /api/v1/titles/{id}/episodes etc.
export class MegaUp {
  private static apiBase = "https://enc-dec.app/api";

  static async generateToken(n: string): Promise<string> {
    const res = await fetch(`${this.apiBase}/enc-kai?text=${encodeURIComponent(n)}`);
    const data = (await res.json()) as { result: string };
    return data.result;
  }

  static async decodeIframeData(n: string): Promise<{
    url: string;
    skip: { intro: [number, number]; outro: [number, number] };
  }> {
    const res = await fetch(`${this.apiBase}/dec-kai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: n }),
    });
    const data = (await res.json()) as { result: any };
    return data.result;
  }

  static async decode(n: string): Promise<{
    sources: { file: string }[];
    tracks: { kind: string; file: string; label: string }[];
    download: string;
  }> {
    const res = await fetch(`${this.apiBase}/dec-mega`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: n, agent: USER_AGENT }),
    });
    const data = (await res.json()) as { result: any };
    return data.result;
  }

  // Resolve hianime's /iframe/{id} wrapper down to the real megaup /e/{id} URL.
  private static async resolveIframe(videoUrl: string): Promise<string> {
    if (!/\/iframe\//.test(videoUrl)) return videoUrl;
    const res = await fetch(videoUrl, {
      headers: { "User-Agent": USER_AGENT, Referer: new URL(videoUrl).origin + "/" },
    });
    const html = await res.text();
    const inner = /<iframe[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];
    return inner ?? videoUrl;
  }

  static async extract(videoUrl: string): Promise<{
    sources: { url: string; isM3U8: boolean }[];
    subtitles: { kind: string; url: string; lang: string }[];
    download: string;
  }> {
    const resolved = await this.resolveIframe(videoUrl);
    const url = resolved.replace("/e/", "/media/");
    const res = await fetch(url, {
      headers: { Connection: "keep-alive", "User-Agent": USER_AGENT },
    });
    const data = (await res.json()) as { result: string };
    const decrypted = await this.decode(data.result);

    return {
      sources: decrypted.sources.map((s) => ({
        url: s.file,
        isM3U8: s.file.includes(".m3u8") || s.file.endsWith("m3u8"),
      })),
      subtitles: decrypted.tracks.map((t) => ({
        kind: t.kind,
        url: t.file,
        lang: t.label,
      })),
      download: decrypted.download,
    };
  }
}
