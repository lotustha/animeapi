import { z } from "zod";

// ─── Guest sign-up ───────────────────────────────────────────────────────────
export const signUpSchema = z.object({
  payload: z
    .object({
      id: z.string(),
      access_token: z.string(),
      secret: z.string(),
      expires_in: z.number().optional(),
    })
    .loose(),
});

// ─── Post card ───────────────────────────────────────────────────────────────
// Feed, search and tag feeds all return the same terse card. h/w are the
// video's height/width, l = views, lc = likes, d = duration in seconds.
export const postSchema = z
  .object({
    i: z.string(),
    c: z.string().nullish(),
    d: z.union([z.string(), z.number()]).nullish(),
    l: z.union([z.string(), z.number()]).nullish(),
    lc: z.union([z.string(), z.number()]).nullish(),
    h: z.union([z.string(), z.number()]).nullish(),
    w: z.union([z.string(), z.number()]).nullish(),
    m: z.string().nullish(),
    thumb: z.string().nullish(),
    b: z.string().nullish(),
    compressedVideoUrl: z.string().nullish(),
    permalink: z.string().nullish(),
    ath: z
      .object({
        i: z.string().nullish(),
        h: z.string().nullish(),
        n: z.string().nullish(),
        pu: z.string().nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();

export const videoFeedSchema = z.object({
  payload: z.object({ d: z.array(z.unknown()).nullish() }).loose(),
});

// Search answers a numeric offset, the tag feed an opaque string cursor.
const offsetSchema = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined || v === "" ? null : String(v)));

export const searchSchema = z
  .object({ postCards: z.array(z.unknown()).nullish(), offset: offsetSchema })
  .loose();

export const tagSchema = z.object({ tagId: z.number(), tagName: z.string() }).loose();

export const tagFeedSchema = z
  .object({ posts: z.array(z.unknown()).nullish(), offset: offsetSchema })
  .loose();

// ─── Output shapes ───────────────────────────────────────────────────────────
export type MojShort = {
  id: string;
  caption: string;
  url: string; // direct MP4 — plays without auth or Referer
  thumbnail?: string;
  duration?: number;
  width?: number;
  height?: number;
  views?: number;
  likes?: number;
  language?: string;
  permalink?: string;
  author: { id?: string; handle?: string; name?: string; avatar?: string };
};

export type MojPage = { results: MojShort[]; nextOffset: string | null };
