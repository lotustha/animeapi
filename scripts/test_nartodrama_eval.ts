import { createApp } from "../src/app.js";

const app = await createApp();
const call = (path: string) => app.handle(new Request("http://localhost" + path));

const json = async (path: string) => {
  const res = await call(path);
  return { status: res.status, body: await res.json().catch(() => null) as any };
};

const pad = (s: string, n: number) => s.padEnd(n);
let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? " PASS" : " FAIL"}  ${pad(label, 52)} ${detail}`);
  ok ? pass++ : fail++;
};

// ── 1. Listing endpoints ────────────────────────────────────────────────────
console.log("\n=== LISTING ENDPOINTS ===");
for (const path of [
  "/movie-tv/nartodrama",
  "/movie-tv/nartodrama/home",
  "/movie-tv/nartodrama/home?page=2",
  "/movie-tv/nartodrama/search/revenge",
  "/movie-tv/nartodrama/search/love?page=2",
  "/movie-tv/nartodrama/genre/action",
  "/movie-tv/nartodrama/tag/karma",
]) {
  const { status, body } = await json(path);
  const n = body?.results?.length ?? (body?.endpoints ? "overview" : 0);
  check(status === 200 && (n === "overview" || n > 0), path, `${status} · ${n}`);
}

// ── 2. Error handling ───────────────────────────────────────────────────────
console.log("\n=== ERROR HANDLING ===");
const bad = [
  ["/movie-tv/nartodrama/info/no-such-slug-zzz", 404],
  ["/movie-tv/nartodrama/watch/no-such-slug-zzz/1", 404],
  ["/movie-tv/nartodrama/watch/dubbed-love-on-ice/abc", 400],
  ["/movie-tv/nartodrama/watch/dubbed-love-on-ice/99999", 404],
] as const;
for (const [path, want] of bad) {
  const { status } = await json(path);
  check(status === want, path, `got ${status}, want ${want}`);
}

// ── 3. Streams across several titles / upstream providers ───────────────────
console.log("\n=== STREAM RESOLUTION + PLAYBACK ===");
const pool = (await json("/movie-tv/nartodrama/search/love")).body?.results ?? [];
const extra = (await json("/movie-tv/nartodrama/home")).body?.results ?? [];
const slugs = [...new Set([...pool.slice(0, 3), ...extra.slice(0, 3)].map((r: any) => r.id))];

for (const slug of slugs) {
  const info = (await json(`/movie-tv/nartodrama/info/${slug}`)).body;
  if (!info?.totalEpisodes) {
    check(false, slug, "info failed");
    continue;
  }

  // first episode and a deep one, to exercise warm + cold paths
  for (const ep of [...new Set([1, Math.min(30, info.totalEpisodes)])]) {
    const { status, body } = await json(`/movie-tv/nartodrama/watch/${slug}/${ep}`);
    const src = body?.sources?.[0];
    if (status !== 200 || !src) {
      check(false, `${slug} ep${ep}`, `status ${status}`);
      continue;
    }

    const raw = decodeURIComponent(new URL(src.url).searchParams.get("url") || "");
    const host = new URL(raw).hostname;

    // (a) the upstream CDN link itself plays
    const direct = await fetch(raw);
    const text = await direct.text();
    const isPlaylist = text.trimStart().startsWith("#EXTM3U");
    const playable = direct.ok && (isPlaylist || !src.isM3U8);

    // (b) the same link served through our own proxy route
    const proxied = new URL(src.url);
    const viaProxy = await call(proxied.pathname + proxied.search);

    check(
      playable && viaProxy.ok,
      `${slug} ep${ep}`,
      `${info.totalEpisodes}eps · ${body.sources.length}src · m3u8=${src.isM3U8} · cdn=${direct.status} proxy=${viaProxy.status} · ${host}`,
    );
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
