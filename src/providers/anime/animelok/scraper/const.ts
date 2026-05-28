export { animelok as ANIMELOK_BASE } from "../../../origins.js";

// animelok.online sits behind bot protection that inspects browser-ish headers.
// These mirror a real Chrome request and are sent on every step of the
// cookie-warming flow in fetch.ts.
export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.6",
  "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not:A-Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

// Best-to-worst ordering used to sort direct streams within a server group.
export const QUALITY_ORDER = ["Multi", "1080p", "720p", "480p", "360p", "unknown"];
