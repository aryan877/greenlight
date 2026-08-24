import { describe, expect, it } from "vitest";

import {
  MEDIA_PROBE_TIMEOUT_MS,
  parseMediaMetadata,
  probeImportedMedia,
} from "../src/providers/media-metadata.js";

describe("media metadata", () => {
  it("keeps measured duration, dimensions, and codecs", () => {
    expect(
      parseMediaMetadata({
        format: { duration: "12.3456" },
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1920,
            height: 1080,
          },
          { codec_type: "audio", codec_name: "aac" },
        ],
      }),
    ).toEqual({
      duration_seconds: 12.346,
      width: 1920,
      height: 1080,
      video_codec: "h264",
      audio_codec: "aac",
    });
  });

  it("bounds media probing so an import cannot hang indefinitely", async () => {
    let timeout: number | undefined;
    const metadata = await probeImportedMedia(
      ".mp4",
      Uint8Array.from([0]),
      async (_executable, _arguments, options) => {
        timeout = options.timeout;
        return {
          stdout: JSON.stringify({
            format: { duration: "2.5" },
            streams: [{ codec_type: "video", codec_name: "h264" }],
          }),
        };
      },
    );

    expect(timeout).toBe(MEDIA_PROBE_TIMEOUT_MS);
    expect(metadata).toMatchObject({
      duration_seconds: 2.5,
      video_codec: "h264",
    });
  });
});
