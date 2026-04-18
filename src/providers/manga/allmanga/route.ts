import { Elysia } from "elysia";
import { allmanga } from "./allmanga.js";
import { de } from "zod/locales";

function ok(data: unknown) {
  return { status: 200, success: true, data };
}

function err(set: any, status: number, message: string) {
  set.status = status;
  return { status, success: false, message, data: null };
}

function getBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/manga/allmanga`;
}

export const allmangaRoutes = new Elysia({ prefix: "/allmanga" })

  .get(
    "/",
    () => {
      return {
        provider: "AllManga",
        status: "operational",
        description:
          "AllManga is a comprehensive manga database and reading platform offering a vast collection of manga titles across various genres. It provides users with an extensive library of manga series, including popular titles and hidden gems, along with features like personalized recommendations, user reviews, and a user-friendly interface for discovering and reading manga online.",
        message: "AllManga provider is running. Visit /docs for available endpoints.",
      };
    },
    {
      detail: { tags: ["manga"], summary: "AllManga Status" },
    },
  )

  .get(
    "/home",
    async ({ request, set }) => {
      const data = await allmanga.parseHome(getBaseUrl(request));
      if ("error" in data) return err(set, 500, data.error as string);
      return ok(data);
    },
    {
      detail: { tags: ["manga"], summary: "AllManga Home" },
    },
  )

  .get(
    "/search",
    async ({ query, request, set }) => {
      const q = (query.q as string) || "";
      const page = parseInt(query.page as string) || 1;
      if (!q) return err(set, 400, "Query parameter 'q' is required");

      const data = await allmanga.parseSearch(q, getBaseUrl(request), page);
      if ("error" in data) return err(set, 500, data.error as string);
      return ok(data);
    },
    {
      detail: { tags: ["manga"], summary: "AllManga Search" },
    },
  )

  .get(
    "/latest",
    async ({ query, request, set }) => {
      const page = parseInt(query.page as string) || 1;
      const data = await allmanga.parseSearch("", getBaseUrl(request), page);
      if ("error" in data) return err(set, 500, data.error as string);
      return ok(data);
    },
    {
      detail: { tags: ["manga"], summary: "AllManga Latest Updates" },
    },
  )

  .get(
    "/popular",
    async ({ query, request, set }) => {
      const page = parseInt(query.page as string) || 1;
      const size = parseInt(query.size as string) || 20;
      const period = (query.period as string) || "daily";

      const data = await allmanga.parsePopular(getBaseUrl(request), page, size, period);
      if ("error" in data) return err(set, 500, data.error as string);
      return ok(data);
    },
    {
      detail: { tags: ["manga"], summary: "AllManga Popular (daily, weekly, monthly, all)" },
    },
  )

  .get(
    "/random",
    async ({ request, set }) => {
      const data = await allmanga.parseRandom(getBaseUrl(request));
      if ("error" in data) return err(set, 500, data.error as string);
      return ok(data);
    },
    {
      detail: { tags: ["manga"], summary: "AllManga Random Recommendations" },
    },
  )

  // ─── NEW: Tags/Genres Listing ──────────────────────────────────────────────
  .get(
    "/tags",
    async ({ set }) => {
      const data = await allmanga.parseTags();
      if ("error" in data) return err(set, 500, data.error as string);
      return ok(data);
    },
    {
      detail: { tags: ["manga"], summary: "AllManga List All Available Tags/Genres" },
    },
  )

  // ─── NEW: Search by Genre ──────────────────────────────────────────────────
  .get(
    "/genre/:genre",
    async ({ params, query, request, set }) => {
      const genre = decodeURIComponent(params.genre);
      const page = parseInt(query.page as string) || 1;

      const data = await allmanga.parseSearch("", getBaseUrl(request), page, { genres: [genre] });
      if ("error" in data) return err(set, 500, data.error as string);
      return ok(data);
    },
    {
      detail: { tags: ["manga"], summary: "AllManga Search By Genre Slug" },
    },
  )

  // ─── NEW: Search by Author ─────────────────────────────────────────────────
  .get(
    "/author/:author",
    async ({ params, query, request, set }) => {
      const author = decodeURIComponent(params.author);
      const page = parseInt(query.page as string) || 1;

      const data = await allmanga.parseSearch("", getBaseUrl(request), page, { authors: [author] });
      if ("error" in data) return err(set, 500, data.error as string);
      return ok(data);
    },
    {
      detail: { tags: ["manga"], summary: "AllManga Search By Author Slug" },
    },
  )

  .get(
    "/detail",
    async ({ query, request, set }) => {
      const id = query.id as string;
      if (!id) return err(set, 400, "Query parameter 'id' is required");

      const data = await allmanga.parseDetail(id, getBaseUrl(request));
      if ("error" in data) return err(set, 500, data.error as string);
      return ok(data);
    },
    {
      detail: { tags: ["manga"], summary: "AllManga Detail" },
    },
  )

  .get(
    "/read",
    async ({ query, request, set }) => {
      const id = query.id as string;
      if (!id) return err(set, 400, "Query parameter 'id' is required");

      const data = await allmanga.parseRead(id, getBaseUrl(request));
      if ("error" in data) return err(set, 500, data.error as string);
      return ok(data);
    },
    {
      detail: { tags: ["manga"], summary: "AllManga Read Chapter Pages" },
    },
  )

  .get(
    "/image/*",
    async ({ request, set }) => {
      try {
        const url = new URL(request.url);
        const imagePath = url.pathname.split("/image/")[1] + url.search;

        if (!imagePath) return err(set, 400, "Missing image path");

        const targetUrl = `https://${imagePath}`;
        const result = await allmanga.proxyImage(targetUrl);

        if (!result.success) {
          return err(set, result.status || 500, `Proxy failed: ${result.error}`);
        }

        set.headers["Content-Type"] = result.contentType;
        set.headers["Cache-Control"] = "public, max-age=86400";
        return result.content;
      } catch (e: any) {
        return err(set, 500, e.message);
      }
    },
    {
      detail: { tags: ["manga"], summary: "Image Proxy for Bypassing Restrictions" },
    },
  );
