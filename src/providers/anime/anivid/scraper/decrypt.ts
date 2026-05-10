// Decoder for `new.vidnest.fun` stream responses.
//
// vidnest.fun's player ships a "decryptCipherResponse" routine that is, despite
// the name, just standard base64 decoding against a shuffled alphabet — there
// is no AES/RC4/XOR step. Their response envelope looks like:
//
//   { encrypted: true, data: "<custom-base64-string>", ... }
//
// or, when the upstream didn't bother encrypting:
//
//   { encrypted: false, sources: [...], ... }
//
// The decoded payload is JSON of the form `{ sources: [{ url, server?, quality?, subtitles?[] }, ...] }`.
//
// Reverse-engineered from /_next/static/chunks/c118cdd18010ba3d.js (module 50586)
// — see the `decryptCipherResponse` (`o`) function and the alphabet literal.

// Position N in this string is the symbol used to encode the 6-bit value N.
// Final "=" is the padding marker — kept at index 64 so a lookup of the
// padding character returns 64, matching the upstream code's sentinel.
export const VIDNEST_BASE64_ALPHABET =
  "RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=";

const PAD_SENTINEL = 64;

let _indexTable: Map<string, number> | null = null;
function indexTable(): Map<string, number> {
  if (_indexTable) return _indexTable;
  const m = new Map<string, number>();
  for (let i = 0; i < VIDNEST_BASE64_ALPHABET.length; i++) {
    m.set(VIDNEST_BASE64_ALPHABET.charAt(i), i);
  }
  _indexTable = m;
  return m;
}

export function decodeVidnestBase64(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";
  const lookup = indexTable();
  const bytes: number[] = [];

  for (let i = 0; i < input.length; i += 4) {
    let block = input.substring(i, i + 4);
    while (block.length < 4) block += "=";

    const d: number[] = new Array(4);
    for (let j = 0; j < 4; j++) {
      const idx = lookup.get(block.charAt(j));
      d[j] = idx === undefined ? PAD_SENTINEL : idx;
    }

    // First byte: always emitted (top 6 of d[0] + top 2 of d[1]).
    bytes.push(((d[0]! & 0x3f) << 2) | ((d[1]! & 0x3f) >> 4));
    // Second byte: only if d[2] isn't padding.
    if (d[2] !== PAD_SENTINEL) {
      bytes.push(((d[1]! & 0x0f) << 4) | ((d[2]! & 0x3f) >> 2));
    }
    // Third byte: only if d[3] isn't padding.
    if (d[3] !== PAD_SENTINEL) {
      bytes.push(((d[2]! & 0x03) << 6) | (d[3]! & 0x3f));
    }
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

export interface VidnestEnvelope {
  encrypted?: boolean;
  data?: string;
  [k: string]: any;
}

// Mirror of upstream `decryptCipherResponse(response)`: parses the JSON body,
// passes through unencrypted payloads, otherwise base64-decodes `data` and
// JSON-parses the result (falling back to the raw decoded string).
export async function decryptCipherResponse(response: Response): Promise<any> {
  const envelope = (await response.json()) as VidnestEnvelope;
  if (!envelope?.encrypted) return envelope;
  if (typeof envelope.data !== "string" || envelope.data.length === 0) {
    throw new Error("Response missing encrypted data field");
  }
  const decoded = decodeVidnestBase64(envelope.data);
  try {
    return JSON.parse(decoded);
  } catch {
    return decoded;
  }
}
