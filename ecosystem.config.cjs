/**
 * pm2 definition for the production API (mugen-api, :3001 behind nginx).
 *
 * Until 2026-09-26 the app was started by hand on the VPS and pm2 kept only
 * what was typed then — including pm2's default kill_timeout of 1.6s, which
 * SIGKILLs a process long before a graceful drain can finish. Keeping the
 * definition in the repo is what makes the drain in src/index.ts reachable.
 *
 * ── Script choice ───────────────────────────────────────────────────────
 * `script` is the bun BINARY with `args: "run src/index.ts"` and
 * `interpreter: "none"` — exactly the command the hand-started app has been
 * running in production (`/root/.bun/bin/bun run src/index.ts`, fork mode),
 * so adoption changes pm2's timings and nothing about how Bun is launched.
 * It also keeps pm2's pid equal to the Bun process's pid (bun runs a .ts
 * file in-process), which scripts/deploy/handover.sh compares against
 * /health's `pid` (it also accepts a direct child, in case that ever
 * changes). The alternative, `script: "src/index.ts"` with bun as the
 * interpreter, routes the launch through pm2's own Bun container — a path
 * this app has never run under, so it was not taken. `interpreter: "none"`
 * stops pm2 guessing node for an extensionless file.
 *
 * ── Env ─────────────────────────────────────────────────────────────────
 * Bun loads `.env` from the cwd by itself, so every secret stays in the
 * VPS's untracked .env — none belong in this file. Only PORT is pinned here,
 * because nginx and the bridge in handover.sh both assume 3001 (process env
 * wins over .env under Bun). The route prefix BASE_PATH must stay unset on
 * this box: handover.sh polls http://127.0.0.1:3001/health unprefixed.
 *
 * ── Timings ─────────────────────────────────────────────────────────────
 * kill_timeout 130s = the 125s drain ceiling (src/core/shutdown.ts) + 3s
 * to close Chrome + margin, so pm2 only SIGKILLs a process that ignored its
 * own deadline.
 *
 * kill_signal SIGTERM, not pm2's default SIGINT: chrome-launcher (inside
 * puppeteer-real-browser) registers a SIGINT listener that calls
 * process.exit(130) at once, which cut the drain short as soon as a
 * CF-bypass or vidcore/vidfast request had launched Chrome (review,
 * 2026-09-26). src/core/lib/browser.ts disables that listener too; SIGTERM
 * keeps any other library's Ctrl-C handler out of the deploy path. No
 * runtime dependency exits on SIGTERM (grep of node_modules, 2026-09-26:
 * only tsx/vite/vitest/ts-node/srvx CLIs register one; signal-exit re-kills
 * only when it is the sole listener, and src/index.ts is always another).
 *
 * treekill false: pm2's default signals every descendant of the Bun pid at
 * once — including those persistent Chromes, which then die under the very
 * stream/CF requests the drain is waiting on. Bun closes them itself after
 * the drain (closeAllBrowsers). The cost: if Bun ever has to be SIGKILLed at
 * 130s, its Chrome (spawned detached) is orphaned until killed by hand.
 *
 * ── One-time adoption on the VPS (once, by hand, as root) ──────────────
 * The running mugen-api predates this file, and `pm2 restart` does not
 * re-read a config, so the app has to be deleted and started from it. A bare
 * delete + start leaves nothing listening while Bun boots, so it goes
 * through handover.sh's bridge like any deploy:
 *
 *   cd /www/wwwroot/api.mugenstream.fun
 *   git pull --ff-only origin main
 *   ADOPT=1 bash scripts/deploy/handover.sh
 *   pm2 describe mugen-api | grep -E 'exec cwd|script path|kill_timeout'
 *
 * (ADOPT=1 = pm2 delete mugen-api && pm2 start ecosystem.config.cjs &&
 * pm2 save in place of the restart. `pm2 save` is what makes a reboot
 * resurrect this definition rather than the old one.) Typing the bridge
 * steps by hand is NOT equivalent: in an interactive shell `setsid cmd &`
 * forks, so `$!` is not the bridge's pid.
 *
 * Before adoption the old definition's ~1.6s kill_timeout still applies, so
 * a deploy is covered by the bridge (no refused connections) but the old
 * process is SIGKILLed before it finishes draining.
 */
module.exports = {
  apps: [
    {
      name: "mugen-api",
      script: "/root/.bun/bin/bun",
      args: "run src/index.ts",
      interpreter: "none",
      cwd: "/www/wwwroot/api.mugenstream.fun",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      kill_timeout: 130000,
      kill_signal: "SIGTERM",
      treekill: false,
      env: {
        PORT: "3001",
      },
    },
  ],
};
