import { Logger } from "../../../../core/logger.js";
import { nartodrama } from "../../../origins.js";
import { providerSectionsSchema } from "../types.js";
import { UA } from "./refresh-source.js";

import type { ProviderCatalogue, ProviderItem, ProviderSection } from "../types.js";

const SECTIONS_URL = `${nartodrama}/home/providers/sections`;

/**
 * Fetch one upstream provider's catalogue.
 *
 * Omitting `provider` returns the site default (whichever app is currently
 * promoted) plus the full provider roster, so it doubles as the provider list.
 */
export async function fetchProviderSections(provider?: string): Promise<ProviderCatalogue | null> {
  try {
    const url = new URL(SECTIONS_URL);
    if (provider) url.searchParams.set("provider", provider);

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        Referer: nartodrama + "/",
      },
    });
    if (!res.ok) return null;

    const parsed = providerSectionsSchema.safeParse(await res.json());
    if (!parsed.success) {
      Logger.warn("nartodrama: provider sections schema mismatch");
      return null;
    }

    const data = parsed.data;
    const active = data.active_provider || provider || "";

    const sections: ProviderSection[] = data.sections.map((section) => ({
      key: section.tab_key,
      label: section.tab_label || section.tab_key,
      page: section.page ?? 1,
      items: section.items.map(
        (item): ProviderItem => ({
          bookId: item.book_id,
          title: item.title,
          description: item.description || "",
          poster: item.poster_url?.startsWith("http")
            ? item.poster_url
            : item.poster_url
              ? nartodrama + item.poster_url
              : "",
          provider: active,
          isAdult: item.is_adult === true,
          tags: item.tag_names,
        }),
      ),
    }));

    return { provider: active, providers: data.providers, sections };
  } catch (err) {
    Logger.error(err);
    return null;
  }
}

/**
 * Turn a provider catalogue entry into a local slug.
 *
 * Provider items are addressed by `provider` + `book_id`, not by slug — the
 * site's /search/import route 302s to the real /detail/watch/<slug>, which is
 * what info() and watch() need. Only the redirect is read; the body is not
 * followed, so this stays a single cheap request.
 */
export async function resolveImportSlug(provider: string, bookId: string): Promise<string | null> {
  try {
    const url = new URL(`${nartodrama}/search/import`);
    url.searchParams.set("provider", provider);
    url.searchParams.set("book_id", bookId);
    url.searchParams.set("lang", "en-US");
    url.searchParams.set("target_lang", "en-US");

    const res = await fetch(url.toString(), {
      redirect: "manual",
      headers: { "User-Agent": UA, Accept: "text/html" },
    });

    const location = res.headers.get("location") || "";
    const slug = location.match(/\/detail\/watch\/([^/?#]+)/)?.[1];
    return slug ?? null;
  } catch (err) {
    Logger.error(err);
    return null;
  }
}
