import { Logger } from "../../../../core/logger.js";
import { USER_AGENT } from "../../animepahe/scraper/index.js";

// Parses the variant ladder out of an HLS master playlist so clients can offer
// a quality picker / per-resolution download.
//
// What's actually available varies by upstream server — you can only surface
// renditions the source publishes:
//   VidPlay-1 (hsub)  → 360p / 720p / 1080p, a real ladder
//   HD-1 (sub, dub)   → 1080p only
//   VMoly (hindi)     → 1600x900 only (but 5 audio tracks)
// A playlist with no EXT-X-STREAM-INF is a media playlist (segments directly),
// i.e. single quality — that yields an empty list, not an error.

export interface HlsVariant {
  label: string;
  width?: number;
  height?: number;
  bandwidth?: number;
  file: string;
}

function labelFor(height?: number, width?: number, index = 0): string {
  if (height) return `${height}p`;
  if (width) return `${width}w`;
  return `variant ${index + 1}`;
}

export function parseMasterPlaylist(text: string, masterUrl: string): HlsVariant[] {
  const lines = text.split("\n");
  const variants: HlsVariant[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;

    // The URI is the next line that is neither blank nor a tag.
    let uri = "";
    for (let j = i + 1; j < lines.length; j++) {
      const cand = lines[j]!.trim();
      if (!cand || cand.startsWith("#")) continue;
      uri = cand;
      break;
    }
    if (!uri) continue;

    const res = /RESOLUTION=(\d+)x(\d+)/.exec(line);
    const width = res ? Number(res[1]) : undefined;
    const height = res ? Number(res[2]) : undefined;
    const bwMatch = /BANDWIDTH=(\d+)/.exec(line);
    const bandwidth = bwMatch ? Number(bwMatch[1]) : undefined;

    let file: string;
    try {
      file = new URL(uri, masterUrl).href;
    } catch {
      continue;
    }

    variants.push({
      label: labelFor(height, width, variants.length),
      width,
      height,
      bandwidth,
      file,
    });
  }

  // Highest quality first — clients usually want the best as the default.
  variants.sort((a, b) => (b.height ?? b.bandwidth ?? 0) - (a.height ?? a.bandwidth ?? 0));
  return variants;
}

export async function fetchVariants(
  masterUrl: string,
  headers: Record<string, string> = {},
): Promise<HlsVariant[]> {
  try {
    const res = await fetch(masterUrl, { headers: { "User-Agent": USER_AGENT, ...headers } });
    if (!res.ok) return [];
    return parseMasterPlaylist(await res.text(), masterUrl);
  } catch (err) {
    Logger.error(`HLS variant parse failed for ${masterUrl}: ${String(err)}`);
    return [];
  }
}
