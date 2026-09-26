import { createApp } from "./app.js";
import { validateConfig } from "./core/config.js";
import { closeStore } from "./providers/movie-tv/nartodrama/store.js";
import { createShutdown, DRAIN_CEILING_MS } from "./core/shutdown.js";
import { closeAllBrowsers } from "./core/lib/browser.js";

validateConfig();

const app = await createApp();

// Always listen — cPanel/LiteSpeed requires the process to bind a port.
// The previous serverless-style conditional (only listen outside production)
// caused 503 errors on cPanel because the app never bound to the port.
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
});

/**
 * Graceful stop on SIGINT (what pm2 6 always sends — it ignores a per-app
 * kill_signal, see ecosystem.config.cjs — and Ctrl-C) and SIGTERM
 * (handover.sh / `timeout` for the bridge).
 *
 * Without a handler Bun exits the instant pm2 signals it: every in-flight
 * request dies with it (discover/stream-check jobs saw "fetch failed"), and
 * each deploy logged 50–191 nginx "connect() failed (111)" (measured
 * 2026-09-26). Now the process stops accepting and lets what it already took
 * finish, while the deploy's bridge process (scripts/deploy/handover.sh),
 * bound to the same port through the Bun adapter's default reusePort, takes
 * every new connection.
 *
 * app.stop(false) is Elysia 1.4's wrapper around Bun's server.stop(false):
 * the listening socket closes at once and the promise resolves when the last
 * in-flight request has been answered. Measured locally on Bun 1.3.11, now
 * kept as scripts/tests/graceful-drain.bun.ts (which drives createShutdown
 * against a real listener): a slow request started before stop() completed
 * normally, a fresh connection after stop() was refused, and an idle
 * keep-alive socket did NOT hold the drain open.
 *
 * SIGINT is safe only because src/core/lib/browser.ts turns off
 * chrome-launcher's own SIGINT listener (under puppeteer-real-browser), which
 * ran process.exit(130) in the same tick as this handler and killed the drain
 * as soon as a CF-bypass or vidcore/vidfast request had booted Chrome. pm2
 * sends SIGINT regardless of config, so that switch is what the drain rests
 * on; handover.sh still uses SIGTERM for the bridge. Step order,
 * the 125s ceiling and the Chrome cleanup live in src/core/shutdown.ts.
 */
const shutdown = createShutdown({
  stop: () => app.stop(false),
  closeBrowsers: closeAllBrowsers,
  closeStore,
  exit: (code) => process.exit(code),
  ceilingMs: DRAIN_CEILING_MS,
});

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

export default app;
