import { Anivid } from "../src/providers/anime/anivid/anivid.js";

console.log("─── info(113415 = Jujutsu Kaisen) ───");
const info = await Anivid.info("113415");
console.log({
  id: info?.id,
  title: info?.title,
  totalEpisodes: info?.totalEpisodes,
  episodesCount: info?.episodes.length,
  firstEp: info?.episodes[0],
  lastEp: info?.episodes[info?.episodes.length - 1],
});

const ep = info?.episodes[0];
if (ep) {
  console.log("\n─── streams(", ep.id, ") sub ───");
  console.log(JSON.stringify(await Anivid.streams(ep.id, "softsub"), null, 2));

  console.log("\n─── streams(", ep.id, ") dub ───");
  console.log(JSON.stringify(await Anivid.streams(ep.id, "dub"), null, 2));

  console.log("\n─── servers(", ep.id, ") hardsub ───");
  console.log(JSON.stringify(await Anivid.fetchEpisodeServers(ep.id, "hardsub"), null, 2));
}

console.log("\n─── popular(1) first 3 ───");
const pop = await Anivid.popular(1);
console.log(pop.results.slice(0, 3));

console.log("\n─── top-rated(1) first 3 ───");
const top = await Anivid.topRated(1);
console.log(top.results.slice(0, 3));

console.log("\n─── genre(Action) first 3 ───");
const g = await Anivid.genreSearch("Action", 1);
console.log({ totalPages: g.totalPages, hasNextPage: g.hasNextPage, first: g.results.slice(0, 3) });

console.log("\n─── search 'attack on titan' page 2 ───");
const s2 = await Anivid.search("attack on titan", 2);
console.log({ ...s2, results: s2.results.slice(0, 3) });

console.log("\n─── info('mal:52991') Frieren via MAL ID ───");
const malInfo = await Anivid.info("mal:52991");
console.log({ id: malInfo?.id, title: malInfo?.title, episodes: malInfo?.episodes.length });
