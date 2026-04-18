import axios from "axios";
import { connect } from "puppeteer-real-browser";

const BASE_URL = "https://vidfast.net";
const SUB_URL = "https://sub.wyzie.io/search";

// --- GLOBAL PERSISTENT BROWSER STATE ---
let browserInstance: any = null;
let bypassQueue: Promise<void> = Promise.resolve();

async function getBrowser() {
  console.log("[Vidfast] Checking browser instance status...");
  if (!browserInstance || !browserInstance.isConnected()) {
    console.log("[Vidfast] Booting persistent background Chrome...");
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
    console.log("[Vidfast] Persistent Chrome is ready!");
  }
  return browserInstance;
}
// ---------------------------------------

export class VidfastParser {
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
        label: `[Wyzie] ${sub.display || sub.language}`,
        url: sub.url,
        format: sub.format || "srt",
      }));
    } catch (_err) {
      return [];
    }
  }

  private async getImdbIdViaCinemeta(tmdbId: string, type: string): Promise<string | null> {
    try {
      const cinemetaType = type === "movie" ? "movie" : "series";
      const url = `https://v3-cinemeta.strem.io/meta/${cinemetaType}/tmdb:${tmdbId}.json`;
      console.log(`[Vidfast] Converting TMDB to IMDB via Cinemeta...`);

      const { data } = await axios.get(url);
      if (data && data.meta && data.meta.imdb_id) {
        return data.meta.imdb_id;
      }
      return null;
    } catch (_e) {
      return null;
    }
  }

  private async fetchStremioSubtitles(
    imdbId: string,
    type: string,
    season?: string,
    episode?: string,
  ): Promise<any[]> {
    try {
      const url =
        type === "movie"
          ? `https://opensubtitles-v3.strem.io/subtitles/movie/${imdbId}.json`
          : `https://opensubtitles-v3.strem.io/subtitles/series/${imdbId}:${season}:${episode}.json`;

      console.log(`[Vidfast] Fetching public OpenSubtitles from Stremio...`);
      const { data } = await axios.get(url);

      if (!data || !data.subtitles || !Array.isArray(data.subtitles)) {
        return [];
      }

      console.log(`[Vidfast] Grabbed ${data.subtitles.length} free OpenSubtitles.`);

      return data.subtitles.map((sub: any) => ({
        label: `[OpenSubs] ${sub.lang || "Unknown"}`,
        url: sub.url,
        format: sub.url?.includes(".vtt") ? "vtt" : "srt",
      }));
    } catch (e: any) {
      return [];
    }
  }

  private async extractDecryptedPayload(targetUrl: string): Promise<any> {
    console.log(`\n[Vidfast] Adding request to bypass queue... (${targetUrl})`);

    let releaseLock: () => void;
    const nextInLine = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const waitForPrevious = bypassQueue;
    bypassQueue = bypassQueue.then(() => nextInLine);

    await waitForPrevious;
    console.log("[Vidfast] Queue lock acquired. Proceeding with extraction.");

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

        // LAYER 1: Muzzle Javascript Popups
        window.open = function () {
          console.log("Blocked window.open popup");
          return null;
        };
        document.addEventListener("click", (e) => {
          const target = e.target as HTMLElement;
          if (target && target.tagName === "A") {
            const a = target as HTMLAnchorElement;
            if (a.target === "_blank") a.target = "_self"; // Force links to open in the same tab instead of popping up
          }
        });
      });

      const payload = await new Promise<any>((resolve) => {
        let isResolved = false;
        let serverList: any[] = [];
        const collectedSources: any[] = [];
        let expectedServerCount = 1;

        const timeoutTimer = setTimeout(async () => {
          if (!isResolved) {
            isResolved = true;
            console.log(
              `[Vidfast] Timeout reached. Collected ${collectedSources.length}/${expectedServerCount} servers.`,
            );

            if (collectedSources.length > 0) {
              resolve({ success: true, sources: collectedSources });
            } else {
              resolve({ error: "Failed to catch any streams in time.", fallbackData: serverList });
            }
          }
        }, 30000);

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
                  `[Vidfast] Intercepted Server List: ${expectedServerCount} servers available.`,
                );
              }
            } catch (_e) {}
          }
        });

        page.on("request", async (request: any) => {
          if (isResolved) return;
          const reqUrl = request.url();

          if (reqUrl.includes(".m3u8") && !collectedSources.some((s) => s.originalUrl === reqUrl)) {
            const serverName =
              serverList[collectedSources.length]?.name || `Server ${collectedSources.length + 1}`;
            console.log(`[Vidfast] => BINGO! Caught decrypted stream for: ${serverName}`);

            const targetHeaders = { referer: "https://vidfast.net/" };
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
                `[Vidfast] Successfully extracted all ${collectedSources.length} servers!`,
              );
              resolve({ success: true, sources: collectedSources });
            }
          }
        });

        console.log(`[Vidfast] Navigating to page...`);
        page.goto(targetUrl, { waitUntil: "domcontentloaded" }).catch(() => {});

        console.log("[Vidfast] Starting Stateful Auto-Clicker...");
        const clickInterval = setInterval(async () => {
          if (isResolved || page.isClosed()) {
            clearInterval(clickInterval);
            return;
          }
          try {
            // LAYER 2: The Tab Assassin
            // Scans all open pages in the browser. If it finds one that isn't our primary worker tab
            // and isn't the background blank page, it kills it instantly.
            const allPages = await browser.pages();
            for (const p of allPages) {
              if (p !== page && p.url() !== "about:blank") {
                console.log(`[Vidfast] 🔪 Assassinated stray popup tab: ${p.url()}`);
                await p.close().catch(() => {});
              }
            }

            await page.mouse.click(640, 360).catch(() => {});

            await page
              .evaluate((servers) => {
                const w = window as any;
                w.__clickState = w.__clickState || { serverIdx: 0 };

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
              }, serverList)
              .catch(() => {});
          } catch (_e) {}
        }, 1500);
      });

      return payload;
    } catch (error: any) {
      console.log(`[Vidfast] Error during extraction: ${error.message}`);
      return { error: `Extraction failed: ${error.message}` };
    } finally {
      if (page && !page.isClosed()) {
        await page.close().catch(() => {});
      }
      console.log("[Vidfast] Releasing queue lock for next request.\n");
      releaseLock!();
    }
  }

  private formatFinalResponse(
    tmdbId: string,
    type: string,
    payload: any,
    allSubtitles: any[],
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
          providerName: "vidfast",
          subtitles: allSubtitles,
          sources: payload.fallbackData,
          isEncrypted: true,
          note: "Layer 2 Encryption Active. Returning encrypted hashes as fallback.",
        };
      }
      return { error: payload.error };
    }

    const uniqueSubsMap = new Map();
    allSubtitles.forEach((s) => {
      uniqueSubsMap.set(s.url, s);
    });

    const cleanedSources = payload.sources.map((s: any) => {
      const { originalUrl: _originalUrl, ...rest } = s;
      return rest;
    });

    const finalData = {
      type,
      tmdbId,
      season,
      episode,
      providerName: "vidfast",
      subtitles: Array.from(uniqueSubsMap.values()),
      sources: cleanedSources,
      isEncrypted: false,
    };

    console.log("[Vidfast] >>> FINAL DATA EXTRACTED <<<");
    return finalData;
  }

  async fetchMovie(tmdbId: string): Promise<any> {
    try {
      const wyziePromise = this.fetchWyzieSubtitles(tmdbId);
      const openSubsPromise = this.getImdbIdViaCinemeta(tmdbId, "movie").then((imdbId) => {
        if (imdbId) return this.fetchStremioSubtitles(imdbId, "movie");
        return [];
      });

      const [wyzieSubs, openSubs] = await Promise.all([wyziePromise, openSubsPromise]);
      const combinedSubs = [...wyzieSubs, ...openSubs];

      const targetUrl = `${BASE_URL}/movie/${tmdbId}`;
      const payload = await this.extractDecryptedPayload(targetUrl);

      return this.formatFinalResponse(tmdbId, "movie", payload, combinedSubs);
    } catch (err: any) {
      return { error: `[Vidfast API Error] ${err.message}` };
    }
  }

  async fetchTv(tmdbId: string, season: string, episode: string): Promise<any> {
    try {
      const wyziePromise = this.fetchWyzieSubtitles(tmdbId);
      const openSubsPromise = this.getImdbIdViaCinemeta(tmdbId, "tv").then((imdbId) => {
        if (imdbId) return this.fetchStremioSubtitles(imdbId, "tv", season, episode);
        return [];
      });

      const [wyzieSubs, openSubs] = await Promise.all([wyziePromise, openSubsPromise]);
      const combinedSubs = [...wyzieSubs, ...openSubs];

      const targetUrl = `${BASE_URL}/tv/${tmdbId}/${season}/${episode}`;
      const payload = await this.extractDecryptedPayload(targetUrl);

      return this.formatFinalResponse(tmdbId, "tv", payload, combinedSubs, season, episode);
    } catch (err: any) {
      return { error: `[Vidfast API Error] ${err.message}` };
    }
  }
}

export const vidfast = new VidfastParser();
