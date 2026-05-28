import { lookerFetch } from "./fetch.js";
import { buildFullSlug } from "./slug.js";

export type AnimelokRawEpisode = {
  number: number;
  name: string;
  thumbnail?: string;
  image?: string;
  isFiller?: boolean;
  description?: string;
};

export type AnimelokEpisodesResult = {
  episodes: AnimelokRawEpisode[];
  total?: number;
  page: number;
};

/**
 * Fetch a paginated episode list for an anime from animelok.online.
 * Source: GET /api/anime/{slug}-{anilistId}/episodes-range?page=&lang=&pageSize=
 */
export async function scrapeEpisodes(
  anilistId: string,
  title: string,
  page = 0,
  lang = "ALL",
  pageSize = 30,
): Promise<AnimelokEpisodesResult> {
  const slug = buildFullSlug(title, anilistId);
  const apiPath = `/api/anime/${slug}/episodes-range?page=${page}&lang=${lang}&pageSize=${pageSize}`;

  const data = await lookerFetch<{ episodes?: any[]; total?: number }>(apiPath, slug);

  const episodes: AnimelokRawEpisode[] = (data.episodes ?? []).map((ep: any) => {
    let thumbnail = ep.thumbnail || ep.image || ep.img;
    if (thumbnail && typeof thumbnail === "string") {
      thumbnail = thumbnail.replace("https://img.animetsu.cc/", "");
      thumbnail = thumbnail.replace("i.animepahe.si", "i.animepahe.pw");
    }
    return {
      number: ep.number,
      name: ep.name && String(ep.name).trim() !== "" ? ep.name : `Episode ${ep.number}`,
      thumbnail,
      image: thumbnail,
      isFiller: !!ep.isFiller,
      description: ep.description,
    };
  });

  return { episodes, total: data.total, page };
}
