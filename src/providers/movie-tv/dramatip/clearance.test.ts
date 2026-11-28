import { afterEach, describe, expect, it } from "bun:test";
import { _resetClearance, dramatipFetch, isChallenge } from "./clearance.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  _resetClearance();
});

const challenge = () =>
  new Response("<title>Just a moment...</title>", {
    status: 403,
    headers: { "cf-mitigated": "challenge", server: "cloudflare", "content-type": "text/html" },
  });

const solved = (ua = "SolverUA/1") =>
  Response.json({ status: "ok", solution: { userAgent: ua, cookies: [{ name: "cf_clearance", value: "abc" }] } });

describe("dramatip clearance", () => {
  it("tells a challenge from dramatip's own 403", () => {
    expect(isChallenge(challenge())).toBe(true);
    expect(isChallenge(new Response("forbidden", { status: 403 }))).toBe(false);
    expect(isChallenge(new Response("ok"))).toBe(false);
  });

  it("solves once, then retries with the solver's cookie and UA", async () => {
    const seen: { url: string; ua?: string | null; cookie?: string | null }[] = [];
    globalThis.fetch = (async (input: any, init: any = {}) => {
      const url = String(input);
      if (url.includes(":8191")) return solved();
      const h = new Headers(init.headers);
      seen.push({ url, ua: h.get("user-agent"), cookie: h.get("cookie") });
      return h.get("cookie") ? new Response("page") : challenge();
    }) as typeof fetch;

    const res = await dramatipFetch("https://dramatip.net/search?q=x", { headers: { Accept: "text/html" } });
    expect(await res.text()).toBe("page");
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ ua: "SolverUA/1", cookie: "cf_clearance=abc" });

    // The next request carries the clearance from the start.
    await dramatipFetch("https://dramatip.net/series");
    expect(seen).toHaveLength(3);
    expect(seen[2].cookie).toBe("cf_clearance=abc");
  });

  it("concurrent challenges share one solve", async () => {
    let solves = 0;
    globalThis.fetch = (async (input: any, init: any = {}) => {
      if (String(input).includes(":8191")) {
        solves++;
        await new Promise((r) => setTimeout(r, 20));
        return solved();
      }
      return new Headers(init.headers).get("cookie") ? new Response("page") : challenge();
    }) as typeof fetch;

    const all = await Promise.all([1, 2, 3].map(() => dramatipFetch("https://dramatip.net/x")));
    expect(all.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(solves).toBe(1);
  });

  it("a failed solve returns the challenge and is not retried at once", async () => {
    let solves = 0;
    globalThis.fetch = (async (input: any) => {
      if (String(input).includes(":8191")) {
        solves++;
        return Response.json({ status: "error", message: "timeout" });
      }
      return challenge();
    }) as typeof fetch;

    expect((await dramatipFetch("https://dramatip.net/x")).status).toBe(403);
    expect((await dramatipFetch("https://dramatip.net/x")).status).toBe(403);
    expect(solves).toBe(1);
  });
});
