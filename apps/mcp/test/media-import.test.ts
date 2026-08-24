import { describe, expect, it } from "vitest";

import { inspectImportedMedia } from "../src/media-import.js";

describe("creator media import", () => {
  it("recognizes a real container and chooses its artifact kind", () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    expect(inspectImportedMedia("frame.PNG", png)).toEqual({
      extension: ".png",
      kind: "image",
      mimeType: "image/png",
    });
  });

  it("rejects renamed or executable content", () => {
    expect(() =>
      inspectImportedMedia(
        "not-a-video.mp4",
        new TextEncoder().encode("<script>alert(1)</script>"),
      ),
    ).toThrow("media_content_mismatch");
    expect(() =>
      inspectImportedMedia(
        "unsafe.svg",
        new TextEncoder().encode("<svg></svg>"),
      ),
    ).toThrow("unsupported_media_type");
  });

  it("accepts timed caption text as a caption artifact", () => {
    const vtt = new TextEncoder().encode(
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n",
    );
    expect(inspectImportedMedia("captions.vtt", vtt).kind).toBe("caption");
  });
});
