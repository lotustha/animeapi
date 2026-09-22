import { createApp } from "../src/app.js";

const app = await createApp();
const get = async (p: string) => {
  const res = await app.handle(new Request("http://localhost" + p));
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};

// 1. Provider roster
const list = await get("/movie-tv/nartodrama/providers");
console.log("providers:", list.status, list.body?.results?.length);
console.log("sample:", list.body?.results?.slice(0, 5).map((p: any) => p.key).join(", "));

// 2. Walk several providers and prove the full chain: catalogue → slug → stream
const targets = ["idrama", "reelshort", "netshort", "dramabox", "goodshort"];
let ok = 0;
let bad = 0;

for (const key of targets) {
  const cat = await get(`/movie-tv/nartodrama/provider/${key}`);
  const item = cat.body?.sections?.flatMap((s: any) => s.items)?.find((i: any) => !i.isAdult);
  if (!item) {
    console.log(`\n${key}: NO ITEMS (status ${cat.status})`);
    bad++;
    continue;
  }

  const sections = cat.body.sections.length;
  const total = cat.body.sections.reduce((n: number, s: any) => n + s.items.length, 0);

  const resolved = await get(`/movie-tv/nartodrama/resolve/${key}/${item.bookId}`);
  const slug = resolved.body?.slug;
  if (!slug) {
    console.log(`\n${key}: ${sections} sections/${total} items — RESOLVE FAILED (${resolved.status})`);
    bad++;
    continue;
  }

  const stream = await get(`/movie-tv/nartodrama/watch/${slug}/1`);
  const src = stream.body?.sources?.[0];
  let cdn = "n/a";
  if (src) {
    const raw = decodeURIComponent(new URL(src.url).searchParams.get("url") || "");
    const r = await fetch(raw).catch(() => null);
    cdn = r ? `${r.status} ${new URL(raw).hostname}` : "ERR";
  }

  const good = Boolean(src) && cdn.startsWith("2");
  good ? ok++ : bad++;
  console.log(`\n${good ? "PASS" : "FAIL"} ${key}`);
  console.log(`   ${sections} sections, ${total} items`);
  console.log(`   "${item.title.slice(0, 45)}" (book ${item.bookId}) -> ${slug}`);
  console.log(`   stream ${stream.status} · ${stream.body?.sources?.length ?? 0} src · cdn ${cdn}`);
}

console.log(`\n=== provider chain: ${ok} ok, ${bad} failed ===`);
