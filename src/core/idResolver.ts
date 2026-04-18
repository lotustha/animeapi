// ─── Unified ID Resolution ──────────────────────────────────────────────────
// Parses ID strings from URL params and resolves them to cross-platform mappings
// via AniZip. Bare numbers are AniList IDs by default; use prefix for others.
//
// Formats:
//   "21"          → AniList ID 21
//   "mal:20"      → MAL ID 20
//   "tmdb:46260"  → TMDB ID 46260
//   "imdb:tt0388629" → IMDB ID
//   "kitsu:12"    → Kitsu ID 12
//   "anidb:239"   → AniDB ID 239
//   "UUID-string" → provider-native ID (passed through as-is)

import { Logger } from "./logger.js";
import { AniZip } from "../anizip/index.js";
import type { ExternalMappings, AniZipResponse } from "../anizip/types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type IdType =
  | "anilist"
  | "mal"
  | "tmdb"
  | "imdb"
  | "kitsu"
  | "anidb"
  | "anisearch"
  | "livechart"
  | "internal"
  | "native"; // provider-native ID (AnimePahe UUID, etc.)

export interface ParsedId {
  type: IdType;
  raw: string; // original input
  value: string; // the ID value (number as string, or UUID)
  numericValue?: number; // if the value is numeric
}

export interface ResolvedAnime {
  parsedId: ParsedId;
  mappings: ExternalMappings | null;
  titles: Record<string, string | null>;
  fullData: AniZipResponse | null;
}

// ─── Prefix Map ─────────────────────────────────────────────────────────────

const PREFIX_MAP: Record<string, IdType> = {
  mal: "mal",
  tmdb: "tmdb",
  imdb: "imdb",
  kitsu: "kitsu",
  anidb: "anidb",
  anisearch: "anisearch",
  livechart: "livechart",
  anilist: "anilist",
  internal: "internal",
};

// ─── Parser ─────────────────────────────────────────────────────────────────

export function parseId(rawId: string): ParsedId {
  // Check for prefix format: "mal:20", "tmdb:46260", etc.
  const colonIndex = rawId.indexOf(":");
  if (colonIndex > 0) {
    const prefix = rawId.substring(0, colonIndex).toLowerCase();
    const value = rawId.substring(colonIndex + 1);
    const idType = PREFIX_MAP[prefix];

    if (idType) {
      const num = parseInt(value, 10);
      return {
        type: idType,
        raw: rawId,
        value,
        numericValue: isNaN(num) ? undefined : num,
      };
    }
  }

  // Bare number → AniList ID (default)
  if (/^\d+$/.test(rawId)) {
    return {
      type: "anilist",
      raw: rawId,
      value: rawId,
      numericValue: parseInt(rawId, 10),
    };
  }

  // Non-numeric, no prefix → provider-native ID (e.g. AnimePahe UUID)
  return {
    type: "native",
    raw: rawId,
    value: rawId,
  };
}

// ─── Resolver ───────────────────────────────────────────────────────────────

/** Build AniZip lookup params from a parsed ID */
function buildLookupParams(parsed: ParsedId): Record<string, number | string> | null {
  switch (parsed.type) {
    case "anilist":
      return parsed.numericValue ? { anilist_id: parsed.numericValue } : null;
    case "mal":
      return parsed.numericValue ? { mal_id: parsed.numericValue } : null;
    case "tmdb":
      return parsed.numericValue ? { themoviedb_id: parsed.numericValue } : null;
    case "imdb":
      return parsed.value ? { imdb_id: parsed.value } : null;
    case "kitsu":
      return parsed.numericValue ? { kitsu_id: parsed.numericValue } : null;
    case "anidb":
      return parsed.numericValue ? { anidb_id: parsed.numericValue } : null;
    case "anisearch":
      return parsed.numericValue ? { anisearch_id: parsed.numericValue } : null;
    case "livechart":
      return parsed.numericValue ? { livechart_id: parsed.numericValue } : null;
    case "native":
      // Can't do AniZip lookup with a native provider ID
      return null;
    case "internal":
      // Internal IDs are not supported by AniZip
      return null;
    default:
      return null;
  }
}

/**
 * Resolve any ID to cross-platform mappings + titles via AniZip.
 * Returns null if the ID type can't be resolved.
 */
export async function resolveId(rawId: string): Promise<ResolvedAnime | null> {
  const parsed = parseId(rawId);

  // Native IDs can't be resolved via AniZip (need provider-specific logic)
  if (parsed.type === "native") {
    return {
      parsedId: parsed,
      mappings: null,
      titles: {},
      fullData: null,
    };
  }

  // For ID types AniZip doesn't support directly (tmdb, imdb, kitsu, etc.)
  // we can't resolve. The caller should handle this or we could add support later.
  const lookupParams = buildLookupParams(parsed);
  if (!lookupParams) {
    Logger.warn(`Cannot resolve ID type '${parsed.type}' via AniZip directly`);
    return {
      parsedId: parsed,
      mappings: null,
      titles: {},
      fullData: null,
    };
  }

  try {
    const fullData = await AniZip.getFullData(lookupParams);
    if (!fullData) {
      Logger.warn(`AniZip returned no data for ${rawId}`);
      return {
        parsedId: parsed,
        mappings: null,
        titles: {},
        fullData: null,
      };
    }

    return {
      parsedId: parsed,
      mappings: fullData.mappings,
      titles: fullData.titles,
      fullData,
    };
  } catch (err) {
    Logger.error(`ID resolution error for ${rawId}: ${String(err)}`);
    return {
      parsedId: parsed,
      mappings: null,
      titles: {},
      fullData: null,
    };
  }
}

/**
 * Quick resolve: just get mappings (no full data).
 */
export async function resolveMappings(rawId: string): Promise<ExternalMappings | null> {
  const parsed = parseId(rawId);
  const lookupParams = buildLookupParams(parsed);
  if (!lookupParams) return null;
  return AniZip.getMappings(lookupParams);
}

/**
 * Get the best title from a resolved anime (English → Romaji → Japanese).
 */
export function getBestTitle(titles: Record<string, string | null>): string {
  return titles["en"] ?? titles["x-jat"] ?? titles["ja"] ?? "";
}
