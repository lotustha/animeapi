import { execFileSync } from "node:child_process";
import { Elysia } from "elysia";
import { snapshot } from "./counters.js";

/**
 * GET /health — which process answered, and what code it runs.
 *
 * Exists for scripts/deploy/handover.sh. A deploy briefly runs TWO processes
 * on :3001 (a short-lived "bridge" plus pm2's mugen-api, both bound with
 * SO_REUSEPORT), and the kernel spreads new connections between them. The
 * script cannot tell who is serving from a status code, so it polls this
 * route until the `pid` it names is the one it expects: first the bridge
 * (safe to restart pm2), then pm2's new process (safe to drop the bridge).
 *
 * Before this, every deploy was a bare `pm2 restart`: Bun exited on the
 * signal with requests in flight, nothing listened until the new process
 * booted, and nginx logged 50–191 "connect() failed (111)" per deploy
 * (measured 2026-09-26).
 *
 * Deliberately a plain route with no cache, auth or rate limit: a cached
 * answer would report a pid that is already gone. Kept in its own plugin so
 * the test can mount it without pulling in every provider (puppeteer,
 * firebase-admin).
 *
 * `counters` (src/core/counters.ts) rides along: event counts since this pid
 * booted — alternate sites serving a gone episode, forced refreshes that came
 * back dead, episodes with no source. Read, never reset, by this route.
 */

/** When this process loaded — lets a human see a restart actually happened. */
const bootedAt = new Date().toISOString();

/**
 * Short sha of the checkout, read ONCE at boot. The VPS runs from a git
 * checkout, so this is the commit the process was started from — which is
 * not necessarily HEAD by the time someone asks (a pull without a restart
 * is exactly the case this should expose).
 */
const commit = readCommit();

function readCommit(): string | null {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    })
      .toString()
      .trim();
    return sha || null;
  } catch {
    return null;
  }
}

export const healthRoutes = new Elysia({ name: "health" }).get(
  "/health",
  ({ set }) => {
    set.headers["cache-control"] = "no-store";
    return { ok: true, pid: process.pid, bootedAt, commit, counters: snapshot() };
  },
  {
    detail: {
      tags: ["core"],
      summary: "Liveness, with the answering process id (used by deploys)",
    },
  },
);
