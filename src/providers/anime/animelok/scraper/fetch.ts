import { Logger } from "../../../../core/logger.js";
import { ANIMELOK_BASE, BROWSER_HEADERS } from "./const.js";

// ─── Cookie helpers ───────────────────────────────────────────────────────────

function parseCookies(headers: Headers, existing: Record<string, string> = {}) {
  const raw = headers.get("set-cookie");
  if (!raw) return existing;
  const parts = raw.split(/,(?=[^ ])/);
  for (const part of parts) {
    const [pair] = part.trim().split(";");
    const eqIdx = pair!.indexOf("=");
    if (eqIdx === -1) continue;
    const name = pair!.slice(0, eqIdx).trim();
    const value = pair!.slice(eqIdx + 1).trim();
    if (name) existing[name] = value;
  }
  return existing;
}

function serializeCookies(obj: Record<string, string>) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// ─── Shared API fetcher ───────────────────────────────────────────────────────

/**
 * Warm up animelok.online cookies via cascading requests, then call the target
 * API path. animelok serves its JSON API (episodes / streams) only to clients
 * that carry the cookies handed out by the homepage + the anime page, so we
 * replay that sequence before the real request.
 *
 * @param apiPath  - e.g. "/api/anime/one-piece-21/episodes/1"
 * @param fullSlug - e.g. "one-piece-21" (used for the Referer/anime page URL)
 */
export async function lookerFetch<T = any>(apiPath: string, fullSlug: string): Promise<T> {
  const base = ANIMELOK_BASE;
  const animePageUrl = fullSlug ? `${base}/anime/${fullSlug}` : base;
  const apiUrl = `${base}${apiPath}`;

  const cookies: Record<string, string> = {};

  // Step 1: homepage → initial cookies
  try {
    const homeRes = await fetch(`${base}/`, {
      headers: {
        ...BROWSER_HEADERS,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cache-Control": "max-age=0",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      },
      redirect: "follow",
    });
    parseCookies(homeRes.headers, cookies);
  } catch (e) {
    Logger.warn(`Animelok homepage warm-up failed: ${String(e)}`);
  }

  // Step 2: anime page → page-specific cookies
  if (fullSlug) {
    try {
      const pageRes = await fetch(animePageUrl, {
        headers: {
          ...BROWSER_HEADERS,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Cache-Control": "max-age=0",
          "Upgrade-Insecure-Requests": "1",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-User": "?1",
          Referer: `${base}/`,
          Cookie: serializeCookies(cookies),
        },
        redirect: "follow",
      });
      parseCookies(pageRes.headers, cookies);
    } catch (e) {
      Logger.warn(`Animelok anime-page warm-up failed: ${String(e)}`);
    }
  }

  // Step 3: the real API call with all accumulated cookies
  const apiRes = await fetch(apiUrl, {
    headers: {
      ...BROWSER_HEADERS,
      Accept: "application/json, text/plain, */*",
      Referer: animePageUrl,
      Origin: base,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      Cookie: serializeCookies(cookies),
    },
  });

  const rawText = await apiRes.text();
  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error(`Animelok invalid JSON response: ${rawText.slice(0, 200)}`);
  }
}
