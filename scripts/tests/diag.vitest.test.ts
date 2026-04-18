import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../../src/app";

describe("Diagnostic 404 Test", () => {
    it("Check specific route", async () => {
        const app = await createApp();
        const path = "/manga/allmanga/home";
        const req = new Request(`http://localhost${path}`);
        const res = await app.handle(req);
        const text = await res.text();
        console.log(`Path: ${path}, Status: ${res.status}, Body: ${text}`);

        console.log("Registered routes (first 10):", app.routes.slice(0, 10).map(r => r.path));
        console.log("Manga routes:", app.routes.filter(r => r.path.includes("manga")).map(r => r.path));

        expect(res.status).toBe(200);
    });
});
