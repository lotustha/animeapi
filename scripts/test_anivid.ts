import { Anivid } from "../src/providers/anime/anivid/anivid.js";

async function main() {
  console.log("─── search('frieren') ───");
  const search = await Anivid.search("frieren", 1);
  console.log({
    currentPage: search.currentPage,
    hasNextPage: search.hasNextPage,
    totalPages: search.totalPages,
    count: search.results.length,
    first: search.results[0],
  });

  const top = search.results[0];
  if (!top) {
    console.error("No search results — bailing");
    process.exit(1);
  }

  console.log("\n─── info(", top.id, ") ───");
  const info = await Anivid.info(top.id);
  console.log({
    id: info?.id,
    title: info?.title,
    type: info?.type,
    status: info?.status,
    season: info?.season,
    duration: info?.duration,
    totalEpisodes: info?.totalEpisodes,
    malId: info?.malId,
    anilistId: info?.anilistId,
    genres: info?.genres,
    image: info?.image,
    cover: info?.cover,
    description: (info?.description ?? "").slice(0, 120) + "…",
    relations: info?.relations?.length,
    recommendations: info?.recommendations?.length,
    episodesCount: info?.episodes.length,
    firstEp: info?.episodes[0],
    lastEp: info?.episodes[info?.episodes.length - 1],
  });

  const firstEp = info?.episodes[0];
  if (firstEp) {
    console.log("\n─── streams(", firstEp.id, ", 'sub') ───");
    const streams = await Anivid.streams(firstEp.id, "softsub");
    console.log(JSON.stringify(streams, null, 2));

    console.log("\n─── fetchEpisodeServers(", firstEp.id, ", 'dub') ───");
    const servers = await Anivid.fetchEpisodeServers(firstEp.id, "dub");
    console.log(JSON.stringify(servers, null, 2));
  }

  console.log("\n─── trending(1) ───");
  const trending = await Anivid.trending(1);
  console.log({
    count: trending.results.length,
    first: trending.results[0]?.title,
    last: trending.results[trending.results.length - 1]?.title,
  });

  console.log("\n─── seasonal(1) ───");
  const seasonal = await Anivid.seasonal(1);
  console.log({
    count: seasonal.results.length,
    first: seasonal.results[0]?.title,
  });

  console.log("\n─── upcoming(1) ───");
  const upcoming = await Anivid.upcoming(1);
  console.log({
    count: upcoming.results.length,
    first: upcoming.results[0]?.title,
  });

  console.log("\n─── genres() ───");
  const genres = await Anivid.genres();
  console.log({ count: genres.length, sample: genres.slice(0, 8) });

  console.log("\n─── schedule(today UTC) ───");
  const today = new Date().toISOString().slice(0, 10);
  const sched = await Anivid.schedule(today);
  console.log({ date: today, count: sched.length, first: sched[0], last: sched[sched.length - 1] });

  console.log("\n─── suggestions('jujutsu') ───");
  const sugg = await Anivid.suggestions("jujutsu");
  console.log({ count: sugg.length, first: sugg[0] });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
