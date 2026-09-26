/**
 * Graceful-drain check for src/core/shutdown.ts on a REAL Elysia/Bun
 * listener. Run with: bun run scripts/tests/graceful-drain.bun.ts
 *
 * Not a vitest file on purpose: vitest runs under node here, and
 * app.listen / server.stop(false) need Bun. (Name kept off the vitest
 * include patterns: *.test.ts under src/, *.vitest.test.ts here.)
 *
 * Part 1 (every platform): a 1.5s request is in flight, shutdown() runs, and
 *   - a fresh connection is refused,
 *   - the in-flight request still completes with 200,
 *   - exit(0) is called only after it did.
 * Part 2 (Linux/macOS only): the same through a real OS SIGTERM sent to a
 *   child Bun process, with a chrome-launcher-style SIGINT listener
 *   registered to show the deploy signal no longer reaches it. Windows has
 *   no POSIX signal delivery to a child (Bun's kill() terminates it), so
 *   part 2 is skipped there and says so — review of 2026-09-26.
 */
import { Elysia } from "elysia";
import { createShutdown } from "../../src/core/shutdown.js";

const SLOW_MS = 1_500;

function slowApp() {
  return new Elysia({ serve: { idleTimeout: 120 } })
    .get("/slow", async () => {
      await Bun.sleep(SLOW_MS);
      return "slow-done";
    })
    .get("/ping", () => "pong");
}

async function refused(url: string): Promise<boolean> {
  try {
    await fetch(url, { keepalive: false, signal: AbortSignal.timeout(1_000) });
    return false;
  } catch {
    return true;
  }
}

function assert(ok: boolean, msg: string) {
  if (!ok) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`ok   ${msg}`);
}

// ── child mode: real listener + real signal handlers ─────────────────────
if (process.argv[2] === "--child") {
  const port = Number(process.argv[3]);
  const app = slowApp().listen(port);
  // What chrome-launcher does with handleSIGINT left on (see
  // src/core/lib/browser.ts): if the deploy signal reached this, exit 130.
  process.on("SIGINT", () => process.exit(130));
  const shutdown = createShutdown({
    stop: () => app.stop(false),
    closeBrowsers: async () => {},
    closeStore: () => {},
    exit: (c) => process.exit(c),
    ceilingMs: 10_000,
  });
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  console.log("ready");
  await new Promise(() => {});
}

// ── part 1: in-process ────────────────────────────────────────────────────
{
  const port = 39_000 + Math.floor(Math.random() * 1_000);
  const app = slowApp().listen(port);
  const base = `http://127.0.0.1:${port}`;
  assert((await (await fetch(`${base}/ping`)).text()) === "pong", "listener up");

  let exitedAt = 0;
  let exitCode = -1;
  const shutdown = createShutdown({
    stop: () => app.stop(false),
    closeBrowsers: async () => {},
    closeStore: () => {},
    exit: (c) => {
      exitCode = c;
      exitedAt = Date.now();
    },
    log: () => {},
    ceilingMs: 10_000,
  });

  const slowStartedAt = Date.now();
  const slow = fetch(`${base}/slow`).then(async (r) => ({ status: r.status, body: await r.text() }));
  await Bun.sleep(200);
  const draining = shutdown("SIGTERM");
  await Bun.sleep(100);
  assert(await refused(`${base}/ping`), "new connection refused while draining");

  const res = await slow;
  await draining;
  assert(res.status === 200 && res.body === "slow-done", "in-flight request completed with 200");
  // Server-side bound, not the client's body-read time (which can trail exit by a ms):
  // an exit before the handler's SLOW_MS sleep ended would be < SLOW_MS - 50.
  assert(exitCode === 0 && exitedAt - slowStartedAt >= SLOW_MS - 50, "exit(0) only after the in-flight request finished");
}

// ── part 2: real OS signal to a child ────────────────────────────────────
if (process.platform === "win32") {
  console.log("skip part 2: no POSIX signal delivery to a child process on Windows");
} else {
  const port = 40_000 + Math.floor(Math.random() * 1_000);
  const child = Bun.spawn(["bun", "run", import.meta.path, "--child", String(port)], { stdout: "pipe", stderr: "inherit" });
  const reader = child.stdout.getReader();
  const dec = new TextDecoder();
  let seen = "";
  while (!seen.includes("ready")) {
    const { done, value } = await reader.read();
    if (done) assert(false, `child exited before listening (code ${await child.exited})`);
    seen += dec.decode(value, { stream: true }); // "ready" may span two chunks
  }
  const base = `http://127.0.0.1:${port}`;

  const slow = fetch(`${base}/slow`).then(async (r) => ({ status: r.status, body: await r.text() }));
  await Bun.sleep(200);
  child.kill("SIGTERM");
  await Bun.sleep(100);
  assert(await refused(`${base}/ping`), "child: new connection refused after SIGTERM");
  const res = await slow;
  assert(res.status === 200 && res.body === "slow-done", "child: in-flight request completed with 200");
  assert((await child.exited) === 0, "child: exited 0 (not 130 from a SIGINT-style listener)");
}

console.log("graceful drain: all checks passed");
process.exit(0);
