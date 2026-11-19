// Whether a stream link actually hands over bytes.
//
// `/watch` used to stop at "dramatip gave us a link of a kind we know". That
// is not the same as "it plays": on 2026-11-20 two ShortPeak titles were
// imported and shown with a link to hls-store.b-cdn.net that answers 437 to
// anyone who does not send dramatip's Referer, and an audit of one title per
// app found ten apps whose links were refused outright (expired signatures,
// 403, 404). The importer's gate asked this route and was told yes each time.
//
// So the link is fetched - its first kilobyte - before it is returned.

export type Delivery =
  /** The host answered 2xx. */
  | "yes"
  /** The host refused: a 4xx. Asking again will not help. */
  | "no"
  /** No verdict: a timeout, a 5xx, a 429. Not evidence either way. */
  | "unknown";

const UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

const PROBE_TIMEOUT_MS = 8_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Fetch the first bytes of [url] the way a phone's player would. */
export async function checkDelivery(
  url: string,
  headers: Record<string, string> = {},
  fetchImpl: Fetch = fetch,
): Promise<Delivery> {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": UA, Range: "bytes=0-1023", ...headers },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // The verdict is the status line; the body is not ours to download.
    res.body?.cancel().catch(() => {});
    if (res.ok) return "yes";
    if (res.status === 429 || res.status >= 500) return "unknown";
    return "no";
  } catch {
    return "unknown";
  }
}

export type Route =
  /** Anyone may fetch it: the player can be given the link itself. */
  | { via: "direct" }
  /** Only with [headers]: it must go through our proxy, which sends them. */
  | { via: "proxy"; headers: Record<string, string> }
  /** Refused with and without them. */
  | { via: "none" };

/**
 * How [url] can be reached: plainly, only with dramatip's [origin] headers, or
 * not at all.
 *
 * "unknown" is read as the benefit of the doubt (the link is passed on as it
 * would have been): a host that is merely slow must not make a title vanish.
 */
export async function routeFor(
  url: string,
  origin: Record<string, string>,
  fetchImpl: Fetch = fetch,
): Promise<Route> {
  const plain = await checkDelivery(url, {}, fetchImpl);
  if (plain !== "no") return { via: "direct" };
  const dressed = await checkDelivery(url, origin, fetchImpl);
  return dressed === "yes" ? { via: "proxy", headers: origin } : { via: "none" };
}
