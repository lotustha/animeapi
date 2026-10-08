export const animepahe = "https://animepahe.pw";
// anikai.to is dead; anikai.cc 302s to the www3 host, so point straight at it.
export const animekai = "https://www3.anikai.cc";
export const anigo = "https://anigo.to";
export const hianime = "https://hianime.at";
export const anizen = "https://anizen.tr";
export const anizen_api = "https://cdn.anizen.tr";
// Primary + mirrors for anikoto. The VPS IP gets blocked intermittently on
// individual domains; rotating across all five keeps streams alive. Order:
// primary TV domain first, then regional/short/network mirrors.
export const anikoto = "https://anikototv.to";
export const ANIKOTO_MIRRORS = [
  "https://anikototv.to",
  "https://anikoto.cz",
  "https://anikoto.me",
  "https://anikoto.net",
  "https://anikototv.se",
] as const;
// toonstream.vip 302s here; the site was rebuilt off WordPress onto a custom
// app in 2026 (new URL scheme, /embed/<hash> player indirection).
export const toonstream = "https://toon-stream.site";
export const animesalt = "https://animesalt.ac";
export const animelok = "https://animelok.net";
export const aniwaves = "https://aniwaves.ru";

export const anilist = "https://anilist.co";
export const anilist_graphql = "https://graphql.anilist.co";
export const jikan_api = "https://api.jikan.moe/v4";
export const vidnest = "https://vidnest.fun";
export const megaplay = "https://megaplay.buzz";
export const videasy = "https://player.videasy.net";
export const vidwish = "https://vidwish.live";

export const flixhq = "https://flixhq.to";
export const yflix = "https://yflix.to";
export const primesrc = "https://primesrc.me";

export const primevid = "https://primevid.click";
export const streamtape = "https://streamta.site";
export const doodstream = "https://myvidplay.com";

export const allmanga = "https://allmanga.to";
export const allmanga_api = "https://api.allanime.day/api";
export const mangaball = "https://mangaball.net";

export const himovies = "https://himovies.to";
// Short-drama aggregator. Stream resolution goes through the DNS-only edge host,
// not the main domain — nginx there 403s /refresh-source outright.
export const nartodrama = "https://narto-drama.com";
export const nartodrama_edge = "https://edge.narto-drama.com";
// MovieBox web front-end and its aoneroom BFF. The play endpoint only returns
// streams when the Referer is `${moviebox}/movies/<detailPath>`, and the video
// CDN 429s without a moviebox Referer.
export const moviebox = "https://themoviebox.xyz";
export const moviebox_api = "https://h5-api.aoneroom.com/wefeed-h5api-bff";
export const tidal = "https://api.tidal.com/v1";
// Moj (ShareChat) short video. The API takes a guest account that the web
// client creates with POST /signUp; videos on cdn-moj-g need no auth.
export const moj = "https://mojapp.in";
export const moj_api = "https://moj-apis.sharechat.com";
