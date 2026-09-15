import { SERVER_ORIGIN } from "./config.js";

// `forceHls` is for sources that are HLS but carry no `.m3u8` in the URL —
// tokenized player endpoints (e.g. nartodrama's /e/m/<jwt>?mh=1) serve
// application/vnd.apple.mpegurl from an extensionless path, and would otherwise
// be misrouted to the mp4 proxy and never get their playlist rewritten.
export const proxifySource = (
  url: string,
  headers?: Record<string, string> | undefined,
  forceHls = false,
) => {
  const urlParam = `?url=` + encodeURIComponent(url);
  const headerParam = headers ? `&headers=` + encodeURIComponent(JSON.stringify(headers)) : "";
  if (forceHls || url.includes(".m3u")) {
    // count as hls source
    return SERVER_ORIGIN + "/proxy/m3u8-proxy" + urlParam + headerParam;
  } else {
    // count as mp4
    return SERVER_ORIGIN + "/proxy/mp4-proxy" + urlParam + headerParam;
  }
};

// Route a sidecar asset (e.g. a subtitle .vtt) through /proxy/fetch so the
// server re-requests it with the given headers. Some subtitle CDNs
// (megaplay/vidwish/vidtube) hard-check Referer and 403 otherwise — players
// inject the source Referer for the video but not for subtitle sidecars, so
// those subs silently fail to load unless fetched through here. Falls back to
// the raw url when SERVER_ORIGIN is unset (e.g. tests).
export const proxifyFetch = (url: string, headers?: Record<string, string> | undefined) => {
  if (!SERVER_ORIGIN || !url) return url;
  const urlParam = `?url=` + encodeURIComponent(url);
  const headerParam = headers ? `&headers=` + encodeURIComponent(JSON.stringify(headers)) : "";
  return SERVER_ORIGIN + "/proxy/fetch" + urlParam + headerParam;
};
