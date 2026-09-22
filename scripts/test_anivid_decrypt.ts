// Hit the real vidnest backend and round-trip through our decryptor.
// If the decryptor is correct, both calls should return { sources: [...] }
// with at least one url-bearing entry.

import {
  decodeVidnestBase64,
  decryptCipherResponse,
} from "../src/providers/anime/anivid/scraper/decrypt.js";

const BASE = "https://new.vidnest.fun";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function previewSources(payload: any) {
  const sources = payload?.sources ?? payload?.multiSrc ?? [];
  return {
    encrypted_flag_was: payload?.__sourceEncryptedFlag,
    sources_count: Array.isArray(sources) ? sources.length : 0,
    sample: Array.isArray(sources)
      ? sources.slice(0, 3).map((s: any) => ({
          server: s?.server,
          quality: s?.quality,
          url_prefix: typeof s?.url === "string" ? s.url.slice(0, 80) + "…" : s?.url,
          subtitle_count: Array.isArray(s?.subtitles) ? s.subtitles.length : 0,
        }))
      : "(not an array)",
    keys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 8) : null,
  };
}

async function hit(label: string, url: string, referer: string) {
  console.log(`\n─── ${label} ───`);
  console.log("URL:", url);
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      Referer: referer,
      Origin: referer.replace(/\/$/, ""),
    },
  });
  console.log("status:", res.status);
  // We need to read the body twice (once for raw, once via decryptCipherResponse).
  // Easiest: clone the response.
  const clone = res.clone();
  const raw = await clone.text();
  console.log("raw_envelope_keys:", (() => {
    try {
      const j = JSON.parse(raw);
      return { encrypted: j?.encrypted, dataLen: typeof j?.data === "string" ? j.data.length : null, keys: Object.keys(j).slice(0, 6) };
    } catch {
      return "(not-json) " + raw.slice(0, 120);
    }
  })());

  try {
    const decoded = await decryptCipherResponse(res);
    console.log("decoded:", previewSources(decoded));
  } catch (err) {
    console.error("decryptCipherResponse error:", err);
  }
}

// Pin a known-good show: Jujutsu Kaisen (AniList 113415), episode 1.
await hit(
  "aniwave_hls sub",
  `${BASE}/aniwave_hls/113415/1/sub`,
  "https://aniwaves.ru/",
);

await hit(
  "anitaku sub",
  `${BASE}/anitaku/113415/1/sub/hd-2`,
  "https://anitaku.to",
);

// Self-test the alphabet decoder against a literal copy of how the SPA
// encodes the string "hello world" → run the inverse to be sure.
// (Not strictly necessary, but a quick sanity check while we're here.)
console.log("\n─── self-test: round-trip via standard-base64 indices ───");
const sample = "hello world";
const stdB64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
// Encode "hello world" the standard way and translate each char through the
// vidnest alphabet to produce what the upstream would have sent.
const stdEncoded = Buffer.from(sample, "utf8").toString("base64");
const translated = stdEncoded
  .split("")
  .map((ch) => {
    if (ch === "=") return "=";
    const idx = stdB64.indexOf(ch);
    return idx >= 0 ? "RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/="[idx]! : ch;
  })
  .join("");
console.log("translated:", translated);
console.log("decoded:   ", decodeVidnestBase64(translated));
console.log("match:     ", decodeVidnestBase64(translated) === sample);
