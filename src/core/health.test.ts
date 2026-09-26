import { Elysia } from "elysia";
import { describe, expect, it } from "vitest";
import { inc, snapshot } from "./counters.js";
import { healthRoutes } from "./health.js";

// scripts/deploy/handover.sh greps `"pid":<n>` out of this answer to tell the
// bridge and pm2's process apart — the shape is a contract with that script.
describe("GET /health", () => {
  const app = new Elysia().use(healthRoutes);

  it("names the answering process and is never cacheable", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pid).toBe(process.pid);
    expect(new Date(body.bootedAt).toISOString()).toBe(body.bootedAt);
    expect(body.commit === null || /^[0-9a-f]{4,40}$/.test(body.commit)).toBe(true);
  });

  it("keeps the compact `\"pid\":<digits>` form the shell script matches", async () => {
    const text = await (await app.handle(new Request("http://localhost/health"))).text();
    expect(text).toContain(`"pid":${process.pid}`);
  });

  it("carries the in-process counters as a plain object", async () => {
    // A name no other test touches: counters live for the whole test process.
    const name = `health_test_${Math.random().toString(36).slice(2)}`;
    const before = (await (await app.handle(new Request("http://localhost/health"))).json()).counters;
    expect(before[name]).toBeUndefined();
    inc(name);
    inc(name);
    const body = await (await app.handle(new Request("http://localhost/health"))).json();
    expect(body.counters[name]).toBe(2);
    expect(snapshot()[name]).toBe(2);
  });

  it("reports the same boot time on every call", async () => {
    const a = await (await app.handle(new Request("http://localhost/health"))).json();
    const b = await (await app.handle(new Request("http://localhost/health"))).json();
    expect(a.bootedAt).toBe(b.bootedAt);
  });
});
