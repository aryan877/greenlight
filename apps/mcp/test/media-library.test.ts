import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertSafeRemoteMediaUrl,
  isPublicMediaAddress,
  MediaLibraryProvider,
  pinnedMediaRequestOptions,
} from "../src/providers/media-library.js";

const openverseResult = (input: {
  duration: number;
  id: string;
  license: string;
  title: string;
}) => ({
  id: input.id,
  title: input.title,
  creator: "Greenlight fixture",
  duration: input.duration,
  foreign_landing_url: `https://example.com/audio/${input.id}`,
  frontend_url: null,
  license: input.license,
  license_url: `https://creativecommons.org/publicdomain/zero/1.0/`,
  thumbnail: null,
  url: `https://cdn.example.com/${input.id}.mp3`,
});

const pexelsVideo = {
  id: 42,
  duration: 7,
  image: "https://images.pexels.com/videos/42/preview.jpg",
  url: "https://www.pexels.com/video/42/",
  width: 1920,
  height: 1080,
  user: { name: "Ada Editor" },
  video_files: [
    {
      id: 420,
      file_type: "video/mp4",
      width: 1920,
      height: 1080,
      link: "https://videos.pexels.com/video-files/42/42-hd.mp4",
    },
  ],
};

describe("MediaLibraryProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects private, reserved, and mapped network destinations", () => {
    expect(isPublicMediaAddress("8.8.8.8")).toBe(true);
    expect(isPublicMediaAddress("2606:4700:4700::1111")).toBe(true);
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.0.1",
      "100.64.0.1",
      "198.51.100.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
    ]) {
      expect(isPublicMediaAddress(address), address).toBe(false);
    }
  });

  it("rejects a literal private destination before any network request", async () => {
    await expect(
      assertSafeRemoteMediaUrl("https://127.0.0.1/private.mp4"),
    ).rejects.toThrow("media_download_host_not_allowed");
  });

  it("pins media downloads to the verified address while preserving TLS and Host", () => {
    expect(
      pinnedMediaRequestOptions({
        address: "203.0.113.9",
        family: 4,
        url: new URL("https://cdn.example.com:8443/audio/file.mp3?download=1"),
      }),
    ).toMatchObject({
      protocol: "https:",
      hostname: "203.0.113.9",
      port: "8443",
      path: "/audio/file.mp3?download=1",
      family: 4,
      headers: { Host: "cdn.example.com:8443" },
      servername: "cdn.example.com",
    });
  });

  it("normalizes Openverse milliseconds and rejects non-commercial licenses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            openverseResult({
              duration: 3_155,
              id: "commercial",
              license: "cc0",
              title: "Deep whoosh",
            }),
            openverseResult({
              duration: 8_000,
              id: "non-commercial",
              license: "by-nc",
              title: "Restricted whoosh",
            }),
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new MediaLibraryProvider({ pexelsApiKey: null });
    const results = await provider.search({
      query: "whoosh",
      use: "sound_effect",
      limit: 12,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      provider_asset_id: "commercial",
      duration_seconds: 3.155,
      license: "CC0",
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("license_type")).toBe("commercial");
    expect(url.searchParams.get("mature")).toBe("false");
  });

  it("maps keyed Pexels B-roll search without exposing the key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ videos: [pexelsVideo] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new MediaLibraryProvider({ pexelsApiKey: "test-key" });
    const results = await provider.search({
      query: "editing desk",
      use: "broll",
      orientation: "landscape",
      limit: 4,
    });

    expect(results).toEqual([
      expect.objectContaining({
        provider: "pexels",
        provider_asset_id: "42",
        use: "broll",
        duration_seconds: 7,
        creator: "Ada Editor",
        license: "Pexels License",
      }),
    ]);
    const [request, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(request.searchParams.get("query")).toBe("editing desk");
    expect(request.searchParams.get("orientation")).toBe("landscape");
    expect(request.pathname).toBe("/v1/videos/search");
    expect(init.headers).toEqual({ Authorization: "test-key" });
    expect(JSON.stringify(results)).not.toContain("test-key");
  });
});
