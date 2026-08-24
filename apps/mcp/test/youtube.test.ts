import { describe, expect, it } from "vitest";

import { parseTrailingJson } from "../src/providers/youtube.js";

describe("YouTube uploader output", () => {
  it("parses JSON after resumable upload progress", () => {
    expect(
      parseTrailingJson<{ video_id: string }>(
        'Upload progress: 50%\nUpload progress: 100%\n{\n  "video_id": "abc123"\n}\n',
      ),
    ).toEqual({ video_id: "abc123" });
  });
});
