/**
 * One call in flight per key; concurrent askers share its answer.
 *
 * A viewer opening a series costs two resolves of its first episode: the app
 * prefetches the stream while the series page, seeing the open, warms the same
 * episode. Both used to go to narto. Measured 2026-09-24: the two arrived a
 * moment apart, narto answered the second with 429, the first came back fine
 * five seconds later — and the viewer got the 429, with a 20-second wait in
 * front of a link this server already held.
 *
 * Finished calls are forgotten at once, failures included: the point is to
 * fold simultaneous asks together, never to remember an answer. Caching is the
 * route's job and has its own TTLs.
 */
const inflight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const held = inflight.get(key);
  if (held) return held as Promise<T>;
  const run = fn().finally(() => {
    if (inflight.get(key) === run) inflight.delete(key);
  });
  inflight.set(key, run);
  return run;
}
