import { jest, describe, it, expect, beforeAll } from "@jest/globals";

// ─── 1. REGISTER ALL MOCKS FIRST (BEFORE ANY REQUIRES) ─────────────────────────

// Anime
jest.mock("../../src/providers/anime/animepahe/animepahe", () => ({ __esModule: true, Animepahe: { search: jest.fn(), latest: jest.fn(), info: jest.fn(), fetchAllEpisodes: jest.fn(), streams: jest.fn() } }));
jest.mock("../../src/providers/anime/animekai/animekai", () => ({ __esModule: true, AnimeKai: { search: jest.fn(), spotlight: jest.fn(), info: jest.fn(), watch: jest.fn(), servers: jest.fn(), suggestions: jest.fn(), recentlyUpdated: jest.fn(), recentlyAdded: jest.fn(), genreSearch: jest.fn(), schedule: jest.fn(), genres: jest.fn() } }));
jest.mock("../../src/providers/anime/toonstream/scrapers/home", () => ({ __esModule: true, ScrapeHomePage: jest.fn() }));
jest.mock("../../src/providers/anime/animesalt/animesalt", () => ({ __esModule: true, AnimeSalt: { home: jest.fn(), search: jest.fn(), info: jest.fn(), episodes: jest.fn(), sources: jest.fn() } }));

// Manga
jest.mock("../../src/providers/manga/mangaball/mangaball", () => ({ __esModule: true, mangaball: { parseHome: jest.fn(), parseLatest: jest.fn(), parseDetail: jest.fn(), parseRead: jest.fn(), parseSearch: jest.fn(), parseRecommendation: jest.fn(), parsePopular: jest.fn() } }));
jest.mock("../../src/providers/manga/allmanga/allmanga", () => ({ __esModule: true, allmanga: { parseHome: jest.fn(), search: jest.fn(), detail: jest.fn(), read: jest.fn() } }));
jest.mock("../../src/providers/manga/atsu/atsu", () => ({ __esModule: true, atsu: { parseHome: jest.fn(), filters: jest.fn(), detail: jest.fn(), read: jest.fn() } }));

// Movie-TV
jest.mock("../../src/providers/movie-tv/primesrc/primesrc", () => ({ __esModule: true, Primesrc: { getMovieSource: jest.fn(), getTvSource: jest.fn() } }));
jest.mock("../../src/providers/movie-tv/yflix/yflix", () => ({ __esModule: true, yFlix: { home: jest.fn(), search: jest.fn(), info: jest.fn(), sources: jest.fn() } }));
jest.mock("../../src/providers/movie-tv/himovies/himovies", () => ({ __esModule: true, HiMovies: { fetchHome: jest.fn(), search: jest.fn(), fetchMediaInfo: jest.fn(), fetchSources: jest.fn() } }));
jest.mock("../../src/providers/movie-tv/flixhq/flixhq", () => ({ __esModule: true, FlixHQ: { fetchHome: jest.fn(), search: jest.fn(), fetchMediaInfo: jest.fn(), fetchSources: jest.fn() } }));

// Music
jest.mock("../../src/providers/music/tidal/tidal", () => ({ __esModule: true, tidal: { search: jest.fn(), getTrack: jest.fn(), getFeatured: jest.fn(), cleanMetadata: jest.fn(i => i), cleanPageData: jest.fn(i => i) } }));

// Stream
jest.mock("../../src/providers/stream/vidcore/vidcore", () => ({ __esModule: true, vidcore: { fetchMovie: jest.fn(), fetchTv: jest.fn() } }));
jest.mock("../../src/providers/stream/vidfast/vidfast", () => ({ __esModule: true, vidfast: { fetchMovie: jest.fn(), fetchTv: jest.fn() } }));

// ─── 2. REQUIRES (AFTER MOCKS) ────────────────────────────────────────────────

const { MOCK_DATA } = require("../../tests/mocks/providers");

// ─── 3. TEST SUITE ────────────────────────────────────────────────────────────

describe("Unified Provider Mock Tests (Jest - Full Coverage)", () => {
    let app: any;

    beforeAll(async () => {
        // Import app after mocks are set up
        const { createApp } = require("../../src/app");
        app = await createApp();
    });

    const testGet = async (path: string) => {
        const req = new Request(`http://localhost${path}`);
        const res = await app.handle(req);
        if (res.status !== 200) {
            const clonedRes = res.clone();
            const text = await clonedRes.text().catch(() => "N/A");
            console.error(`Failed ${path}: ${res.status} - ${text}`);
        }
        expect(res.status).toBe(200);
        return await res.json();
    };

    describe("Anime Providers", () => {
        it("AnimePahe: /anime/animepahe/search/:query", async () => {
            const { Animepahe } = require("../../src/providers/anime/animepahe/animepahe");
            const spy = jest.spyOn(Animepahe, 'search').mockResolvedValue(MOCK_DATA.anime.animepahe.search);
            const json = await testGet("/anime/animepahe/search/test");
            expect(json.results).toEqual(MOCK_DATA.anime.animepahe.search);
            spy.mockRestore();
        });

        it("AnimeKai: /anime/animekai/spotlight", async () => {
            const { AnimeKai } = require("../../src/providers/anime/animekai/animekai");
            const spy = jest.spyOn(AnimeKai, 'spotlight').mockResolvedValue(MOCK_DATA.anime.animekai.spotlight);
            const json = await testGet("/anime/animekai/spotlight");
            expect(json.results).toEqual(MOCK_DATA.anime.animekai.spotlight);
            spy.mockRestore();
        });

        it("ToonStream: /anime/toonstream/home", async () => {
            const Scraper = require("../../src/providers/anime/toonstream/scrapers/home");
            const spy = jest.spyOn(Scraper, 'ScrapeHomePage').mockResolvedValue(MOCK_DATA.anime.toonstream.home);
            const json = await testGet("/anime/toonstream/home");
            expect(json.data).toEqual(MOCK_DATA.anime.toonstream.home);
            spy.mockRestore();
        });

        it("AnimeSalt: /anime/animesalt/home", async () => {
            const { AnimeSalt } = require("../../src/providers/anime/animesalt/animesalt");
            const spy = jest.spyOn(AnimeSalt, 'home').mockResolvedValue(MOCK_DATA.anime.animesalt.home);
            const json = await testGet("/anime/animesalt/home");
            expect(json.results).toEqual(MOCK_DATA.anime.animesalt.home);
            spy.mockRestore();
        });
    });

    describe("Manga Providers", () => {
        it("MangaBall: /manga/mangaball/home", async () => {
            const { mangaball } = require("../../src/providers/manga/mangaball/mangaball");
            const spy = jest.spyOn(mangaball, 'parseHome').mockResolvedValue(MOCK_DATA.manga.mangaball.home);
            const json = await testGet("/manga/mangaball/home");
            expect(json.data).toEqual(MOCK_DATA.manga.mangaball.home);
            spy.mockRestore();
        });

        it("AllManga: /manga/allmanga/home", async () => {
            const { allmanga } = require("../../src/providers/manga/allmanga/allmanga");
            const spy = jest.spyOn(allmanga, 'parseHome').mockResolvedValue(MOCK_DATA.manga.allmanga.home);
            const json = await testGet("/manga/allmanga/home");
            expect(json.data).toEqual(MOCK_DATA.manga.allmanga.home);
            spy.mockRestore();
        });

        it("Atsu: /manga/atsu/home", async () => {
            const { atsu } = require("../../src/providers/manga/atsu/atsu");
            const spy = jest.spyOn(atsu, 'parseHome').mockResolvedValue(MOCK_DATA.manga.atsu.home);
            const json = await testGet("/manga/atsu/home");
            expect(json.data).toEqual(MOCK_DATA.manga.atsu.home);
            spy.mockRestore();
        });
    });

    describe("Movie-TV Providers", () => {
        it("PrimeSrc: /movie-tv/primesrc/movie/:id", async () => {
            const { Primesrc } = require("../../src/providers/movie-tv/primesrc/primesrc");
            const spy = jest.spyOn(Primesrc, 'getMovieSource').mockResolvedValue({ success: true, status: 200, data: MOCK_DATA.movieTv.primesrc.sources });
            const json = await testGet("/movie-tv/primesrc/movie/123");
            expect(json.data).toEqual(MOCK_DATA.movieTv.primesrc.sources);
            spy.mockRestore();
        });

        it("YFlix: /movie-tv/yflix/home", async () => {
            const { yFlix } = require("../../src/providers/movie-tv/yflix/yflix");
            const spy = jest.spyOn(yFlix, 'home').mockResolvedValue(MOCK_DATA.movieTv.yflix.home);
            const json = await testGet("/movie-tv/yflix/home");
            expect(json).toEqual(MOCK_DATA.movieTv.yflix.home);
            spy.mockRestore();
        });

        it("HiMovies: /movie-tv/himovies/home", async () => {
            const { HiMovies } = require("../../src/providers/movie-tv/himovies/himovies");
            const spy = jest.spyOn(HiMovies, 'fetchHome').mockResolvedValue(MOCK_DATA.movieTv.himovies.home);
            const json = await testGet("/movie-tv/himovies/home");
            expect(json).toEqual(MOCK_DATA.movieTv.himovies.home);
            spy.mockRestore();
        });

        it("FlixHQ: /movie-tv/flixhq/home", async () => {
            const { FlixHQ } = require("../../src/providers/movie-tv/flixhq/flixhq");
            const spy = jest.spyOn(FlixHQ, 'fetchHome').mockResolvedValue(MOCK_DATA.movieTv.flixhq.home);
            const json = await testGet("/movie-tv/flixhq/home");
            expect(json).toEqual(MOCK_DATA.movieTv.flixhq.home);
            spy.mockRestore();
        });
    });

    describe("Music & Stream", () => {
        it("Tidal: /music/tidal/search", async () => {
            const { tidal } = require("../../src/providers/music/tidal/tidal");
            const spy = jest.spyOn(tidal, 'search').mockResolvedValue(MOCK_DATA.music.tidal.search);
            const json = await testGet("/music/tidal/search?q=test");
            expect(json.data).toEqual(MOCK_DATA.music.tidal.search);
            spy.mockRestore();
        });

        it("VidCore: /stream/vidcore", async () => {
            const { vidcore } = require("../../src/providers/stream/vidcore/vidcore");
            const spy = jest.spyOn(vidcore, 'fetchMovie').mockResolvedValue(MOCK_DATA.stream.vidcore);
            const json = await testGet("/stream/vidcore");
            expect(json).toEqual(MOCK_DATA.stream.vidcore);
            spy.mockRestore();
        });

        it("VidFast: /stream/vidfast", async () => {
            const { vidfast } = require("../../src/providers/stream/vidfast/vidfast");
            const spy = jest.spyOn(vidfast, 'fetchMovie').mockResolvedValue(MOCK_DATA.stream.vidfast);
            const json = await testGet("/stream/vidfast");
            expect(json).toEqual(MOCK_DATA.stream.vidfast);
            spy.mockRestore();
        });
    });
});
