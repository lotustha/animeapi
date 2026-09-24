/**
 * Who gets narto's attention when it is rationing it: viewers first.
 *
 * narto rate-limits this server. On 2026-09-24, with discover and the
 * stream-check sweep running, 73% of viewers' stream lookups came back busy;
 * with no job running there were none. The jobs were competing with the very
 * people the jobs exist for.
 *
 * So background callers name themselves (`x-mugen-caller: discover`, ...) and
 * are admitted only:
 *  - when narto has not said "busy" in the last [quietAfterBusyMs], and
 *  - within [backgroundPerMinute] calls in any sliding minute.
 * A refused caller gets 503 + Retry-After and is expected to wait. Viewers are
 * never refused here; narto itself may still refuse them, and that is what
 * trips the quiet period for everybody else.
 *
 * Per process, in memory: the scraper runs as one process.
 */
export type Lane = "viewer" | "background";
export type Admission = { ok: true } | { ok: false; retryAfterSec: number };

export class NartoBudget {
  private lastBusyAt = -Infinity;
  private recent: number[] = [];

  constructor(
    private readonly opts: { backgroundPerMinute: number; quietAfterBusyMs: number },
  ) {}

  /** narto answered busy (429) to anyone. */
  noteBusy(now = Date.now()) {
    this.lastBusyAt = now;
  }

  admit(lane: Lane, now = Date.now()): Admission {
    if (lane === "viewer") return { ok: true };

    const quietUntil = this.lastBusyAt + this.opts.quietAfterBusyMs;
    if (now < quietUntil) {
      return { ok: false, retryAfterSec: Math.ceil((quietUntil - now) / 1000) };
    }

    const windowStart = now - 60_000;
    this.recent = this.recent.filter((t) => t > windowStart);
    if (this.recent.length >= this.opts.backgroundPerMinute) {
      const frees = this.recent[0] + 60_000;
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((frees - now) / 1000)) };
    }
    this.recent.push(now);
    return { ok: true };
  }
}

/** Any named caller other than "viewer" is background work. */
export function callerLane(header: string | null | undefined): Lane {
  const name = String(header ?? "").trim().toLowerCase();
  return name === "" || name === "viewer" ? "viewer" : "background";
}

/** The scraper's one budget. Tunable without a code change. */
export const nartoBudget = new NartoBudget({
  backgroundPerMinute: Number(process.env.NARTO_BACKGROUND_PER_MINUTE ?? 20),
  quietAfterBusyMs: Number(process.env.NARTO_QUIET_AFTER_BUSY_MS ?? 60_000),
});
