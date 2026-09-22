import { NartoDrama } from "../src/providers/movie-tv/nartodrama/nartodrama.js";

console.log("### SEARCH 'love'");
const search = await NartoDrama.search("love", 1);
console.log({ page: search.currentPage, next: search.hasNextPage, count: search.results.length });
console.log(search.results.slice(0, 3));

console.log("\n### HOME");
const home = await NartoDrama.home(1);
console.log({ next: home.hasNextPage, count: home.results.length, first: home.results[0] });

const slug = search.results[0]?.id ?? "dubbed-love-on-ice";
console.log("\n### INFO", slug);
const info = await NartoDrama.info(slug);
console.log({
  id: info?.id,
  title: info?.title,
  poster: info?.poster,
  totalEpisodes: info?.totalEpisodes,
  tags: info?.tags,
  desc: info?.description?.slice(0, 120),
  ep1: info?.episodes[0],
  epLast: info?.episodes[info.episodes.length - 1],
});

console.log("\n### WATCH", slug, "ep1");
const stream = await NartoDrama.watch(slug, 1);
console.log(JSON.stringify(stream, null, 2)?.slice(0, 1200));

// Verify the resolved CDN url actually plays (unproxied, no Referer).
if (stream?.sources[0]) {
  const raw = decodeURIComponent(
    new URL(stream.sources[0].url).searchParams.get("url") || stream.sources[0].url,
  );
  const r = await fetch(raw);
  const body = await r.text();
  console.log("\n### CDN CHECK", r.status, r.headers.get("content-type"));
  console.log("is playlist:", body.trimStart().startsWith("#EXTM3U"), "| bytes:", body.length);
}

console.log("\n### INFO on bogus slug (expect null)");
console.log(await NartoDrama.info("this-slug-does-not-exist-xyz"));
