import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache } from "../../../core/cache.js";
import { NartoDrama } from "./nartodrama.js";
import { nartoDramaRoutes } from "./route.js";

// The route is where "could not find out" used to become "does not exist": every
// miss was a 404, cached for 20s, and the app's retry a second later was always
// served that cached miss. These pin that a busy answer is a 503 the player can
// wait on, and that it is never stored.
const watch = (slug: string) =>
  nartoDramaRoutes.handle(new Request(`http://localhost/nartodrama/watch/${slug}/1`));

afterEach(() => vi.restoreAllMocks());

describe("GET /watch/:slug/:episode", () => {
  it("answers busy with 503, Retry-After and retryable — and caches nothing", async () => {
    const set = vi.spyOn(Cache, "set");
    vi.spyOn(NartoDrama, "watchResult").mockResolvedValue({
      kind: "busy",
      reason: "rate-limited",
      retryAfterSec: 20,
    });

    const res = await watch("route-test-busy");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("20");
    expect(await res.json()).toMatchObject({ retryable: true, reason: "rate-limited" });
    expect(set).not.toHaveBeenCalled();
  });

  it("answers gone with 404, as before", async () => {
    vi.spyOn(Cache, "set").mockResolvedValue(undefined as never);
    vi.spyOn(NartoDrama, "watchResult").mockResolvedValue({
      kind: "gone",
      reason: "upstream-refused",
    });

    const res = await watch("route-test-gone");
    expect(res.status).toBe(404);
    expect(res.headers.get("retry-after")).toBeNull();
  });
});
