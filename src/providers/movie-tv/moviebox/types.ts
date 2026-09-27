import { z } from "zod";

// ─── Envelope ────────────────────────────────────────────────────────────────
// Every BFF response is `{ code, message, data }`; code 0 is success.
export const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ code: z.number(), message: z.string().optional(), data: data.nullish() });

// Payloads passed through untouched, in MovieBox's own shape (home, ranking,
// raw detail, suggest) — only the envelope is checked.
export const rawSchema = envelope(z.unknown());

// Just enough of /home and /subject/filter to add a row to the home page.
export const homeRowsSchema = z
  .object({
    operatingList: z.array(z.object({ type: z.string(), position: z.number() }).loose()),
  })
  .loose();
export const filterItemsSchema = z.object({ items: z.array(z.unknown()).nullish() }).loose();

/** The site's movie/TV browse filters; "All" leaves a facet open. */
export type MovieBoxFilter = {
  type: MovieBoxType;
  classify?: string; // "All" | "Hindi dub" | …
  country?: string;
  genre?: string;
  year?: string;
  sort?: string; // "Latest" | …
};

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
            type: z.number().optional(), // 0 = dubbed audio, 1 = burned-in subtitles
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

// One language version of a title. MovieBox files every dub as its own subject
// (own id and subjectId); `hardsub` versions are the original audio with
// subtitles burned into the picture.
export type MovieBoxDub = {
  id: string;
  subjectId: string;
  language: string;
  langCode: string;
  original: boolean;
  kind: "audio" | "hardsub";
};

export type MovieBoxInfo = MovieBoxItem & {
  description?: string;
  duration?: number;
  subtitleLanguages: string[];
  dubs: MovieBoxDub[];
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

export type MovieBoxSubtitle = {
  label: string;
  langCode: string;
  url: string;
  format: "srt";
  /** Taken from the original-audio version, which is the same cut as this dub. */
  fromOriginal?: boolean;
};

export type MovieBoxStream = {
  sources: MovieBoxSource[];
  subtitles: MovieBoxSubtitle[];
  headers: Record<string, string>;
  /** The language version these sources play, when the title has dubs. */
  audio?: MovieBoxDub;
  /** Every language version of the title; pass a langCode as ?audio= to switch. */
  audioTracks: MovieBoxDub[];
};
