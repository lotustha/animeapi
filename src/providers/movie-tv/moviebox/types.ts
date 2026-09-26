import { z } from "zod";

// ─── Envelope ────────────────────────────────────────────────────────────────
// Every BFF response is `{ code, message, data }`; code 0 is success.
export const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ code: z.number(), message: z.string().optional(), data: data.nullish() });

const imageSchema = z.object({ url: z.string() }).loose();

// ─── Subject card (search, trending, filter, detail) ────────────────────────
export const subjectSchema = z
  .object({
    subjectId: z.string(),
    subjectType: z.number(), // 1 = movie, 2 = tv
    title: z.string(),
    description: z.string().optional(),
    releaseDate: z.string().optional(),
    duration: z.number().optional(),
    genre: z.string().optional(),
    cover: imageSchema.nullish(),
    countryName: z.string().optional(),
    imdbRatingValue: z.string().optional(),
    subtitles: z.string().optional(),
    hasResource: z.boolean().optional(),
    detailPath: z.string(),
    dubs: z
      .array(
        z
          .object({
            subjectId: z.string(),
            lanName: z.string(),
            lanCode: z.string(),
            original: z.boolean().optional(),
            detailPath: z.string(),
          })
          .loose(),
      )
      .nullish(),
  })
  .loose();

export const searchSchema = envelope(
  z
    .object({
      pager: z.object({ hasMore: z.boolean(), page: z.string().optional() }).loose(),
      items: z.array(subjectSchema).nullish(),
    })
    .loose(),
);

export const trendingSchema = envelope(
  z
    .object({
      pager: z.object({ hasMore: z.boolean() }).loose().optional(),
      subjectList: z.array(subjectSchema).nullish(),
    })
    .loose(),
);

// ─── Detail ──────────────────────────────────────────────────────────────────
// `resource.seasons` drives episode lists. Movies come back as one season with
// se 0. `allEp` is a comma list of the episodes that actually exist when some
// are missing ("1,2,4"); empty means 1..maxEp are all there.
export const detailSchema = envelope(
  z
    .object({
      subject: subjectSchema,
      stars: z
        .array(
          z
            .object({
              name: z.string(),
              character: z.string().optional(),
              avatarUrl: z.string().optional(),
            })
            .loose(),
        )
        .nullish(),
      resource: z
        .object({
          seasons: z
            .array(
              z
                .object({
                  se: z.number(),
                  maxEp: z.number(),
                  allEp: z.string().optional(),
                  resolutions: z.array(z.object({ resolution: z.number() }).loose()).nullish(),
                })
                .loose(),
            )
            .nullish(),
        })
        .loose()
        .nullish(),
    })
    .loose(),
);

// ─── Play / caption ──────────────────────────────────────────────────────────
export const playSchema = envelope(
  z
    .object({
      hasResource: z.boolean().optional(),
      streams: z
        .array(
          z
            .object({
              id: z.string(),
              format: z.string(),
              url: z.string(),
              resolutions: z.string().optional(),
              size: z.string().optional(),
              duration: z.number().optional(),
              codecName: z.string().optional(),
            })
            .loose(),
        )
        .nullish(),
    })
    .loose(),
);

export const captionSchema = envelope(
  z
    .object({
      captions: z
        .array(
          z
            .object({
              lan: z.string(),
              lanName: z.string(),
              url: z.string(),
            })
            .loose(),
        )
        .nullish(),
    })
    .loose(),
);

// ─── Output shapes ───────────────────────────────────────────────────────────
export type MovieBoxType = "movie" | "tv";

export type MovieBoxItem = {
  id: string; // detailPath — the only key every endpoint accepts
  subjectId: string;
  title: string;
  type: MovieBoxType;
  poster?: string;
  releaseDate?: string;
  genres: string[];
  country?: string;
  rating?: string;
};

export type MovieBoxSeason = {
  season: number;
  episodes: number[];
  resolutions: number[];
};

export type MovieBoxInfo = MovieBoxItem & {
  description?: string;
  duration?: number;
  subtitleLanguages: string[];
  dubs: { id: string; subjectId: string; language: string; langCode: string; original: boolean }[];
  cast: { name: string; character?: string; image?: string }[];
  seasons: MovieBoxSeason[];
};

export type MovieBoxSource = {
  url: string;
  type: "mp4";
  quality: number;
  sizeBytes?: number;
  codec?: string;
};

export type MovieBoxSubtitle = { label: string; langCode: string; url: string };

export type MovieBoxStream = {
  sources: MovieBoxSource[];
  subtitles: MovieBoxSubtitle[];
  headers: Record<string, string>;
};
