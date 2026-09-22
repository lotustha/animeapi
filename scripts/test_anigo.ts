import * as cheerio from "cheerio";

const BASE = "https://anigo.to";
const headers: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  Referer: `${BASE}/`,
  Cookie: "__p_mov=1; usertype=guest",
};

async function main() {
  // 1. Get the home page and find any JS files to examine TopSearch()
  const homeRes = await fetch(`${BASE}/home`, { headers });
  const homeHtml = await homeRes.text();
  const $ = cheerio.load(homeHtml);
  
  // Find all script tags with src
  console.log("=== Script sources ===");
  $("script[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    if (!src.includes("cdn") && !src.includes("cloudflare")) {
      console.log(" ", src);
    }
  });

  // 2. Try AJAX suggest endpoints anigo may have
  const ajaxHeaders = {
    ...headers,
    Accept: "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
  };

  const searchAjaxEndpoints = [
    `/suggest?keyword=one+piece`,
    `/search-suggest?keyword=one+piece`,
    `/top-search?keyword=one+piece`,
    `/ajax/top-search?keyword=one+piece`,
    `/ajax/suggest?keyword=one+piece`,
  ];

  for (const ep of searchAjaxEndpoints) {
    const res = await fetch(`${BASE}${ep}`, { headers: ajaxHeaders });
    const text = await res.text();
    if (res.status !== 502 && res.status !== 404) {
      console.log(`\n✅ ${ep} -> ${res.status}`);
      console.log(text.substring(0, 400));
    } else {
      console.log(`❌ ${ep} -> ${res.status}`);
    }
  }

  // 3. Test info page scraping for one-piece
  console.log("\n=== Testing info page ===");
  const infoRes = await fetch(`${BASE}/watch/one-piece-9zqx`, { headers });
  const infoHtml = await infoRes.text();
  const $i = cheerio.load(infoHtml);
  
  // Print x-data attributes to understand structure
  const xData = $i("[x-data]").map((_, el) => $i(el).attr("x-data")).get();
  console.log("x-data attrs:", xData.slice(0, 5));
  
  // Print inline scripts that might define data
  $i("script:not([src])").each((_, el) => {
    const code = $i(el).html() ?? "";
    if (code.includes("episode") || code.includes("anime") || code.length > 50) {
      console.log("\nScript snippet:", code.substring(0, 300));
    }
  });
}

main().catch(console.error);
