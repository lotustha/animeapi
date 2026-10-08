import { randomBytes } from "node:crypto";
import { Logger } from "../../../core/logger.js";
import { moj_api } from "../../origins.js";
import {
  postSchema,
  searchSchema,
  signUpSchema,
  tagFeedSchema,
  tagSchema,
  videoFeedSchema,
  type MojPage,
  type MojShort,
} from "./types.js";

// Headers the Android app sends. The API checks tenant and package, not a
// request signature.
const APP_HEADERS = {
  "Content-Type": "application/json",
  "X-TENANT": "moj",
  "IDENTITY-VERSION": "V2",
  "APP-VERSION": "261903",
  "PACKAGE-NAME": "in.mohalla.video",
  "CLIENT-TYPE": "Android",
  "User-Agent": "okhttp/4.12.0",
};

// Guest account, created the way mojapp.in does it for logged-out visitors:
// POST /signUp with a placeholder profile returns an id + access_token + secret
// valid for `expires_in` seconds (12h as of 2026-09-26). The For You feed is
// ranked per account, so one shared guest also means one shared "seen" list.
type Session = { id: string; token: string; secret: string; deviceId: string; expiresAt: number };
let session: Session | null = null;
let pending: Promise<Session> | null = null;

const signUp = async (): Promise<Session> => {
  const deviceId = randomBytes(8).toString("hex");
  const res = await fetch(`${moj_api}/signUp`, {
    method: "POST",
    headers: { ...APP_HEADERS, "CLIENT-TYPE": "MojPWA" },
    body: JSON.stringify({
      name: "MojUser",
      phone: "9116969696969",
      appVersion: 764,
      countryAreaCode: "91",
      language: "Hindi",
      deviceId,
      client: "web",
    }),
  });
  const parsed = signUpSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new Error(`moj: guest sign-up failed (HTTP ${res.status})`);
  const { id, access_token, secret, expires_in } = parsed.data.payload;
  // Renew ten minutes early so a token never lapses mid-request.
  const ttl = Math.max((expires_in ?? 43200) - 600, 300);
  session = { id, token: access_token, secret, deviceId, expiresAt: Date.now() + ttl * 1000 };
  return session;
};

const getSession = async (): Promise<Session> => {
  if (session && session.expiresAt > Date.now()) return session;
  pending ??= signUp().finally(() => (pending = null));
  return pending;
};

const num = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const toShort = (raw: unknown): MojShort | null => {
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.compressedVideoUrl) return null;
  const p = parsed.data;
  return {
    id: p.i,
    caption: p.c ?? "",
    url: p.compressedVideoUrl!,
    thumbnail: p.thumb || p.b || undefined,
    duration: num(p.d),
    width: num(p.w),
    height: num(p.h),
    views: Number(p.l) || 0,
    likes: Number(p.lc) || 0,
    language: p.m || undefined,
    permalink: p.permalink || undefined,
    author: {
      id: p.ath?.i || undefined,
      handle: p.ath?.h || undefined,
      name: p.ath?.n?.trim() || undefined,
      avatar: p.ath?.pu || undefined,
    },
  };
};

const toShorts = (list: unknown[] | null | undefined) =>
  (list ?? []).map(toShort).filter((s): s is MojShort => s !== null);

export class Moj {
  /** Authenticated API call. Re-creates the guest once if the session was refused. */
  private static async api(
    path: string,
    init: { method?: "GET" | "POST"; body?: unknown } = {},
    retry = true,
  ): Promise<unknown> {
    const s = await getSession();
    const res = await fetch(`${moj_api}/${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...APP_HEADERS,
        "X-SHARECHAT-USERID": s.id,
        "X-SHARECHAT-AUTHORIZED-USERID": s.id,
        "X-SHARECHAT-AUTH": s.token,
        "X-SHARECHAT-SECRET": s.secret,
        "DEVICE-ID": s.deviceId,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (retry && (res.status === 401 || res.status === 403)) {
      session = null;
      return this.api(path, init, false);
    }
    return res.json().catch(() => null);
  }

  /**
   * The app's For You feed. It has no offset: the server tracks what this guest
   * account has already been shown, so each call returns the next batch.
   */
  static async feed(limit = 10): Promise<MojPage> {
    const s = await getSession();
    const query = new URLSearchParams({
      limit: String(limit),
      firstFetch: "true",
      postsAfterAd: "0",
      ads: "false",
      pacs: "0",
      adsShown: "0",
      adsFetched: "0",
      rcsp: "false",
    });
    const parsed = videoFeedSchema.safeParse(
      await this.api(`videoFeed?${query}`, {
        method: "POST",
        body: { message: {}, userId: s.id },
      }),
    );
    if (!parsed.success) {
      Logger.warn("moj: videoFeed returned an unexpected shape");
      return { results: [], nextOffset: null };
    }
    return { results: toShorts(parsed.data.payload.d), nextOffset: null };
  }

  static async search(query: string, offset = "0", lang = "Hindi"): Promise<MojPage> {
    const params = new URLSearchParams({
      searchString: query,
      lang,
      offset,
      limit: "20",
      pagination: "true",
    });
    const parsed = searchSchema.safeParse(
      await this.api(`search-service/v1.0.0/post-search?${params}`),
    );
    if (!parsed.success) {
      Logger.warn(`moj: search "${query}" returned an unexpected shape`);
      return { results: [], nextOffset: null };
    }
    const results = toShorts(parsed.data.postCards);
    return { results, nextOffset: results.length > 0 ? (parsed.data.offset ?? null) : null };
  }

  /** Resolve a hashtag name (without #) to Moj's numeric tag id. */
  static async tagId(name: string): Promise<number | null> {
    const params = new URLSearchParams({ tagName: name, projections: "id,name" });
    const parsed = tagSchema.safeParse(await this.api(`tag-service/v1.0.0/tagByName?${params}`));
    return parsed.success ? parsed.data.tagId : null;
  }

  static async tag(tagId: number, offset?: string, lang = "Hindi"): Promise<MojPage> {
    const params = new URLSearchParams({ lang });
    if (offset) params.set("offset", offset);
    const parsed = tagFeedSchema.safeParse(
      await this.api(`tag-service/v1.0.0/tag/${tagId}/feed/popular?${params}`),
    );
    if (!parsed.success) {
      Logger.warn(`moj: tag ${tagId} feed returned an unexpected shape`);
      return { results: [], nextOffset: null };
    }
    const results = toShorts(parsed.data.posts);
    return { results, nextOffset: results.length > 0 ? (parsed.data.offset ?? null) : null };
  }
}
