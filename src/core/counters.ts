/**
 * In-process event counters, read back through GET /health as `counters`.
 *
 * Why: the drama fallbacks (listing rung, alternate sites, forced refresh
 * handing back a dead link, no source at all) were visible only as
 * Logger.warn lines, so "how often does ReelAll actually save an episode"
 * meant grepping pm2 logs across restarts. A counter next to each of those
 * lines answers it with one curl (added 2026-09-26).
 *
 * Deliberately a leaf module with no imports: health.ts must stay mountable
 * without pulling in providers (see its header), and every provider can
 * import this without a cycle. Counts reset on restart — /health's `pid`
 * and `bootedAt` say since when.
 */
const counts = new Map<string, number>();

/** Add one (or `by`) to the named counter. */
export function inc(name: string, by = 1): void {
  counts.set(name, (counts.get(name) ?? 0) + by);
}

/** Every counter as a plain object — a Map would serialise as `{}`. */
export function snapshot(): Record<string, number> {
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}
