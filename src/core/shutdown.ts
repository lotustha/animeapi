/**
 * Graceful stop, factored out of src/index.ts (2026-09-26 review) so the
 * once-guard, the step order and the ceiling path are unit tested
 * (shutdown.test.ts) and the real Elysia drain is exercised by
 * scripts/tests/graceful-drain.bun.ts with this same function.
 *
 * Order: stop(false) → closeBrowsers → closeStore → exit(0).
 *  - stop(false) first: the listener closes at once and the promise resolves
 *    when the last in-flight request has been answered, while the deploy's
 *    bridge (same port, reusePort) takes new connections.
 *  - browsers only after the drain: a stream/CF-bypass request that is still
 *    running needs its Chrome until it ends. See src/core/lib/browser.ts for
 *    why Chrome is not killed by the signal itself any more.
 *  - the sqlite handle last, after nothing can query it.
 *
 * The ceiling (125s in production) sits above idleTimeout 120 (src/app.ts)
 * and under pm2's kill_timeout 130 (ecosystem.config.cjs). It too closes
 * browsers — bounded at 3s, so 125 + 3 < 130 — or Chrome, spawned detached,
 * would outlive us.
 */
export interface ShutdownDeps {
  stop: () => Promise<unknown>;
  closeBrowsers: (timeoutMs: number) => Promise<void>;
  closeStore: () => void;
  exit: (code: number) => void;
  log?: (msg: string) => void;
  ceilingMs: number;
}

/** Production drain ceiling; ecosystem.test.ts ties pm2's kill_timeout to it. */
export const DRAIN_CEILING_MS = 125_000;
/** Bound on closing Chrome, on both the normal and the ceiling path. */
export const BROWSER_CLOSE_MS = 3_000;

export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  const log = deps.log ?? ((m: string) => console.log(m));
  let stopping = false;

  return async function shutdown(signal: string): Promise<void> {
    if (stopping) return; // pm2 can escalate with a second signal; drain once
    stopping = true;
    const startedAt = Date.now();
    log(`[shutdown] ${signal} pid=${process.pid}: closing listener, draining in-flight requests`);

    const ceiling = setTimeout(() => {
      log(`[shutdown] drain still open after ${deps.ceilingMs / 1000}s — exiting anyway`);
      void deps
        .closeBrowsers(BROWSER_CLOSE_MS)
        .catch(() => {})
        .finally(() => deps.exit(0));
    }, deps.ceilingMs);
    ceiling.unref?.();

    try {
      await deps.stop();
    } catch (err) {
      log(`[shutdown] server stop failed: ${String(err)}`);
    }
    try {
      await deps.closeBrowsers(BROWSER_CLOSE_MS);
    } catch (err) {
      log(`[shutdown] closing browsers failed: ${String(err)}`);
    }
    try {
      deps.closeStore();
    } catch (err) {
      log(`[shutdown] closing store failed: ${String(err)}`);
    }

    clearTimeout(ceiling);
    log(`[shutdown] drained in ${Date.now() - startedAt}ms, exiting`);
    deps.exit(0);
  };
}
