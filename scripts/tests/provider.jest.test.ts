import { describe, it, beforeAll, expect } from "@jest/globals";
import { runAnimePaheTests } from "./animepahe";
import { runMangaballTests } from "./mangaball";
import { createApp } from "../../src/app";

describe("Provider Integration Tests (Jest)", () => {
    let app: any;

    beforeAll(async () => {
        app = await createApp();
    });

    it("should run AnimePahe tests successfully", async () => {
        await runAnimePaheTests(app);
    }, 30000);

    it("should run Mangaball tests successfully", async () => {
        await runMangaballTests();
    }, 30000);
});
