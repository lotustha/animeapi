import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../../src/app";
import { MOCK_DATA } from "../../tests/mocks/providers";

// ─── Mock All Provider Classes ──────────────────────────────────────────────

// Anime
vi.mock("../../src/providers/anime/animepahe/animepahe", () => ({ Animepahe: { search: vi.fn(), latest: vi.fn(), info: vi.fn(), fetchAllEpisodes: vi.fn(), streams: vi.fn() } }));
vi.mock("../../src/providers/anime/animekai/animekai", () => ({ AnimeKai: { search: vi.fn(), spotlight: vi.fn(), info: vi.fn(), watch: vi.fn(), servers: vi.fn(), suggestions: vi.fn(), recentlyUpdated: vi.fn(), recentlyAdded: vi.fn(), genreSearch: vi.fn(), schedule: vi.fn(), genres: vi.fn() } }));
vi.mock("../../src/providers/anime/toonstream/scrapers/home", () => ({ ScrapeHomePage: vi.fn() }));
vi.mock("../../src/providers/anime/animesalt/animesalt", () => ({ AnimeSalt: { home: vi.fn(), search: vi.fn(), info: vi.fn(), episodes: vi.fn(), sources: vi.fn() } }));

// Manga
vi.mock("../../src/providers/manga/mangaball/mangaball", () => ({ mangaball: { parseHome: vi.fn(), parseLatest: vi.fn(), parseDetail: vi.fn(), parseRead: vi.fn(), parseSearch: vi.fn(), parseRecommendation: vi.fn(), parsePopular: vi.fn() } }));
vi.mock("../../src/providers/manga/allmanga/allmanga", () => ({ allmanga: { parseHome: vi.fn(), search: vi.fn(), detail: vi.fn(), read: vi.fn() } }));
vi.mock("../../src/providers/manga/atsu/atsu", () => ({ atsu: { parseHome: vi.fn(), filters: vi.fn(), detail: vi.fn(), read: vi.fn() } }));

// Movie-TV
vi.mock("../../src/providers/movie-tv/primesrc/primesrc", () => ({ Primesrc: { getMovieSource: vi.fn(), getTvSource: vi.fn() } }));
vi.mock("../../src/providers/movie-tv/yflix/yflix", () => ({ yFlix: { home: vi.fn(), search: vi.fn(), info: vi.fn(), sources: vi.fn() } }));
vi.mock("../../src/providers/movie-tv/himovies/himovies", () => ({ HiMovies: { fetchHome: vi.fn(), search: vi.fn(), fetchMediaInfo: vi.fn(), fetchSources: vi.fn() } }));
vi.mock("../../src/providers/movie-tv/flixhq/flixhq", () => ({ FlixHQ: { fetchHome: vi.fn(), search: vi.fn(), fetchMediaInfo: vi.fn(), fetchSources: vi.fn() } }));

// Music
vi.mock("../../src/providers/music/tidal/tidal", () => ({ tidal: { search: vi.fn(), getTrack: vi.fn(), getFeatured: vi.fn(), cleanMetadata: vi.fn(i => i), cleanPageData: vi.fn(i => i) } }));

// Stream
vi.mock("../../src/providers/stream/vidcore/vidcore", () => ({ vidcore: { fetchMovie: vi.fn(), fetchTv: vi.fn() } }));
vi.mock("../../src/providers/stream/vidfast/vidfast", () => ({ vidfast: { fetchMovie: vi.fn(), fetchTv: vi.fn() } }));

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("Unified Provider Mock Tests (Vitest - Full Coverage)", () => {
    let app: any;

    beforeEach(async () => {
        app = await createApp();
        vi.clearAllMocks();
    });

    const testGet = async (path: string) => {
        const req = new Request(`http://localhost${path}`);
        const res = await app.handle(req);
        if (res.status !== 200) {
            const text = await res.text();
            console.error(`Failed ${path}: ${res.status} - ${text}`);
        }
        expect(res.status).toBe(200);
        return await res.json();
    };

    describe("Anime Providers", () => {
        it("AnimePahe: /anime/animepahe/search/:query", async () => {
            const { Animepahe } = await import("../../src/providers/anime/animepahe/animepahe");
            vi.mocked(Animepahe.search).mockResolvedValue(MOCK_DATA.anime.animepahe.search);
            const json = await testGet("/anime/animepahe/search/test");
            expect(json.results).toEqual(MOCK_DATA.anime.animepahe.search);
        });

        it("AnimeKai: /anime/animekai/spotlight", async () => {
            const { AnimeKai } = await import("../../src/providers/anime/animekai/animekai");
            vi.mocked(AnimeKai.spotlight).mockResolvedValue(MOCK_DATA.anime.animekai.spotlight);
            const json = await testGet("/anime/animekai/spotlight");
            expect(json.results).toEqual(MOCK_DATA.anime.animekai.spotlight);
        });

        it("ToonStream: /anime/toonstream/home", async () => {
            const { ScrapeHomePage } = await import("../../src/providers/anime/toonstream/scrapers/home");
            vi.mocked(ScrapeHomePage).mockResolvedValue(MOCK_DATA.anime.toonstream.home);
            const json = await testGet("/anime/toonstream/home");
            expect(json.data).toEqual(MOCK_DATA.anime.toonstream.home);
        });

        it("AnimeSalt: /anime/animesalt/home", async () => {
            const { AnimeSalt } = await import("../../src/providers/anime/animesalt/animesalt");
            vi.mocked(AnimeSalt.home).mockResolvedValue(MOCK_DATA.anime.animesalt.home);
            const json = await testGet("/anime/animesalt/home");
            expect(json.results).toEqual(MOCK_DATA.anime.animesalt.home);
        });
    });

    describe("Manga Providers", () => {
        it("MangaBall: /manga/mangaball/home", async () => {
            const { mangaball } = await import("../../src/providers/manga/mangaball/mangaball");
            vi.mocked(mangaball.parseHome).mockResolvedValue(MOCK_DATA.manga.mangaball.home);
            const json = await testGet("/manga/mangaball/home");
            expect(json.data).toEqual(MOCK_DATA.manga.mangaball.home);
        });

        it("AllManga: /manga/allmanga/home", async () => {
            const { allmanga } = await import("../../src/providers/manga/allmanga/allmanga");
            vi.mocked(allmanga.parseHome).mockResolvedValue(MOCK_DATA.manga.allmanga.home);
            const json = await testGet("/manga/allmanga/home");
            expect(json.data).toEqual(MOCK_DATA.manga.allmanga.home);
        });

        it("Atsu: /manga/atsu/home", async () => {
            const { atsu } = await import("../../src/providers/manga/atsu/atsu");
            vi.mocked(atsu.parseHome).mockResolvedValue(MOCK_DATA.manga.atsu.home);
            const json = await testGet("/manga/atsu/home");
            expect(json.data).toEqual(MOCK_DATA.manga.atsu.home);
        });
    });

    describe("Movie-TV Providers", () => {
        it("PrimeSrc: /movie-tv/primesrc/movie/:id", async () => {
            const { Primesrc } = await import("../../src/providers/movie-tv/primesrc/primesrc");
            vi.mocked(Primesrc.getMovieSource).mockResolvedValue({ success: true, status: 200, data: MOCK_DATA.movieTv.primesrc.sources });
            const json = await testGet("/movie-tv/primesrc/movie/123");
            expect(json.data).toEqual(MOCK_DATA.movieTv.primesrc.sources);
        });

        it("YFlix: /movie-tv/yflix/home", async () => {
            const { yFlix } = await import("../../src/providers/movie-tv/yflix/yflix");
            vi.mocked(yFlix.home).mockResolvedValue(MOCK_DATA.movieTv.yflix.home);
            const json = await testGet("/movie-tv/yflix/home");
            expect(json).toEqual(MOCK_DATA.movieTv.yflix.home);
        });

        it("HiMovies: /movie-tv/himovies/home", async () => {
            const { HiMovies } = await import("../../src/providers/movie-tv/himovies/himovies");
            vi.mocked(HiMovies.fetchHome).mockResolvedValue(MOCK_DATA.movieTv.himovies.home);
            const json = await testGet("/movie-tv/himovies/home");
            expect(json).toEqual(MOCK_DATA.movieTv.himovies.home);
        });

        it("FlixHQ: /movie-tv/flixhq/home", async () => {
            const { FlixHQ } = await import("../../src/providers/movie-tv/flixhq/flixhq");
            vi.mocked(FlixHQ.fetchHome).mockResolvedValue(MOCK_DATA.movieTv.flixhq.home);
            const json = await testGet("/movie-tv/flixhq/home");
            expect(json).toEqual(MOCK_DATA.movieTv.flixhq.home);
        });
    });

    describe("Music & Stream", () => {
        it("Tidal: /music/tidal/search", async () => {
            const { tidal } = await import("../../src/providers/music/tidal/tidal");
            vi.mocked(tidal.search).mockResolvedValue(MOCK_DATA.music.tidal.search);
            const json = await testGet("/music/tidal/search?q=test");
            expect(json.data).toEqual(MOCK_DATA.music.tidal.search);
        });

        it("VidCore: /stream/vidcore", async () => {
            const { vidcore } = await import("../../src/providers/stream/vidcore/vidcore");
            vi.mocked(vidcore.fetchMovie).mockResolvedValue(MOCK_DATA.stream.vidcore);
            const json = await testGet("/stream/vidcore");
            expect(json).toEqual(MOCK_DATA.stream.vidcore);
        });

        it("VidFast: /stream/vidfast", async () => {
            const { vidfast } = await import("../../src/providers/stream/vidfast/vidfast");
            vi.mocked(vidfast.fetchMovie).mockResolvedValue(MOCK_DATA.stream.vidfast);
            const json = await testGet("/stream/vidfast");
            expect(json).toEqual(MOCK_DATA.stream.vidfast);
        });
    });
});
