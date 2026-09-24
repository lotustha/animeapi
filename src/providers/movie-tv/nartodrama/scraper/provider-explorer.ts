import { Logger } from "../../../../core/logger.js";
import { nartodrama } from "../../../origins.js";
import { providerSectionsSchema } from "../types.js";
import { LANG, UA } from "./refresh-source.js";
import { browserCheckCookie } from "./browser-check.js";
import { collectTabPages } from "./catalogue-pages.js";

import type { ProviderCatalogue, ProviderItem, ProviderSection } from "../types.js";

const SECTIONS_URL = `${nartodrama}/home/providers/sections`;

/**
 * Fetch one upstream provider's catalogue.
 *
 * Omitting `provider` returns the site default (whichever app is currently
 * promoted) plus the full provider roster, so it doubles as the provider list.
 */
export async function fetchProviderSections(
  provider?: string,
  lang: string = LANG,
  tabPage?: { tab: string; page: number },
): Promise<ProviderCatalogue | null> {
  try {
    const url = new URL(SECTIONS_URL);
    if (provider) url.searchParams.set("provider", provider);
    // How narto's own page loads more of one tab (see catalogue-pages.ts).
    if (tabPage) {
      url.searchParams.set("only_tab", tabPage.tab);
      url.searchParams.set(`tab_pages[${tabPage.tab}]`, String(tabPage.page));
    }
    // Without this the endpoint answers in whatever language upstream guessed
    // from the server's IP - the reason imported catalogues came back French.
    //
    // Per request rather than pinned to LANG: a caller asking for one locale
    // and silently getting another is the whole class of bug this parameter
    // exists to close. LANG remains the default for callers that have no
    // opinion.
    url.searchParams.set("lang", lang);

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        Referer: nartodrama + "/",
        Cookie: browserCheckCookie(),
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
 * A provider's WHOLE catalogue: every tab, every page. [fetchProviderSections]
 * alone returns page 1 of each tab, 24 titles. Sequential and paced: this is
 * narto, which also serves every viewer's stream.
 */
export async function fetchFullProviderCatalogue(
  provider: string,
  lang: string = LANG,
  { maxPages = 40, pauseMs = 800 }: { maxPages?: number; pauseMs?: number } = {},
): Promise<ProviderCatalogue | null> {
  const first = await fetchProviderSections(provider, lang);
  if (!first) return null;
  const sections: ProviderSection[] = [];
  for (const section of first.sections) {
    const items = await collectTabPages(
      section.items,
      async (page) => {
        const next = await fetchProviderSections(provider, lang, { tab: section.key, page });
        if (!next) throw new Error("page failed");
        return next.sections.find((s) => s.key === section.key)?.items ?? [];
      },
      { maxPages, pauseMs },
    );
    sections.push({ ...section, items });
  }
  return { ...first, sections };
}

const MAX_HOPS = 4;

/**
 * Turn a provider catalogue entry into a local slug.
 *
 * Provider items are addressed by `provider` + `book_id`, not by slug — the
 * site's /search/import route redirects to the real /detail/watch/<slug>,
 * which is what info() and watch() need.
 *
 * The resolved slug is identical in every locale (`lang` only changes how the
 * page renders), so a series keeps its identity whatever language it was
 * imported under.
 */
export async function resolveImportSlug(
  provider: string,
  bookId: string,
  lang: string = LANG,
): Promise<string | null> {
  try {
    const url = new URL(`${nartodrama}/search/import`);
    url.searchParams.set("provider", provider);
    url.searchParams.set("book_id", bookId);
    // The book's own locale. Pinned to en-US, a German catalogue's book id was
    // resolved as if it were English, the one mapping that must not guess.
    url.searchParams.set("lang", lang);
    url.searchParams.set("target_lang", lang);

    // TWO hops are needed: /search/import first 302s to an intermediate
    // /detail/dummy/<provider>/<bookId>/<ep>, and only that one answers with
    // the slug. Reading a single manual redirect always came back empty, which
    // silently broke importing anything found through a provider catalogue.
    // Hops are followed by hand rather than with `redirect: "follow"` so the
    // final HTML body is never downloaded - only headers are needed.
    let next: string | null = url.toString();

    for (let hop = 0; hop < MAX_HOPS && next; hop++) {
      const res: Response = await fetch(next, {
        redirect: "manual",
        headers: { "User-Agent": UA, Accept: "text/html", Cookie: browserCheckCookie() },
      });

      const location: string = res.headers.get("location") || "";
      if (!location) break;

      const slug = location.match(/\/detail\/watch\/([^/?#]+)/)?.[1];
      if (slug) return slug;

      // Relative Location headers are legal; resolve against the hop we made.
      next = new URL(location, next).toString();
    }

    Logger.warn(`nartodrama: could not resolve ${provider}/${bookId} to a slug`);
    return null;
  } catch (err) {
    Logger.error(err);
    return null;
  }
}
