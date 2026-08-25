import { describe, expect, it } from "vitest";

import {
  appendProducerReferences,
  removeProducerReference,
} from "./producer-references.js";

describe("Producer references", () => {
  it("appends new references in drag order across item and track kinds", () => {
    const references = appendProducerReferences(
      [
        { type: "item", id: "video_1" },
        { type: "item", id: "caption_1" },
      ],
      [
        { type: "track", id: "audio_track" },
        { type: "gap", id: "gap_scene_1" },
        { type: "item", id: "video_2" },
      ],
    );

    expect(references).toEqual([
      { type: "item", id: "video_1" },
      { type: "item", id: "caption_1" },
      { type: "track", id: "audio_track" },
      { type: "gap", id: "gap_scene_1" },
      { type: "item", id: "video_2" },
    ]);
  });

  it("does not duplicate a reference that is dragged twice", () => {
    expect(
      appendProducerReferences(
        [{ type: "item", id: "caption_1" }],
        [{ type: "item", id: "caption_1" }],
      ),
    ).toEqual([{ type: "item", id: "caption_1" }]);
  });

  it("removes only the requested reference", () => {
    expect(
      removeProducerReference(
        [
          { type: "item", id: "video_1" },
          { type: "item", id: "caption_1" },
          { type: "track", id: "audio_track" },
        ],
        { type: "item", id: "caption_1" },
      ),
    ).toEqual([
      { type: "item", id: "video_1" },
      { type: "track", id: "audio_track" },
    ]);
  });
});
