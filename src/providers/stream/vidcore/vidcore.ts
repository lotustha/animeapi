import axios from "axios";
import { connect } from "puppeteer-real-browser";

const BASE_URL = "https://vidcore.net";
const SUB_URL = "https://sub.wyzie.io/search";

// --- GLOBAL PERSISTENT BROWSER STATE ---
let browserInstance: any = null;
let bypassQueue: Promise<void> = Promise.resolve();

async function getBrowser() {
  console.log("[Vidcore] Checking browser instance status...");
  if (!browserInstance || !browserInstance.isConnected()) {
    console.log("[Vidcore] Booting persistent background Chrome...");
    if (browserInstance) await browserInstance.close().catch(() => {});

    const { browser, page } = await connect({
      headless: false,
      turnstile: true,
      disableXvfb: false,
      ignoreAllFlags: false,
      args: [
        "--disable-notifications",
        "--mute-audio",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--window-size=1280,720",
        "--window-position=-32000,-32000",
        "--hide-scrollbars",
        "--disable-blink-features=AutomationControlled",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=PictureInPicture,MediaSessionService,DocumentPictureInPictureAPI",
      ],
    });

    browserInstance = browser;
    await page.goto("about:blank").catch(() => {});
    console.log("[Vidcore] Persistent Chrome is ready!");
  }
  return browserInstance;
}
// ---------------------------------------

export class VidcoreParser {
  private async fetchWyzieSubtitles(tmdbId: string): Promise<any[]> {
    try {
      const { data } = await axios.get(`${SUB_URL}?id=${tmdbId}`, {
        headers: {
          Origin: "null",
          Referer: `${BASE_URL}/`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        },
      });

      if (data?.code === 400 || !Array.isArray(data)) return [];

      return data.map((sub: any) => ({
        label: sub.display || sub.language,
        url: sub.url,
        format: sub.format || "srt",
      }));
    } catch (_err) {
      return [];
    }
  }

  private async extractDecryptedPayload(targetUrl: string): Promise<any> {
    console.log(`\n[Vidcore] Adding request to bypass queue... (${targetUrl})`);

    let releaseLock: () => void;
    const nextInLine = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const waitForPrevious = bypassQueue;
    bypassQueue = bypassQueue.then(() => nextInLine);

    await waitForPrevious;
    console.log("[Vidcore] Queue lock acquired. Proceeding with extraction.");

    let page: any = null;

    try {
      const browser = await getBrowser();
      page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(HTMLVideoElement.prototype, "disablePictureInPicture", {
          get: () => true,
          set: () => {},
        });
        HTMLVideoElement.prototype.requestPictureInPicture = async () => {
          throw new Error("PiP disabled");
        };
        window.console.clear = () => {};

        // SMART WIRETAP: Intercept JSON and regex any hidden .vtt/.srt files
        (window as any).__interceptedTracks = [];
        const originalParse = JSON.parse;
        JSON.parse = function (...args) {
          const parsed = originalParse.apply(this, args);
          try {
            if (parsed && typeof parsed === "object") {
              const str = JSON.stringify(parsed);
              if (str.includes(".vtt") || str.includes(".srt")) {
                const urls = str.match(/https?:\/\/[^"']*\.(?:vtt|srt)/gi);
                if (urls) {
                  urls.forEach((u) =>
                    (window as any).__interceptedTracks.push({ file: u, label: "Extracted Sub" }),
                  );
                }
              }
            }
          } catch (_e) {}
          return parsed;
        };
      });

      const payload = await new Promise<any>((resolve) => {
        let isResolved = false;
        let serverList: any[] = [];
        const collectedSources: any[] = [];
        const networkSubs: any[] = [];
        let expectedServerCount = 1;

        const timeoutTimer = setTimeout(async () => {
          if (!isResolved) {
            isResolved = true;
            console.log(
              `[Vidcore] Timeout reached. Collected ${collectedSources.length}/${expectedServerCount} servers.`,
            );

            const hookedTracks = await page
              .evaluate(() => (window as any).__interceptedTracks || [])
              .catch(() => []);
            const domTracks = await page
              .evaluate(() => {
                return Array.from(document.querySelectorAll("track"))
                  .filter((t: any) => t.src)
                  .map((t: any) => ({
                    label: t.label || t.srclang || "Unknown",
                    file: t.src,
                  }));
              })
              .catch(() => []);

            const allTracks = [...hookedTracks, ...domTracks, ...networkSubs];

            if (collectedSources.length > 0) {
              resolve({ success: true, sources: collectedSources, tracks: allTracks });
            } else {
              resolve({ error: "Failed to catch any streams in time.", fallbackData: serverList });
            }
          }
        }, 30000); // 30 seconds gives enough time to sequentially click all servers

        page.on("response", async (response: any) => {
          if (isResolved) return;
          const reqUrl = response.url();

          if (reqUrl.includes("/sab/") && reqUrl.includes("/re/")) {
            try {
              const json = await response.json();
              if (Array.isArray(json) && json.length > 0 && json[0].data) {
                serverList = json;
                expectedServerCount = serverList.length;
                console.log(
                  `[Vidcore] Intercepted Server List: ${expectedServerCount} servers available.`,
                );
              }
            } catch (_e) {}
          }

          // Catch .vtt files returning directly via network
          if (
            (reqUrl.includes(".vtt") || reqUrl.includes(".srt")) &&
            !networkSubs.some((s) => s.file === reqUrl)
          ) {
            console.log(
              `[Vidcore] => BINGO! Caught native network subtitle: ${reqUrl.split("/").pop()}`,
            );
            networkSubs.push({ label: "Native Sub", file: reqUrl });
          }
        });

        page.on("request", async (request: any) => {
          if (isResolved) return;
          const reqUrl = request.url();

          if (reqUrl.includes(".m3u8") && !collectedSources.some((s) => s.originalUrl === reqUrl)) {
            const serverName =
              serverList[collectedSources.length]?.name || `Server ${collectedSources.length + 1}`;
            console.log(`[Vidcore] => BINGO! Caught decrypted stream for: ${serverName}`);

            const targetHeaders = { referer: "https://vidcore.net/" };
            const encodedUrl = encodeURIComponent(reqUrl);
            const encodedHeaders = encodeURIComponent(JSON.stringify(targetHeaders));

            const proxiedUrl = `/proxy/m3u8-proxy?url=${encodedUrl}&headers=${encodedHeaders}`;

            collectedSources.push({
              type: "hls",
              url: proxiedUrl,
              originalUrl: reqUrl,
              quality: "auto",
              server: serverName,
            });

            if (serverList.length > 0 && collectedSources.length >= expectedServerCount) {
              isResolved = true;
              clearTimeout(timeoutTimer);

              const hookedTracks = await page
                .evaluate(() => (window as any).__interceptedTracks || [])
                .catch(() => []);
              const domTracks = await page
                .evaluate(() => {
                  return Array.from(document.querySelectorAll("track"))
                    .filter((t: any) => t.src)
                    .map((t: any) => ({
                      label: t.label || t.srclang || "Unknown",
                      file: t.src,
                    }));
                })
                .catch(() => []);

              const allTracks = [...hookedTracks, ...domTracks, ...networkSubs];

              await page
                .evaluate(() => {
                  document.querySelectorAll("video").forEach((v) => {
                    v.pause();
                    v.removeAttribute("src");
                    v.load();
                  });
                })
                .catch(() => {});

              console.log(
                `[Vidcore] Successfully extracted all ${collectedSources.length} servers & subtitles!`,
              );
              resolve({ success: true, sources: collectedSources, tracks: allTracks });
            }
          }
        });

        console.log(`[Vidcore] Navigating to page...`);
        page.goto(targetUrl, { waitUntil: "domcontentloaded" }).catch(() => {});

        console.log("[Vidcore] Starting Stateful Auto-Clicker...");
        const clickInterval = setInterval(async () => {
          if (isResolved || page.isClosed()) {
            clearInterval(clickInterval);
            return;
          }
          try {
            await page.mouse.click(640, 360).catch(() => {}); // Wake player

            await page
              .evaluate((servers) => {
                // Initialize state trackers in the browser
                const w = window as any;
                w.__clickState = w.__clickState || {
                  serverIdx: 0,
                  ccClicked: false,
                  subClicked: false,
                };

                // 1. STATEFUL SERVER CLICKER (Clicks one server per interval)
                const names = servers.map((s: any) => s.name);
                const dropdownItems = Array.from(document.querySelectorAll(".mui-1upze98 > *"));

                if (dropdownItems.length > 0) {
                  const targetBtn = dropdownItems[
                    w.__clickState.serverIdx % dropdownItems.length
                  ] as HTMLElement;
                  if (targetBtn) {
                    targetBtn.click();
                    w.__clickState.serverIdx++;
                  }
                } else {
                  const walker = document.createTreeWalker(
                    document.body,
                    NodeFilter.SHOW_TEXT,
                    null,
                  );
                  let n;
                  const foundNodes: HTMLElement[] = [];
                  while ((n = walker.nextNode())) {
                    const text = n?.nodeValue?.trim();
                    if (text && names.includes(text) && n.parentElement) {
                      foundNodes.push(n.parentElement);
                    }
                  }
                  if (foundNodes.length > 0) {
                    const targetBtn = foundNodes[w.__clickState.serverIdx % foundNodes.length];
                    if (targetBtn) {
                      targetBtn.click();
                      w.__clickState.serverIdx++;
                    }
                  }
                }

                // 2. STATEFUL SUBTITLE ENABLER (Only clicks ONCE)
                if (!w.__clickState.ccClicked) {
                  const btns = Array.from(document.querySelectorAll("button"));
                  const ccBtn = btns.find((b) => {
                    const c = (b.className || "").toLowerCase();
                    const t = (b.innerText || "").toLowerCase();
                    const a = (b.getAttribute("aria-label") || "").toLowerCase();
                    // STRICTLY AVOID the banned button class
                    return (
                      !c.includes("mui102a04j") &&
                      (t === "cc" ||
                        a.includes("subtitle") ||
                        a.includes("caption") ||
                        c.includes("subtitle"))
                    );
                  });
                  if (ccBtn) {
                    ccBtn.click();
                    w.__clickState.ccClicked = true;
                  }
                }

                if (!w.__clickState.subClicked) {
                  const options = Array.from(
                    document.querySelectorAll('li, [role="menuitem"], [role="option"]'),
                  );
                  const engOpt = options.find((el) => {
                    const text = ((el as HTMLElement).innerText || "").toLowerCase();
                    return text.includes("english") || text === "en" || text.includes("sub");
                  }) as HTMLElement;
                  if (engOpt) {
                    engOpt.click();
                    w.__clickState.subClicked = true;
                  }
                }
              }, serverList)
              .catch(() => {});
          } catch (_e) {}
        }, 1500);
      });

      return payload;
    } catch (error: any) {
      console.log(`[Vidcore] Error during extraction: ${error.message}`);
      return { error: `Extraction failed: ${error.message}` };
    } finally {
      if (page && !page.isClosed()) {
        await page.close().catch(() => {});
      }
      console.log("[Vidcore] Releasing queue lock for next request.\n");
      releaseLock!();
    }
  }

  private formatFinalResponse(
    tmdbId: string,
    type: string,
    payload: any,
    wyzieSubs: any[],
    season?: string,
    episode?: string,
  ) {
    if (payload.error) {
      if (payload.fallbackData && payload.fallbackData.length > 0) {
        return {
          type,
          tmdbId,
          season,
          episode,
          providerName: "vidcore",
          subtitles: wyzieSubs,
          sources: payload.fallbackData,
          isEncrypted: true,
          note: "Layer 2 Encryption Active. Returning encrypted hashes as fallback.",
        };
      }
      return { error: payload.error };
    }

    const uniqueSubsMap = new Map();

    wyzieSubs.forEach((s) => {
      uniqueSubsMap.set(s.url, s);
    });

    if (payload.tracks && Array.isArray(payload.tracks)) {
      console.log(`[Vidcore] Injecting ${payload.tracks.length} native/hooked tracks.`);
      payload.tracks.forEach((t: any) => {
        if (t.file && !t.file.includes(".jpg") && !t.file.includes(".png")) {
          uniqueSubsMap.set(t.file, {
            label: t.label || "Native Sub",
            url: t.file,
            format: t.file.includes(".vtt") ? "vtt" : "srt",
          });
        }
      });
    }

    const cleanedSources = payload.sources.map((s: any) => {
      const { originalUrl: _originalUrl, ...rest } = s;
      return rest;
    });

    const finalData = {
      type,
      tmdbId,
      season,
      episode,
      providerName: "vidcore",
      subtitles: Array.from(uniqueSubsMap.values()),
      sources: cleanedSources,
      isEncrypted: false,
    };

    console.log("[Vidcore] >>> FINAL DATA EXTRACTED <<<");
    return finalData;
  }

  async fetchMovie(tmdbId: string): Promise<any> {
    try {
      const subtitles = await this.fetchWyzieSubtitles(tmdbId);
      const targetUrl = `${BASE_URL}/movie/${tmdbId}`;
      const payload = await this.extractDecryptedPayload(targetUrl);
      return this.formatFinalResponse(tmdbId, "movie", payload, subtitles);
    } catch (err: any) {
      return { error: `[Vidcore API Error] ${err.message}` };
    }
  }

  async fetchTv(tmdbId: string, season: string, episode: string): Promise<any> {
    try {
      const subtitles = await this.fetchWyzieSubtitles(tmdbId);
      const targetUrl = `${BASE_URL}/tv/${tmdbId}/${season}/${episode}`;
      const payload = await this.extractDecryptedPayload(targetUrl);
      return this.formatFinalResponse(tmdbId, "tv", payload, subtitles, season, episode);
    } catch (err: any) {
      return { error: `[Vidcore API Error] ${err.message}` };
    }
  }
}

export const vidcore = new VidcoreParser();
