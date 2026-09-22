import { createApp } from "../src/app.js";

const app = await createApp();

const paths = [
  "/movie-tv/nartodrama",
  "/movie-tv/nartodrama/home",
  "/movie-tv/nartodrama/search/revenge",
  "/movie-tv/nartodrama/tag/karma",
  "/movie-tv/nartodrama/info/dubbed-love-on-ice",
  "/movie-tv/nartodrama/watch/dubbed-love-on-ice/2",
  "/movie-tv/nartodrama/watch/no-such-series-abc/1",
  "/movie-tv/nartodrama/watch/dubbed-love-on-ice/abc",
  "/movie-tv/nartodrama/search/love?page=2",
  "/movie-tv",
];

for (const path of paths) {
  const res = await app.handle(new Request("http://localhost" + path));
  const body: any = await res.json().catch(() => ({}));

  let summary: unknown;
  if (Array.isArray(body?.results)) summary = `${body.results.length} results`;
  else if (body?.sources) summary = `${body.sources.length} src, isM3U8=${body.sources[0]?.isM3U8}`;
  else if (body?.episodes) summary = `${body.title} — ${body.totalEpisodes} eps`;
  else if (body?.providers) summary = `providers: ${body.providers.join(", ")}`;
  else summary = JSON.stringify(body).slice(0, 90);

  console.log(String(res.status).padEnd(4), path.padEnd(48), summary);
}
