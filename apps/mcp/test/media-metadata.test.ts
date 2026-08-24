import { describe, expect, it } from "vitest";

import { parseMediaMetadata } from "../src/providers/media-metadata.js";

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
});
