import * as cheerio from "cheerio";
import { Logger } from "../../../../core/logger.js";
import { USER_AGENT } from "../../animepahe/scraper/index.js";

// EarnVids (otakuvid.online) is the only anikai download host that publishes a
// per-quality breakdown. Its /d/<id> page lists three tiers, each linking to
// /download/<id>_<h|n|l>:
//   <a href="/download/<id>_h">…</a>  "UHD quality 1920x1080 278.5 MB"
//
// IMPORTANT: these are NOT direct file URLs. Each lands on a page whose POST
// form is gated by an invisible reCAPTCHA, and the hosts currently answer that
// POST with "Downloads disabled" / "This version is not available" for every
// title tested. So the tiers are surfaced as metadata plus a hand-off link for
// the user's own browser — the API deliberately does not attempt to defeat
// that gate. Treat `url` as "open this in a browser", not "fetch this".

export interface EarnvidsQuality {
  label: string;
  resolution?: string;
  size?: string;
  url: string;
}

export function isEarnvidsUrl(url: string): boolean {
  return /^https?:\/\/[^/]*\botakuvid\.[a-z]+/i.test(url);
}

export async function getEarnvidsQualities(
  pageUrl: string,
): Promise<{ filename?: string; qualities: EarnvidsQuality[] } | null> {
  try {
    const res = await fetch(pageUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: `${new URL(pageUrl).origin}/`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const origin = new URL(pageUrl).origin;

    const qualities: EarnvidsQuality[] = [];
    $('a[href*="/download/"]').each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const text = $(el).text().replace(/\s+/g, " ").trim();
      // "UHD quality 1920x1080 278.5 MB"
      const resolution = /(\d{3,4}x\d{3,4})/.exec(text)?.[1];
      const size = /([\d.]+\s*[KMG]B)/i.exec(text)?.[1];
      const label = text.replace(/\s*\d{3,4}x\d{3,4}.*$/, "").trim() || "unknown";
      const url = href.startsWith("http") ? href : `${origin}${href}`;
      if (qualities.some((q) => q.url === url)) return;
      qualities.push({ label, resolution, size, url });
    });

    if (qualities.length === 0) return null;
    return { filename: /[\w.-]+\.mp4/.exec(html)?.[0], qualities };
  } catch (err) {
    Logger.error(`EarnVids quality parse failed for ${pageUrl}: ${String(err)}`);
    return null;
  }
}
