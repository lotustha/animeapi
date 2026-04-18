import { describe, it, expect, vi } from "vitest"; // Vitest-specific but Jest has compatible globals
import { runAnimePaheTests } from "./animepahe";
import { runMangaballTests } from "./mangaball";

// If running in Jest, these globals are provided automatically.
// If running in Vitest, they are imported above.
// However, to keep it cross-compatible without manual imports in كل file:
// We use common test syntax.

const { createApp } = await import("../../src/app");
let app: any;

describe("Provider Integration Tests", () => {
    beforeAll(async () => {
        app = await createApp();
    });

    it("should run AnimePahe tests successfully", async () => {
        await expect(runAnimePaheTests(app)).resolves.not.toThrow();
    }, 30000);

    it("should run Mangaball tests successfully", async () => {
        await expect(runMangaballTests()).resolves.not.toThrow();
    }, 30000);
});
