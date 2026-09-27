import { describe, expect, it } from "vitest";
import { livePageSource, pageContentUrl } from "./refresh-source.js";

const ld = (page: string, url: string) =>
  `<html><script type="application/ld+json">{"@type":"VideoObject","mainEntityOfPage":"${page}","contentUrl":"${url}"}</script></html>`;

describe("pageContentUrl", () => {
  const slug = "the-delivery-boy-is-a-racing-god";
  const url = "https://ns-aws-cdn.netshort.com/owJREAfFhImiZNQqmhqR1EElLaUvDfICwV1qfG?a=0&auth_key=1-2-0-3";

  it("reads this episode's own VideoObject link", () => {
    const html = ld(`https://narto-drama.com/detail/watch/${slug}/14?lang=en-US`, url);
    expect(pageContentUrl(html, slug, 14)).toBe(url);
  });

  it("refuses a page that names another episode", () => {
    const html = ld(`https://narto-drama.com/detail/watch/${slug}/13?lang=en-US`, url);
    expect(pageContentUrl(html, slug, 14)).toBeNull();
    // 14 must not match 140 either.
    const long = ld(`https://narto-drama.com/detail/watch/${slug}/140`, url);
    expect(pageContentUrl(long, slug, 14)).toBeNull();
  });

  it("unescapes JSON-escaped links", () => {
    const html = ld(
      `https:\/\/narto-drama.com\/detail\/watch\/${slug}\/14`,
      "https:\/\/cdn.x\/a?x=1\u0026y=2",
    );
    expect(pageContentUrl(html, slug, 14)).toBe("https://cdn.x/a?x=1&y=2");
  });

  it("is null with no structured data", () => {
    expect(pageContentUrl("<html></html>", slug, 14)).toBeNull();
  });
});

describe("livePageSource", () => {
  it("exists as the last rung before gone", () => {
    expect(typeof livePageSource).toBe("function");
  });
});
