import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BROWSER_CLOSE_MS, DRAIN_CEILING_MS } from "./shutdown.js";

// pm2's side of the graceful stop (review of 2026-09-26). Each of these, if
// reverted, silently brings back cut requests on deploy:
//  - treekill (pm2 default true) signals the persistent Chromes along with
//    Bun, killing them under the stream/CF requests the drain waits on;
//  - SIGINT (pm2 default) is the signal chrome-launcher exits on;
//  - a kill_timeout below ceiling + browser close SIGKILLs a legitimate drain.
const root = join(__dirname, "..", "..");
const app = createRequire(import.meta.url)(join(root, "ecosystem.config.cjs")).apps[0];

describe("ecosystem.config.cjs — pm2 lets the drain finish", () => {
  it("does not tree-kill Bun's Chrome children", () => {
    expect(app.treekill).toBe(false);
  });

  it("stops with SIGTERM, and handover.sh never sends SIGINT", () => {
    expect(app.kill_signal).toBe("SIGTERM");
    const script = readFileSync(join(root, "scripts", "deploy", "handover.sh"), "utf-8");
    expect(script).not.toMatch(/kill\s+-(INT|2)\b/);
  });

  it("kill_timeout outlasts the drain ceiling plus closing Chrome", () => {
    expect(app.kill_timeout).toBeGreaterThanOrEqual(DRAIN_CEILING_MS + BROWSER_CLOSE_MS + 1_000);
  });
});
