// Verify Anivid.streams() now goes through the decryptor and returns a
// proxied m3u8 (not just the iframe URL).

import { Anivid } from "../src/providers/anime/anivid/anivid.js";

const id = "113415$ep=1"; // Jujutsu Kaisen, ep 1

console.log("─── Anivid.streams(", id, ", 'softsub') ───");
const sub = await Anivid.streams(id, "softsub");
console.log(JSON.stringify(sub, null, 2));

console.log("\n─── Anivid.fetchEpisodeServers(", id, ", 'hardsub') ───");
const servers = await Anivid.fetchEpisodeServers(id, "hardsub");
console.log(JSON.stringify(servers, null, 2));

console.log("\n─── sanity: type assertion ───");
const first = sub.results[0];
console.log("  sources[0].type =", first?.sources[0]?.type);
console.log("  sources[0].file starts with:", first?.sources[0]?.file?.slice(0, 80));
console.log("  is HLS via proxy?",
  first?.sources[0]?.type === "hls" &&
  (first?.sources[0]?.file?.includes("/proxy/m3u8-proxy") ?? false));
console.log("  subtitle count:", first?.subtitles?.length);
