import { proxifyUrl } from "../../lib/proxy.js";
import { DirectSource } from "../../lib/types.js";
// Vidmoly serves both toonstream and anizen, so the extraction lives in one
// place — when vidmoly changes its embed markup there is a single site to fix.
import { getVidmolySource, isVidmolyUrl } from "../../../anizen/scraper/vidmoly.js";

export { isVidmolyUrl };

/**
 * Vidmoly's master.m3u8 is signed and bound to the network that resolved it
 * (its `asn=` query param encodes the requester), so the raw URL 403s from any
 * other network. `proxiedUrl` is therefore always populated regardless of the
 * PROXIFY flag — clients must use it, not `url`.
 */
export async function getVidmolyDirectSource(embedUrl: string): Promise<DirectSource | null> {
  const vm = await getVidmolySource(embedUrl);
  if (!vm) return null;

  const headers = { Referer: vm.referer };
  const sub = vm.subtitles[0];

  return {
    label: "Vidmoly",
    type: "hls",
    url: vm.m3u8,
    headers,
    proxiedUrl: proxifyUrl(vm.m3u8, "hls", headers),
    ...(sub ? { subtitles: { label: sub.label ?? "English", url: sub.file } } : {}),
  };
}
