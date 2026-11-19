import { createDecipheriv } from "node:crypto";

// dramatip does not put stream URLs in its responses. It puts `enc` blobs:
// base64 of a 12-byte IV, then AES-256-GCM ciphertext with its 16-byte tag. The
// browser decrypts them with a key that ships, in the clear, in the player's
// JavaScript bundle.
//
// So the key is not a secret, but it is THEIRS to change: a redeploy can carry
// a new one. It is read from the bundle at runtime for that reason, and the
// value below is only the one that was there on 2026-11-19, kept as the
// starting guess so a cold start does not need the bundle at all.

export const KNOWN_KEY = "QC6Ir2trghxRAyyyWZEOEFR4GgLhnfQ4A19I3QBlQkc=";

/** The key as the bundle spells it: `importKey("raw", a("<base64>"), {name:"AES-GCM"}`. */
const KEY_IN_BUNDLE = /importKey\(\s*"raw"\s*,\s*\w+\(\s*"([A-Za-z0-9+/]{43}=)"\s*\)\s*,\s*\{\s*name\s*:\s*"AES-GCM"/;

/** The AES key in a chunk of the player bundle, or null when it is not this chunk. */
export function keyInBundle(js: string): string | null {
  return js.match(KEY_IN_BUNDLE)?.[1] ?? null;
}

/**
 * Decrypt one `enc` blob with [key] (base64).
 *
 * Throws when the key is wrong: GCM authenticates, so a rotated key is a
 * thrown error and never a garbage URL. The caller takes that as the signal to
 * read the key from the bundle again.
 */
export function decrypt(enc: string, key: string): string {
  const raw = Buffer.from(enc, "base64");
  if (raw.length < 12 + 16) throw new Error("dramatip: enc blob too short");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([
    decipher.update(raw.subarray(12, raw.length - 16)),
    decipher.final(),
  ]).toString("utf8");
}
