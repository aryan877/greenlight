import type { Artifact, ContentPackage } from "@greenlight/contracts";
import { describe, expect, it } from "vitest";

import {
  createSelection,
  sceneOffset,
  sceneTimelineDuration,
  totalDuration,
} from "./model.js";

const content: ContentPackage = {
  version: 1,
  project_id: "project_editor",
  headline: "A precise production",
  dek: "Selection keeps complete scene context together.",
  scenes: Array.from({ length: 20 }, (_, index) => ({
    id: `scene_${String(index).padStart(3, "0")}`,
    kind: index === 0 ? ("hook" as const) : ("explanation" as const),
    title: `Scene ${index + 1}`,
    narration: "One editable narration line.",
    narration_artifact_id: `voice_${String(index).padStart(3, "0")}`,
    captions_artifact_id: `caption_${String(index).padStart(3, "0")}`,
    transcript_artifact_id: `transcript_${String(index).padStart(3, "0")}`,
    claim_ids: index === 4 ? ["claim_004"] : [],
    duration_seconds: 2,
    playback_rate: 1,
    visual: {
      treatment: "openmoji" as const,
      prompt: null,
      artifact_ids: [`visual_${String(index).padStart(3, "0")}`],
      accent: "signal" as const,
    },
  })),
  localized_narration_tracks: [],
  metadata: {
    title: "A precise production",
    description: "Selection model fixture.",
    tags: ["editing"],
    category_id: "28",
    made_for_kids: false,
    contains_synthetic_media: true,
  },
};

const sourceLedger = {
  id: "artifact_sources",
  project_id: content.project_id,
  kind: "evidence_ledger",
  sha256: "a".repeat(64),
  relative_path: "project/sources.json",
  mime_type: "application/json",
  byte_size: 100,
  provenance: {},
  created_at: "2026-08-24T00:00:00.000Z",
} satisfies Artifact;

describe("editor selection", () => {
  it("tiles transition scenes without overlapping timeline clips", () => {
    const spans = content.scenes.map((_, index) => ({
      start: sceneOffset(content.scenes, index),
      duration: sceneTimelineDuration(content.scenes, index),
    }));

    for (let index = 1; index < spans.length; index += 1) {
      expect(spans[index]!.start).toBeCloseTo(
        spans[index - 1]!.start + spans[index - 1]!.duration,
        8,
      );
    }
    expect(spans.reduce((sum, span) => sum + span.duration, 0)).toBeCloseTo(
      totalDuration(content),
      8,
    );
  });

  it("keeps any-size ordered scene bundles and their typed artifacts", () => {
    const sceneIds = content.scenes.slice(3, 18).map((scene) => scene.id);
    const selection = createSelection({
      projectId: content.project_id,
      contentArtifactId: "artifact_content",
      content,
      sceneIds,
      sourceLedgerArtifact: sourceLedger,
      extraArtifactIds: ["artifact_local_clip"],
    });

    expect(selection.scene_ids).toEqual(sceneIds);
    expect(selection.scene_ids).toHaveLength(15);
    expect(selection.track_ids).toEqual([
      "visual",
      "voice",
      "caption",
      "transcript",
    ]);
    expect(selection.artifact_ids).toContain("transcript_004");
    expect(selection.artifact_ids).toContain(sourceLedger.id);
    expect(selection.artifact_ids).toContain("artifact_local_clip");
    expect(selection.time_range_seconds).not.toBeNull();
    expect(selection.time_range_seconds!.start).toBeCloseTo(5, 5);
    expect(selection.time_range_seconds!.end).toBeCloseTo(30.3333, 3);
  });
});
