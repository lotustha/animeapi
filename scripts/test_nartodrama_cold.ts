import { NartoDrama } from "../src/providers/movie-tv/nartodrama/nartodrama.js";

// 1. hasNextPage must now be true for search page 1 (site emits link rel=next).
const p1 = await NartoDrama.search("love", 1);
const p2 = await NartoDrama.search("love", 2);
console.log("### PAGINATION");
console.log({
  p1: { count: p1.results.length, hasNext: p1.hasNextPage },
  p2: { count: p2.results.length, hasNext: p2.hasNextPage },
  distinct: p1.results[0]?.id !== p2.results[0]?.id,
});

// 2. Cold episode on a title this session has never touched.
const pool = (await NartoDrama.search("revenge", 1)).results;
const target = pool.find(
  (r) => !["dubbed-love-on-ice", "addicted-to-the-wrong-love"].includes(r.id),
);
console.log("\n### COLD TARGET", target?.id);

if (target) {
  const info = await NartoDrama.info(target.id);
  const deep = Math.min(50, info?.totalEpisodes ?? 1);
  console.log("totalEpisodes:", info?.totalEpisodes, "-> requesting ep", deep);

  const stream = await NartoDrama.watch(target.id, deep);
  console.log("sources:", stream?.sources.length, "isM3U8:", stream?.sources[0]?.isM3U8);

  if (stream?.sources[0]) {
    const raw = decodeURIComponent(new URL(stream.sources[0].url).searchParams.get("url") || "");
    const res = await fetch(raw);
    const body = await res.text();
    console.log("CDN:", res.status, res.headers.get("content-type"));
    console.log("playable playlist:", body.trimStart().startsWith("#EXTM3U"));

    // 3. How long is the signed URL actually good for?
    const jwt = raw.match(/\/e\/[ms]\/([\w-]+\.[\w-]+)/)?.[1];
    const ts = Number(new URL(raw).searchParams.get("ts"));
    const now = Math.floor(Date.now() / 1000);
    if (jwt) {
      try {
        const payload = JSON.parse(Buffer.from(jwt.split(".")[0], "base64").toString());
        console.log("token exp in:", (payload.exp - now) / 60, "min");
      } catch {
        /* not a decodable payload */
      }
    }
    if (ts) console.log("cdn ts delta:", (ts - now) / 60, "min");
  } else {
    console.log("!! no source resolved — cold fallback did NOT recover");
  }
}
