const BASE = "https://api.mugenstream.fun";

const get = async (p: string) => {
  const res = await fetch(BASE + p);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? " PASS" : " FAIL"}  ${label.padEnd(50)} ${detail}`);
  ok ? pass++ : fail++;
};

console.log("=== PRODUCTION VPS:", BASE, "===\n--- listings ---");
for (const p of [
  "/movie-tv/nartodrama",
  "/movie-tv/nartodrama/home",
  "/movie-tv/nartodrama/search/revenge",
  "/movie-tv/nartodrama/genre/action",
  "/movie-tv/nartodrama/providers",
]) {
  const { status, body } = await get(p);
  const n = body?.results?.length ?? (body?.endpoints ? "overview" : 0);
  check(status === 200 && (n === "overview" || n > 0), p, `${status} · ${n}`);
}

console.log("\n--- stream resolution FROM THE VPS (France) ---");
const slugs = ((await get("/movie-tv/nartodrama/home")).body?.results ?? [])
  .slice(0, 5)
  .map((r: any) => r.id);

for (const slug of slugs) {
  const { status, body } = await get(`/movie-tv/nartodrama/watch/${slug}/1`);
  const src = body?.sources?.[0];
  if (status !== 200 || !src) {
    check(false, slug, `watch ${status} — VPS could not resolve`);
    continue;
  }

  const rawUrl = decodeURIComponent(new URL(src.url).searchParams.get("url") || "");
  const cdnHost = new URL(rawUrl).hostname;

  // THE decisive check: fetch through the VPS's own proxy, so the VPS is the
  // one pulling from the CDN. This is what a real client actually hits.
  let viaVps = "n/a";
  let served = false;
  try {
    const r = await fetch(src.url, { headers: { Range: "bytes=0-2047" } });
    const text = await r.text();
    served = r.ok && (text.includes("#EXTM3U") || text.length > 200);
    viaVps = `${r.status} ${r.headers.get("content-type")?.slice(0, 30)} ${text.length}b`;
  } catch (e: any) {
    viaVps = "ERR " + e.message.slice(0, 40);
  }

  check(served, slug, `m3u8=${src.isM3U8} · via-VPS ${viaVps} · ${cdnHost}`);
}

console.log("\n--- provider chain on VPS ---");
const cat = await get("/movie-tv/nartodrama/provider/reelshort");
const item = cat.body?.sections?.flatMap((s: any) => s.items)?.[0];
check(Boolean(item), "provider/reelshort", `${cat.status} · ${cat.body?.sections?.length ?? 0} sections`);

if (item) {
  const r = await get(`/movie-tv/nartodrama/resolve/reelshort/${item.bookId}`);
  check(Boolean(r.body?.slug), "resolve reelshort item", `${r.status} -> ${r.body?.slug}`);
  if (r.body?.slug) {
    const s = await get(`/movie-tv/nartodrama/watch/${r.body.slug}/1`);
    check(Boolean(s.body?.sources?.length), "stream resolved title", `${s.status}`);
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
