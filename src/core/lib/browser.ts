import { connect } from "puppeteer-real-browser";

/**
 * The only door to puppeteer-real-browser in src/ (browser.test.ts fails if
 * another file imports it directly).
 *
 * Why (review of the zero-downtime deploy, 2026-09-26): connect() hands its
 * options to chrome-launcher's launch(), whose `handleSIGINT` defaults to
 * true. That registers a process-wide SIGINT listener doing
 * `killAll(); process.exit(130)` synchronously — so once a CF-bypass or
 * vidcore/vidfast request had booted the persistent Chrome, the SIGINT from
 * pm2 or handover.sh hit that listener in the same tick as src/index.ts's
 * drain handler and exited mid-drain, cutting every in-flight request (the
 * "fetch failed" this change exists to remove). So the listener is switched
 * off here and Chrome's lifetime belongs to src/core/shutdown.ts instead,
 * which calls closeAllBrowsers() after the drain.
 *
 * browser.close() is enough to clean up: puppeteer-real-browser's
 * pageController listens for 'disconnected' and runs chrome.kill() and
 * xvfbsession.stopSync(). That matters because chrome-launcher spawns
 * Chrome with `detached: true` on Linux — nothing else reaps it once Bun
 * exits (pm2's treekill is off in ecosystem.config.cjs so it cannot kill
 * Chrome under a request that is still draining).
 */
type ConnectOptions = Parameters<typeof connect>[0];
type ConnectResult = Awaited<ReturnType<typeof connect>>;
type Browser = ConnectResult["browser"];

const open = new Set<Browser>();

export async function launchBrowser(opts: ConnectOptions): Promise<ConnectResult> {
  const result = await connect({
    ...opts,
    customConfig: { ...opts.customConfig, handleSIGINT: false },
  });
  open.add(result.browser);
  result.browser.once("disconnected", () => open.delete(result.browser));
  return result;
}

export function openBrowserCount(): number {
  return open.size;
}

/**
 * Close every browser launchBrowser() opened. Bounded by `timeoutMs`
 * because a wedged Chrome can leave close() pending forever, and the caller
 * is a shutdown that must still exit before pm2's kill_timeout.
 */
export async function closeAllBrowsers(timeoutMs = 3_000): Promise<void> {
  if (open.size === 0) return;
  const all = Promise.allSettled([...open].map((b) => b.close()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([all, ceiling]);
  clearTimeout(timer);
  open.clear();
}
