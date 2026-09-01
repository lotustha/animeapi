// HLS playlist rewriting for /proxy/m3u8-proxy.
//
// Pure — no env, no network — so it can be unit-tested. The route reads the
// upstream body, calls `isPlaylist` to make sure it really is a playlist, then
// `proxifyPlaylist` to point every URI back through the proxy.
//
// WHY THIS IS STRUCTURAL AND NOT EXTENSION-BASED
// Segment CDNs used by the anime hosts rotate fake extensions on segment URLs
// (`seg-00004.txt`, `.jpg`, `.css`, `.html`, ...) to defeat naive filters. The
// previous implementation decided "playlist vs segment" with
// `/\.m3u|playlist|\.txt/i` on the URL, so every `.txt` segment (one in eight)
// was rewritten to /proxy/m3u8-proxy, which then decoded the MPEG-TS bytes as
// UTF-8 and re-emitted them as "playlist lines" — the client received 3–9 MB of
// percent-encoded U+FFFD instead of video. The HLS spec already tells us what a
// URI line is from the playlist's own tags, so that is what we use.

export interface ProxifyOptions {
  /** Absolute URL the playlist was fetched from (base for relative URIs). */
  url: string;
  /** Proxy origin, e.g. https://api.example.com */
  origin: string;
  /** The raw `headers` query param to forward on every rewritten link, if any. */
  headers?: string;
}

type Kind = "playlist" | "segment" | "fetch";

const PLAYLIST_URL_HINT = /\.m3u8?(?:[?#]|$)|playlist/i;

/**
 * True when the body starts with the M3U8 magic (`#EXTM3U`), allowing a UTF-8
 * BOM and leading whitespace. Anything else — in particular MPEG-TS, which
 * starts with 0x47 — is not a playlist and must be passed through untouched.
 */
export function isPlaylist(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (
    i < bytes.length &&
    (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)
  )
    i++;
  const magic = "#EXTM3U";
  if (bytes.length - i < magic.length) return false;
  for (let k = 0; k < magic.length; k++) {
    if (bytes[i + k] !== magic.charCodeAt(k)) return false;
  }
  return true;
}

function tagName(line: string): string {
  const colon = line.indexOf(":");
  return colon === -1 ? line : line.slice(0, colon);
}

/** What a `URI="..."` attribute inside a given tag points at. */
function kindForTagUri(tag: string): Kind {
  switch (tag) {
    case "#EXT-X-MEDIA": // alternate rendition (audio/subs) → a media playlist
    case "#EXT-X-I-FRAME-STREAM-INF":
    case "#EXT-X-RENDITION-REPORT":
      return "playlist";
    case "#EXT-X-MAP": // init section
    case "#EXT-X-PART": // LL-HLS partial segment
    case "#EXT-X-PRELOAD-HINT":
      return "segment";
    default: // #EXT-X-KEY, #EXT-X-SESSION-KEY, #EXT-X-SESSION-DATA, ...
      return "fetch";
  }
}

export function proxifyPlaylist(text: string, opts: ProxifyOptions): string {
  const { url, origin } = opts;
  const encodedHeaders = opts.headers ? `&headers=${encodeURIComponent(opts.headers)}` : "";

  const link = (kind: Kind, absolute: string): string => {
    const route = kind === "playlist" ? "m3u8-proxy" : kind === "segment" ? "ts-segment" : "fetch";
    return `${origin}/proxy/${route}?url=${encodeURIComponent(absolute)}${encodedHeaders}`;
  };

  // A master playlist lists variants (#EXT-X-STREAM-INF); a media playlist lists
  // segments (#EXTINF). The bare URI lines mean different things in each, and
  // that — not the URL's extension — is what decides where they are routed.
  const isMaster = /^#EXT-X-STREAM-INF\b/m.test(text);
  const isMedia = /^#EXTINF\b/m.test(text);
  const bareLineKind = (absolute: string): Kind => {
    if (isMaster && !isMedia) return "playlist";
    if (isMedia && !isMaster) return "segment";
    // Degenerate playlist with neither tag: fall back to the URL hint, but never
    // treat a bare `.txt` (or any other rotated extension) as a playlist.
    return PLAYLIST_URL_HINT.test(absolute) ? "playlist" : "segment";
  };

  return text
    .split("\n")
    .map((line) => {
      const tl = line.trim();
      if (!tl) return line;

      if (tl.startsWith("#")) {
        if (!tl.startsWith("#EXT")) return tl; // comment
        const kind = kindForTagUri(tagName(tl));
        return tl.replace(/URI="([^"]+)"/g, (_, uri: string) => {
          const absolute = resolve(uri, url);
          return absolute === null ? `URI="${uri}"` : `URI="${link(kind, absolute)}"`;
        });
      }

      const absolute = resolve(tl, url);
      if (absolute === null) return tl;
      return link(bareLineKind(absolute), absolute);
    })
    .join("\n");
}

function resolve(uri: string, base: string): string | null {
  try {
    return new URL(uri, base).href;
  } catch {
    return null;
  }
}
