import { env } from "../../../../core/runtime.js";

export { toonstream as TOONSTREAM_BASE } from "../../../origins.js";

// When set, every direct source is additionally wrapped through the proxy
// routes (sources that *require* proxying carry `proxiedUrl` regardless).
export const PROXIFY = Boolean(env.PROXIFY) || false;

export const UserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";

export const embedPlayerOrigins = {
  asCdnOrigin: "https://as-cdn21.top",
  rubyStreamOrigin: "https://rubystm.com",
  cloudyUpnOrigin: "https://cloudy.upns.one",
};

// Hosts seen behind /embed/<hash> that have no extractor yet. They're returned
// as `embeds` so clients can iframe them; only as-cdn21 and rubystm reduce to
// a direct source (see scrapers/embed/).
export const knownEmbedHosts = [
  "as-cdn21.top",
  "rubystm.com",
  "cloudy.upns.one",
  "gdmirrorbot.nl",
  "abyssplayer.com",
  "blakiteapi.xyz",
  "emturbovid.com",
];

export const EPISODE_IFRAMES_TTL = 3600 * 24 * 30; // 30days
export const MOVIE_IFRAMES_TTL = 3600 * 24 * 30; // 30days

export const RUBYSTREAM_SOURCE_TTL = 3600 * 8; // 8hr
// Vidmoly signs its m3u8 with e=43200 (12h); expire well before that.
export const VIDMOLY_SOURCE_TTL = 3600 * 6; // 6hr
export const ASCDN_SOURCE_TTL = 3600 * 24 * 2; // 2hr
