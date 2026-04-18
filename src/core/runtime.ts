export const isBun = typeof Bun !== "undefined"; // @ts-expect-error - Bun global
export const isDeno = typeof Deno !== "undefined";

export const isNode = !isBun && !isDeno && typeof process !== "undefined";

export const runtime = isBun ? "bun" : isDeno ? "deno" : "node";

/**
 * Get environment variable in a cross-runtime way
 */
export function getEnv(key: string): string | undefined {
  if (isBun) return Bun.env[key];
  // @ts-expect-error - Deno global
  if (isDeno) return Deno.env.get(key);

  return process.env[key];
}

export const env = new Proxy(
  {},
  {
    get(_, key: string) {
      return getEnv(key);
    },
  },
) as Record<string, string | undefined>;
