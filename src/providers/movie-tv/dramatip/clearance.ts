import { Logger } from "../../../core/logger.js";

/**
 * dramatip.net's Cloudflare challenge (since 2026-11-21).
 *
 * Every path answers non-browsers with a "managed" challenge: 403, header
 * `cf-mitigated: challenge`, body "Just a moment...". A real browser passes it
 * and gets a `cf_clearance` cookie. With that cookie AND the same User-Agent,
 * a plain fetch from the same IP is let through, for some time.
 *
 * So: FlareSolverr (a headless Chrome, docker on the VPS, localhost:8191)
 * solves the challenge once (on an HTML page: a text file runs no challenge
 * script, so it earns no cookie); we keep its cookie and UA in memory and send them
 * with every dramatip request. A challenged answer gets a new clearance (one
 * at a time) and one retry.
 */

const SOLVER_URL = process.env.FLARESOLVERR_URL || "http://127.0.0.1:8191/v1";
const SOLVE_TIMEOUT_MS = 60_000;
/** After a failed solve, do not ask again for a while: each try costs a Chrome tab. */
const FAIL_COOLDOWN_MS = 60_000;

export const FALLBACK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type Clearance = { userAgent: string; cookie: string; at: number };

let current: Clearance | null = null;
let solving: Promise<Clearance | null> | null = null;
let failedAt = 0;

/** A Cloudflare challenge rather than dramatip's own answer. */
export function isChallenge(res: Response): boolean {
  if (res.headers.get("cf-mitigated") === "challenge") return true;
  return (res.status === 403 || res.status === 503) && res.headers.get("server") === "cloudflare"
    && (res.headers.get("content-type") ?? "").includes("text/html");
}

async function solve(origin: string): Promise<Clearance | null> {
  if (Date.now() - failedAt < FAIL_COOLDOWN_MS) return null;
  try {
    const res = await fetch(SOLVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", url: `${origin}/`, maxTimeout: SOLVE_TIMEOUT_MS - 5_000 }),
      signal: AbortSignal.timeout(SOLVE_TIMEOUT_MS),
    });
    const body = (await res.json()) as {
      status?: string;
      message?: string;
      solution?: { userAgent?: string; cookies?: { name: string; value: string }[] };
    };
    const cookies = body.solution?.cookies ?? [];
    const ua = body.solution?.userAgent;
    if (body.status !== "ok" || !ua || !cookies.some((c) => c.name === "cf_clearance")) {
      throw new Error(`solver said ${body.status}: ${body.message ?? "no cf_clearance"}`);
    }
    failedAt = 0;
    Logger.info("[dramatip] new Cloudflare clearance");
    return { userAgent: ua, cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "), at: Date.now() };
  } catch (e) {
    failedAt = Date.now();
    Logger.warn(`[dramatip] clearance failed: ${(e as Error).message}`);
    return null;
  }
}

/** One solve at a time; callers waiting on a challenge share its result. */
function refresh(origin: string, stale: Clearance | null): Promise<Clearance | null> {
  if (current && current !== stale) return Promise.resolve(current);
  solving ??= solve(origin).then((c) => {
    if (c) current = c;
    solving = null;
    return c;
  });
  return solving;
}

function dress(init: RequestInit, c: Clearance | null): RequestInit {
  const headers = new Headers(init.headers);
  // Cloudflare ties the cookie to the UA that earned it.
  headers.set("User-Agent", c?.userAgent ?? FALLBACK_UA);
  if (c) headers.set("Cookie", c.cookie);
  return { ...init, headers };
}

/**
 * fetch() for dramatip.net: carries the clearance, and on a challenge gets a
 * new one and tries once more. A challenge that survives is returned as is
 * (the caller's !res.ok path reports it).
 */
export async function dramatipFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const used = current;
  const res = await fetch(url, dress(init, used));
  if (!isChallenge(res)) return res;

  const fresh = await refresh(new URL(url).origin, used);
  if (!fresh) return res;
  await res.body?.cancel();
  // The first attempt's timeout signal may be nearly spent after a solve.
  return fetch(url, dress({ ...init, signal: AbortSignal.timeout(20_000) }, fresh));
}

/** Tests only. */
export function _resetClearance() {
  current = null;
  solving = null;
  failedAt = 0;
}
