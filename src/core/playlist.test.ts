import { describe, expect, it } from "vitest";
import { isPlaylist, proxifyPlaylist } from "./playlist.js";

const ORIGIN = "https://api.example.com";
const BASE = "https://cdn.example.top/anime/abc/index-new-f1.m3u8";

const route = (line: string) => line.match(/\/proxy\/([a-z0-9-]+)\?/)?.[1];
const upstream = (line: string) => decodeURIComponent(line.match(/url=([^&"]+)/)![1]);

describe("proxifyPlaylist — media playlist", () => {
  // The exact shape seen on the anime CDNs: 8 rotating fake extensions.
  const exts = ["jpg", "html", "js", "css", "txt", "png", "webp", "ico"];
  const media =
    "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n" +
    exts.map((e, i) => `#EXTINF:4.004000,\nseg-new-f1-0000${i}.${e}`).join("\n") +
    "\n#EXT-X-ENDLIST\n";

  const out = proxifyPlaylist(media, { url: BASE, origin: ORIGIN });
  const uriLines = out.split("\n").filter((l) => l && !l.startsWith("#"));

  it("routes EVERY segment to ts-segment regardless of its fake extension", () => {
    expect(uriLines).toHaveLength(8);
    for (const l of uriLines) expect(route(l)).toBe("ts-segment");
  });

  it("the .txt segment (every 8th, index 4) is a segment, not a playlist", () => {
    expect(upstream(uriLines[4])).toBe("https://cdn.example.top/anime/abc/seg-new-f1-00004.txt");
    expect(route(uriLines[4])).toBe("ts-segment");
  });

  it("resolves relative URIs against the playlist URL and keeps tags intact", () => {
    expect(upstream(uriLines[0])).toBe("https://cdn.example.top/anime/abc/seg-new-f1-00000.jpg");
    expect(out).toContain("#EXT-X-TARGETDURATION:4");
    expect(out).toContain("#EXT-X-ENDLIST");
  });

  it("forwards the headers param on every link", () => {
    const h = JSON.stringify({ Referer: "https://player.example/" });
    const withHeaders = proxifyPlaylist(media, { url: BASE, origin: ORIGIN, headers: h });
    for (const l of withHeaders.split("\n").filter((l) => l && !l.startsWith("#"))) {
      expect(l).toContain(`&headers=${encodeURIComponent(h)}`);
    }
    expect(out).not.toContain("&headers=");
  });

  it("routes #EXT-X-KEY URIs through fetch and #EXT-X-MAP through ts-segment", () => {
    const withKey =
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="enc.key",IV=0x1\n#EXT-X-MAP:URI="init.txt"\n#EXTINF:4,\nseg0.txt\n';
    const o = proxifyPlaylist(withKey, { url: BASE, origin: ORIGIN });
    const [, key, map, , seg] = o.split("\n");
    expect(route(key)).toBe("fetch");
    expect(upstream(key)).toBe("https://cdn.example.top/anime/abc/enc.key");
    expect(route(map)).toBe("ts-segment");
    expect(route(seg)).toBe("ts-segment");
  });
});

describe("proxifyPlaylist — master playlist", () => {
  const master =
    "#EXTM3U\n" +
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="jp",URI="audio/jp.txt"\n' +
    "#EXT-X-STREAM-INF:BANDWIDTH=1066932,RESOLUTION=1404x1080\nindex-f1-v1-a1.m3u8\n" +
    "#EXT-X-STREAM-INF:BANDWIDTH=678991,RESOLUTION=936x720\nvariant720.txt\n";

  it("routes variant lines to m3u8-proxy even without a .m3u8 extension", () => {
    const o = proxifyPlaylist(master, { url: BASE, origin: ORIGIN });
    const lines = o.split("\n");
    expect(route(lines[3])).toBe("m3u8-proxy");
    expect(route(lines[5])).toBe("m3u8-proxy");
    expect(upstream(lines[5])).toBe("https://cdn.example.top/anime/abc/variant720.txt");
  });

  it("routes #EXT-X-MEDIA rendition URIs to m3u8-proxy", () => {
    const o = proxifyPlaylist(master, { url: BASE, origin: ORIGIN });
    expect(route(o.split("\n")[1])).toBe("m3u8-proxy");
  });
});

describe("isPlaylist", () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it("accepts the M3U8 magic, with BOM or leading whitespace", () => {
    expect(isPlaylist(enc("#EXTM3U\n#EXTINF:4,\nx.ts"))).toBe(true);
    expect(isPlaylist(enc("﻿#EXTM3U\n"))).toBe(true);
    expect(isPlaylist(enc("\r\n  #EXTM3U"))).toBe(true);
  });

  it("rejects MPEG-TS bytes and other non-playlist bodies", () => {
    const ts = new Uint8Array(376);
    ts[0] = 0x47;
    ts[188] = 0x47;
    expect(isPlaylist(ts)).toBe(false);
    expect(isPlaylist(enc("https://api.example.com/proxy/ts-segment?url=..."))).toBe(false);
    expect(isPlaylist(enc(""))).toBe(false);
    expect(isPlaylist(enc("#EXTM3"))).toBe(false);
  });
});
