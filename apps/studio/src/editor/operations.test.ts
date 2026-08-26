import type {
  ContentPackage,
  EditorTimelineItemKind,
} from "@greenlight/contracts";
import { describe, expect, it } from "vitest";

import { timelineItems } from "./model.js";
import {
  buildBrollPlacementOperation,
  buildTimelineMovePlan,
  buildTimelineTrimPlan,
  maximumTimelineItemDuration,
} from "./operations.js";

const content = {
  version: 1,
  project_id: "project_operations",
  headline: "A precise editable timeline",
  dek: "Original media stays immutable while timeline items change.",
  scenes: [
    {
      id: "scene_first",
      kind: "hook",
      title: "First scene",
      narration: "The first narration clip.",
      narration_artifact_id: "artifact_voice_first",
      captions_artifact_id: "artifact_caption_first",
      transcript_artifact_id: "artifact_transcript_first",
      claim_ids: [],
      duration_seconds: 4,
      gap_after_seconds: 2,
      source_clip: {
        artifact_id: "artifact_source_first",
        in_seconds: 2,
        out_seconds: 6,
        source_duration_seconds: 12,
      },
      playback_rate: 1,
      visual: {
        treatment: "type",
        prompt: null,
        artifact_ids: [],
        accent: "signal",
      },
    },
    {
      id: "scene_second",
      kind: "explanation",
      title: "Second scene",
      narration: "The second narration clip.",
      narration_artifact_id: "artifact_voice_second",
      captions_artifact_id: "artifact_caption_second",
      transcript_artifact_id: "artifact_transcript_second",
      claim_ids: [],
      duration_seconds: 6,
      playback_rate: 1,
      visual: {
        treatment: "type",
        prompt: null,
        artifact_ids: [],
        accent: "signal",
      },
    },
    {
      id: "scene_third",
      kind: "resolution",
      title: "Third scene",
      narration: "The third narration clip.",
      narration_artifact_id: "artifact_voice_third",
      captions_artifact_id: "artifact_caption_third",
      transcript_artifact_id: "artifact_transcript_third",
      claim_ids: [],
      duration_seconds: 18,
      playback_rate: 1,
      visual: {
        treatment: "type",
        prompt: null,
        artifact_ids: [],
        accent: "signal",
      },
    },
  ],
  audio_tracks: [
    {
      id: "track_narration",
      name: "Narration",
      role: "narration",
      locale: "en",
      voice_label: null,
      muted: false,
      solo: false,
      export_enabled: true,
      gain: 1,
      clips: [
        {
          id: "clip_first_scene",
          scene_id: "scene_first",
          label: "First narration",
          artifact_id: "artifact_voice_first",
          script: "The first narration clip.",
          transcript_artifact_id: "artifact_transcript_first",
          captions_artifact_id: "artifact_caption_first",
          start_offset_seconds: 0,
          source_in_seconds: 3,
          source_out_seconds: 9,
          playback_rate: 1,
          status: "reviewed",
        },
      ],
    },
  ],
  localized_narration_tracks: [],
  release: {
    thumbnail_artifact_id: null,
    destination: "unlisted",
    publish_at: null,
  },
  metadata: {
    title: "A precise editable timeline",
    description: "Timeline operation fixture.",
    tags: ["editing"],
    category_id: "28",
    made_for_kids: false,
    contains_synthetic_media: true,
  },
} satisfies ContentPackage;

const item = (kind: EditorTimelineItemKind, sceneId = "scene_first") => {
  const match = timelineItems(content).find(
    (candidate) => candidate.kind === kind && candidate.scene_id === sceneId,
  );
  if (!match) throw new Error(`Missing ${kind} fixture item`);
  return match;
};

describe("timeline operations", () => {
  it("places licensed B-roll as an independent immutable-source clip", () => {
    expect(
      buildBrollPlacementOperation(content, {
        artifactId: "artifact_pexels_video",
        clipId: "clip_broll",
        durationSeconds: 3,
        label: "Editor at a desk",
        licenseArtifactId: "artifact_pexels_license",
        sceneId: "scene_second",
        sourceDurationSeconds: 7,
        startSeconds: 6,
      }),
    ).toEqual({
      type: "upsert_video_track",
      track: {
        id: "track_broll",
        name: "B-roll",
        kind: "video",
        protected: false,
        visible: true,
        clips: [
          {
            id: "clip_broll",
            scene_id: "scene_second",
            label: "Editor at a desk",
            artifact_id: "artifact_pexels_video",
            timeline_start_seconds: 6,
            source_in_seconds: 0,
            source_out_seconds: 3,
            source_duration_seconds: 7,
            duration_seconds: 3,
            playback_rate: 1,
            fit: "cover",
            opacity: 1,
            provenance_artifact_id: "artifact_pexels_license",
          },
        ],
      },
    });
  });

  it("moves only the timeline items the creator selected", () => {
    const video = item("video");
    const audio = item("audio");
    const caption = item("caption");
    const plan = buildTimelineMovePlan(content, {
      itemIds: [video.id, audio.id, caption.id],
      primaryItemId: video.id,
      deltaSeconds: 6,
      targetTrackId: video.track_id,
      dropIndex: 1,
    });

    expect(plan.sceneScope).toBe("all");
    expect(plan.operations).toEqual([
      {
        type: "reorder_scenes",
        scene_ids: ["scene_second", "scene_first", "scene_third"],
      },
      {
        type: "update_audio_clip",
        item_id: audio.id,
        clip_id: "clip_first_scene",
        target_track_id: "track_narration",
        timeline_start_seconds: 6,
      },
      {
        type: "update_caption_clip",
        item_id: caption.id,
        clip_id: "caption_scene_first",
        target_track_id: "track_captions",
        timeline_start_seconds: 6,
      },
    ]);
  });

  it("does not move audio or captions when only video is dragged", () => {
    const video = item("video");
    const plan = buildTimelineMovePlan(content, {
      itemIds: [video.id],
      primaryItemId: video.id,
      deltaSeconds: 6,
      targetTrackId: video.track_id,
      dropIndex: 1,
    });

    expect(plan.operations).toEqual([
      {
        type: "reorder_scenes",
        scene_ids: ["scene_second", "scene_first", "scene_third"],
      },
    ]);
  });

  it("moves selected audio and captions as exact independent items", () => {
    const audio = item("audio");
    const caption = item("caption");
    const plan = buildTimelineMovePlan(content, {
      itemIds: [audio.id, caption.id],
      primaryItemId: audio.id,
      deltaSeconds: 2,
      targetTrackId: audio.track_id,
      dropIndex: 0,
    });

    expect(plan.sceneScope).toBe("items");
    expect(plan.operations).toEqual([
      {
        type: "update_audio_clip",
        item_id: audio.id,
        clip_id: "clip_first_scene",
        target_track_id: "track_narration",
        timeline_start_seconds: 2,
      },
      {
        type: "update_caption_clip",
        item_id: caption.id,
        clip_id: "caption_scene_first",
        target_track_id: "track_captions",
        timeline_start_seconds: 2,
      },
    ]);
  });

  it("trims audio without changing its immutable source handles", () => {
    const audio = item("audio");
    const plan = buildTimelineTrimPlan(content, audio, 3);

    expect(plan).toEqual({
      sceneScope: "items",
      operations: [
        {
          type: "update_audio_clip",
          item_id: audio.id,
          clip_id: "clip_first_scene",
          duration_seconds: 3,
        },
      ],
    });
    expect(plan?.operations[0]).not.toHaveProperty("source_in_seconds");
    expect(plan?.operations[0]).not.toHaveProperty("source_out_seconds");
  });

  it("uses retained source media when a video is extended into a gap", () => {
    const video = item("video");

    expect(maximumTimelineItemDuration(content, video)).toBe(6);
    expect(buildTimelineTrimPlan(content, video, 5)).toEqual({
      sceneScope: "all",
      operations: [
        {
          type: "update_scene",
          scene_id: "scene_first",
          duration_seconds: 5,
          gap_after_seconds: 1,
          source_clip: {
            artifact_id: "artifact_source_first",
            in_seconds: 2,
            out_seconds: 7,
            source_duration_seconds: 12,
          },
        },
      ],
    });
  });
});
