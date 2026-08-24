import {
  applyEditorPatch,
  type ContentPackage,
  type EditorPatchInput,
} from "@greenlight/contracts";
import { describe, expect, it } from "vitest";

const scene = (id: string, title: string) => ({
  id,
  kind: "explanation" as const,
  title,
  narration: `${title} has enough narration to be useful.`,
  narration_artifact_id: null,
  captions_artifact_id: null,
  transcript_artifact_id: null,
  claim_ids: [],
  duration_seconds: 10,
  playback_rate: 1,
  visual: {
    treatment: "type" as const,
    prompt: null,
    artifact_ids: [],
    accent: "signal" as const,
  },
});

const base: ContentPackage = {
  version: 1,
  project_id: "project_001",
  headline: "The last responsible moment",
  dek: "A production about keeping a person at the consequential boundary.",
  scenes: [
    scene("scene_001", "First"),
    scene("scene_002", "Second"),
    scene("scene_003", "Third"),
  ],
  localized_narration_tracks: [],
  metadata: {
    title: "The last responsible moment",
    description: "A concise production about safe agent release controls.",
    tags: ["agents"],
    category_id: "28",
    made_for_kids: false,
    contains_synthetic_media: true,
  },
};

const patch = (
  operations: EditorPatchInput["operations"],
): EditorPatchInput => ({
  selection: {
    project_id: base.project_id,
    base_content_package_artifact_id: "artifact_base001",
    scene_ids: ["scene_002"],
    track_ids: ["visual"],
    artifact_ids: [],
    time_range_seconds: { start: 10, end: 20 },
  },
  instruction_summary: "Change only the selected scene",
  operations,
});

describe("applyEditorPatch", () => {
  it("changes only the selected scene", () => {
    const revised = applyEditorPatch(
      base,
      patch([
        {
          type: "update_scene",
          scene_id: "scene_002",
          title: "A safer second beat",
          visual: { accent: "ember" },
        },
      ]),
    );

    expect(revised.scenes[0]).toEqual(base.scenes[0]);
    expect(revised.scenes[1]!.title).toBe("A safer second beat");
    expect(revised.scenes[1]!.visual.accent).toBe("ember");
    expect(revised.scenes[2]).toEqual(base.scenes[2]);
  });

  it("rejects an edit outside the typed selection", () => {
    expect(() =>
      applyEditorPatch(
        base,
        patch([
          {
            type: "update_scene",
            scene_id: "scene_003",
            title: "Not selected",
          },
        ]),
      ),
    ).toThrow("scene_outside_selection:scene_003");
  });

  it("splits one selected scene without replacing the cut", () => {
    const revised = applyEditorPatch(
      base,
      patch([
        {
          type: "split_scene",
          scene_id: "scene_002",
          first: {
            ...scene("scene_002", "Second / setup"),
            duration_seconds: 5,
          },
          second: {
            ...scene("scene_004", "Second / reveal"),
            duration_seconds: 5,
          },
        },
      ]),
    );

    expect(revised.scenes.map(({ id }) => id)).toEqual([
      "scene_001",
      "scene_002",
      "scene_004",
      "scene_003",
    ]);
    expect(
      revised.scenes.reduce((sum, item) => sum + item.duration_seconds, 0),
    ).toBe(30);
  });
});
