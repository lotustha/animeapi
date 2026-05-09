// One-off discovery script: launches a real Chrome via puppeteer-real-browser,
// loads a hianime.ws watch page, intercepts every network request, prints the
// API/AJAX traffic so we can identify the streams/servers endpoints.
//
// Run: bun run scripts/discover_hianime_streams.ts

import { connect } from "puppeteer-real-browser";

const WATCH_URL = process.argv[2] ?? "https://hianime.ws/watch/naruto-shippuuden-5626";

const FILTER = /\/api\/v\d+\/|\/ajax\/(?!libs|user)|megacloud|rapid|streamtape|m3u8|sources?|servers?|links?\/(list|view)/i;
const SKIP = /\.(png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|eot|css)(\?|$)/i;

(async () => {
  const { browser, page } = await connect({
    headless: false,
    args: ["--no-sandbox"],
    customConfig: {},
    turnstile: true,
    connectOption: { defaultViewport: null },
  });

  const seen = new Set<string>();
  const log = (label: string, msg: string) => console.log(`[${label}] ${msg}`);

  page.on("request", (req) => {
    const url = req.url();
    if (SKIP.test(url)) return;
    if (!FILTER.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    log("REQ", `${req.method()} ${url}`);
  });

  page.on("response", async (res) => {
    const url = res.url();
    if (SKIP.test(url)) return;
    if (!FILTER.test(url)) return;
    const status = res.status();
    let bodyPreview = "";
    try {
      const ct = res.headers()["content-type"] ?? "";
      if (ct.includes("json") || ct.includes("html") || ct.includes("text")) {
        const text = await res.text();
        bodyPreview = text.slice(0, 300).replace(/\s+/g, " ");
      }
    } catch {
      /* res body unavailable */
    }
    log("RES", `${status} ${url}\n      ${bodyPreview}`);
  });

  log("NAV", WATCH_URL);
  await page.goto(WATCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Give the JS time to fire its server/source AJAX after page load + autoplay,
  // and try clicking the first server item to trigger source fetch.
  await new Promise((r) => setTimeout(r, 8000));

  try {
    // Best-effort click to force the streams ajax if autoplay didn't fire it.
    await page.evaluate(() => {
      const candidates = document.querySelectorAll<HTMLElement>(
        ".servers-content .item, .server-item, .ps__-list .ps-item, [data-type='sub'], [data-server-id]",
      );
      candidates[0]?.click();
    });
  } catch (err) {
    log("CLICK", `failed: ${String(err)}`);
  }

  await new Promise((r) => setTimeout(r, 8000));

  log("DONE", `captured ${seen.size} unique URLs. Closing browser in 5s.`);
  await new Promise((r) => setTimeout(r, 5000));
  await browser.close();
  process.exit(0);
})().catch((err) => {
  console.error("script error:", err);
  process.exit(1);
});
