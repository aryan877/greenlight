import {
  audioTimelineItemId,
  applyEditorPatch,
  captionTimelineItemId,
  sceneStartSeconds,
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
  release: {
    thumbnail_artifact_id: null,
    destination: "unlisted",
    publish_at: null,
  },
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
    item_ids: [],
    scene_ids: ["scene_002"],
    track_ids: ["visual", "voice", "caption", "transcript"],
    artifact_ids: [],
    playhead_seconds: 10,
    time_range_seconds: {
      start: sceneStartSeconds(base.scenes, 1),
      end: sceneStartSeconds(base.scenes, 1) + base.scenes[1]!.duration_seconds,
    },
  },
  instruction_summary: "Change only the selected scene",
  operations,
});

describe("applyEditorPatch", () => {
  it("updates YouTube packaging through the release track", () => {
    const revised = applyEditorPatch(base, {
      selection: {
        project_id: base.project_id,
        base_content_package_artifact_id: "artifact_base001",
        item_ids: [],
        scene_ids: [],
        track_ids: ["release"],
        artifact_ids: [],
        playhead_seconds: 0,
        time_range_seconds: null,
      },
      instruction_summary: "Prepare an unlisted YouTube release",
      operations: [
        {
          type: "update_release",
          metadata: { title: "A sharper YouTube title" },
          release: { destination: "public" },
        },
      ],
    });

    expect(revised.metadata.title).toBe("A sharper YouTube title");
    expect(revised.release.destination).toBe("public");
    expect(revised.scenes).toEqual(base.scenes);
  });

  it("rejects release changes outside the release track", () => {
    expect(() =>
      applyEditorPatch(
        base,
        patch([
          {
            type: "update_release",
            metadata: { title: "Not in scope" },
          },
        ]),
      ),
    ).toThrow("track_outside_selection:release");
  });

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

  it("rejects a voice edit when only the visual track is selected", () => {
    const scoped = patch([
      {
        type: "update_scene",
        scene_id: "scene_002",
        narration: "A changed voice track must be explicitly selected.",
      },
    ]);
    scoped.selection.track_ids = ["visual"];

    expect(() => applyEditorPatch(base, scoped)).toThrow(
      "track_outside_selection:voice",
    );
  });

  it("splits one selected scene without replacing the cut", () => {
    const withAudio = structuredClone(base);
    withAudio.audio_tracks = [
      {
        id: "track_narration",
        name: "Narration",
        role: "narration",
        locale: "en",
        voice_label: "Kore",
        muted: false,
        solo: false,
        export_enabled: true,
        gain: 1,
        clips: [
          {
            id: "clip_scene_002",
            scene_id: "scene_002",
            label: "Second",
            artifact_id: null,
            script: "Second has enough narration to be useful.",
            transcript_artifact_id: null,
            captions_artifact_id: null,
            start_offset_seconds: 0,
            source_in_seconds: 0,
            source_out_seconds: 10,
            playback_rate: 1,
            status: "draft",
          },
        ],
      },
    ];
    const revised = applyEditorPatch(
      withAudio,
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
    expect(revised.audio_tracks?.[0]?.clips).toMatchObject([
      {
        id: "clip_scene_002",
        scene_id: "scene_002",
        source_in_seconds: 0,
        source_out_seconds: 5,
      },
      {
        scene_id: "scene_004",
        source_in_seconds: 5,
        source_out_seconds: 10,
      },
    ]);
  });

  it("records a real gap when a scene is shortened", () => {
    const revised = applyEditorPatch(
      base,
      patch([
        {
          type: "update_scene",
          scene_id: "scene_002",
          duration_seconds: 8,
          gap_after_seconds: 2,
        },
      ]),
    );

    expect(revised.scenes[1]!.duration_seconds).toBe(8);
    expect(revised.scenes[1]!.gap_after_seconds).toBe(2);
    expect(sceneStartSeconds(revised.scenes, 2)).toBe(20);
  });

  it("preserves removed time as a gap when a trim does not request a ripple", () => {
    const revised = applyEditorPatch(
      base,
      patch([
        {
          type: "update_scene",
          scene_id: "scene_002",
          duration_seconds: 8,
        },
      ]),
    );

    expect(revised.scenes[1]!.gap_after_seconds).toBe(2);
    expect(sceneStartSeconds(revised.scenes, 2)).toBe(20);
  });

  it("rejects a split that silently removes source time", () => {
    expect(() =>
      applyEditorPatch(
        base,
        patch([
          {
            type: "split_scene",
            scene_id: "scene_002",
            first: {
              ...scene("scene_002", "Second / setup"),
              duration_seconds: 4,
            },
            second: {
              ...scene("scene_004", "Second / reveal"),
              duration_seconds: 5,
            },
          },
        ]),
      ),
    ).toThrow("split_scene_must_preserve_duration");
  });

  it("extends only into a gap when measured source frames exist", () => {
    const sourced = structuredClone(base);
    sourced.scenes[1] = {
      ...sourced.scenes[1]!,
      gap_after_seconds: 2,
      visual: {
        ...sourced.scenes[1]!.visual,
        artifact_ids: ["artifact_source_video"],
      },
      source_clip: {
        artifact_id: "artifact_source_video",
        in_seconds: 0,
        out_seconds: 10,
        source_duration_seconds: 20,
      },
    };
    const request = patch([
      {
        type: "update_scene",
        scene_id: "scene_002",
        duration_seconds: 12,
        gap_after_seconds: 0,
        source_clip: {
          artifact_id: "artifact_source_video",
          in_seconds: 0,
          out_seconds: 12,
          source_duration_seconds: 20,
        },
      },
    ]);
    const revised = applyEditorPatch(sourced, request);

    expect(revised.scenes[1]!.duration_seconds).toBe(12);
    expect(revised.scenes[1]!.gap_after_seconds).toBe(0);
    expect(() =>
      applyEditorPatch(
        base,
        patch([
          {
            type: "update_scene",
            scene_id: "scene_002",
            duration_seconds: 12,
          },
        ]),
      ),
    ).toThrow("scene_extension_has_no_source");
  });

  it("rate-stretches the selected scene and ripples later scenes", () => {
    const revised = applyEditorPatch(
      base,
      patch([
        {
          type: "update_scene",
          scene_id: "scene_002",
          playback_rate: 0.5,
          duration_seconds: 20,
          gap_after_seconds: 0,
        },
      ]),
    );

    expect(revised.scenes[1]!.playback_rate).toBe(0.5);
    expect(revised.scenes[1]!.duration_seconds).toBe(20);
    expect(sceneStartSeconds(revised.scenes, 2)).toBe(30);
  });

  it("materializes legacy narration before adding a scene-sized dub track", () => {
    const revised = applyEditorPatch(
      base,
      patch([
        {
          type: "upsert_audio_track",
          track: {
            id: "track_hindi_dub",
            name: "Hindi dub",
            role: "dub",
            locale: "hi-IN",
            voice_label: "Kore",
            muted: false,
            solo: false,
            export_enabled: true,
            gain: 1,
            clips: [
              {
                id: "clip_hindi_second",
                scene_id: "scene_002",
                label: "Second scene in Hindi",
                artifact_id: null,
                script: "यह दूसरा दृश्य है।",
                transcript_artifact_id: null,
                captions_artifact_id: null,
                start_offset_seconds: 0,
                source_in_seconds: 0,
                source_out_seconds: null,
                playback_rate: 1,
                status: "draft",
              },
            ],
          },
        },
      ]),
    );

    expect(revised.audio_tracks?.map((track) => track.id)).toEqual([
      "track_narration",
      "track_hindi_dub",
    ]);
    expect(revised.audio_tracks?.[0]?.clips).toHaveLength(3);
    expect(revised.audio_tracks?.[1]?.clips[0]?.scene_id).toBe("scene_002");
  });

  it("adds and removes empty creator tracks without touching the starter tracks", () => {
    const withTracks = applyEditorPatch(
      base,
      patch([
        {
          type: "upsert_video_track",
          track: {
            id: "track_video_broll",
            name: "B-roll",
            kind: "video",
            protected: false,
          },
        },
        {
          type: "upsert_caption_track",
          track: {
            id: "track_captions_hindi",
            name: "Hindi captions",
            kind: "caption",
            protected: false,
          },
        },
      ]),
    );

    expect(withTracks.video_tracks?.map((track) => track.id)).toEqual([
      "track_video",
      "track_video_broll",
    ]);
    expect(withTracks.caption_tracks?.map((track) => track.id)).toEqual([
      "track_captions",
      "track_captions_hindi",
    ]);

    const withoutTracks = applyEditorPatch(
      withTracks,
      patch([
        { type: "remove_video_track", track_id: "track_video_broll" },
        {
          type: "remove_caption_track",
          track_id: "track_captions_hindi",
        },
      ]),
    );
    expect(withoutTracks.video_tracks?.map((track) => track.id)).toEqual([
      "track_video",
    ]);
    expect(withoutTracks.caption_tracks?.map((track) => track.id)).toEqual([
      "track_captions",
    ]);
  });

  it("never removes the starter narration track", () => {
    expect(() =>
      applyEditorPatch(
        base,
        patch([{ type: "remove_audio_track", track_id: "track_narration" }]),
      ),
    ).toThrow("protected_track");
  });

  it("persists one exact lane order for direct and Producer edits", () => {
    const reordered = applyEditorPatch(base, {
      selection: {
        project_id: base.project_id,
        base_content_package_artifact_id: "artifact_base001",
        item_ids: [],
        scene_ids: [],
        track_ids: ["track_video", "track_narration", "track_captions"],
        artifact_ids: [],
        playhead_seconds: 0,
        time_range_seconds: null,
      },
      instruction_summary: "Move captions above narration",
      operations: [
        {
          type: "reorder_tracks",
          track_ids: ["track_video", "track_captions", "track_narration"],
        },
      ],
    });

    expect(reordered.track_order).toEqual([
      "track_video",
      "track_captions",
      "track_narration",
    ]);
  });

  it("moves one exact audio clip without changing its immutable source range", () => {
    const withAudio = structuredClone(base);
    withAudio.audio_tracks = [
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
            id: "clip_scene_002",
            scene_id: "scene_002",
            label: "Second narration",
            artifact_id: null,
            script: "Second has enough narration to be useful.",
            transcript_artifact_id: null,
            captions_artifact_id: null,
            start_offset_seconds: 0,
            source_in_seconds: 0,
            source_out_seconds: 10,
            playback_rate: 1,
            status: "draft",
          },
        ],
      },
      {
        id: "track_music",
        name: "Music",
        role: "music",
        locale: null,
        voice_label: null,
        muted: false,
        solo: false,
        export_enabled: true,
        gain: 1,
        clips: [],
      },
    ];
    const itemId = audioTimelineItemId("clip_scene_002");
    const revised = applyEditorPatch(withAudio, {
      selection: {
        project_id: base.project_id,
        base_content_package_artifact_id: "artifact_base001",
        item_ids: [itemId],
        scene_ids: ["scene_002"],
        track_ids: ["voice", "track_narration"],
        artifact_ids: [],
        playhead_seconds: 10,
        time_range_seconds: { start: 10, end: 20 },
      },
      instruction_summary: "Move one narration clip to Music",
      operations: [
        {
          type: "update_audio_clip",
          item_id: itemId,
          clip_id: "clip_scene_002",
          target_track_id: "track_music",
          timeline_start_seconds: 12,
        },
      ],
    });

    expect(revised.audio_tracks?.[0]?.clips).toEqual([]);
    expect(revised.audio_tracks?.[1]?.clips[0]).toMatchObject({
      id: "clip_scene_002",
      timeline_start_seconds: 12,
      source_in_seconds: 0,
      source_out_seconds: 10,
    });
  });

  it("trims audio non-destructively and rejects a mismatched item ID", () => {
    const withAudio = structuredClone(base);
    withAudio.audio_tracks = [
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
            id: "clip_scene_002",
            scene_id: "scene_002",
            label: "Second narration",
            artifact_id: null,
            script: "Second has enough narration to be useful.",
            transcript_artifact_id: null,
            captions_artifact_id: null,
            start_offset_seconds: 0,
            source_in_seconds: 2,
            source_out_seconds: 12,
            playback_rate: 1,
            status: "draft",
          },
        ],
      },
    ];
    const itemId = audioTimelineItemId("clip_scene_002");
    const request = {
      selection: {
        project_id: base.project_id,
        base_content_package_artifact_id: "artifact_base001",
        item_ids: [itemId],
        scene_ids: ["scene_002"],
        track_ids: ["voice", "track_narration"],
        artifact_ids: [],
        playhead_seconds: 10,
        time_range_seconds: { start: 10, end: 20 },
      },
      instruction_summary: "Trim narration without touching its source",
      operations: [
        {
          type: "update_audio_clip" as const,
          item_id: itemId,
          clip_id: "clip_scene_002",
          duration_seconds: 4,
        },
      ],
    };
    const revised = applyEditorPatch(withAudio, request);
    expect(revised.audio_tracks?.[0]?.clips[0]).toMatchObject({
      duration_seconds: 4,
      source_in_seconds: 2,
      source_out_seconds: 12,
    });

    request.operations[0]!.item_id = captionTimelineItemId("scene_002");
    request.selection.item_ids = [captionTimelineItemId("scene_002")];
    expect(() => applyEditorPatch(withAudio, request)).toThrow(
      "audio_item_clip_mismatch",
    );
  });

  it("moves and trims one exact caption clip", () => {
    const itemId = captionTimelineItemId("scene_002");
    const revised = applyEditorPatch(base, {
      selection: {
        project_id: base.project_id,
        base_content_package_artifact_id: "artifact_base001",
        item_ids: [itemId],
        scene_ids: ["scene_002"],
        track_ids: ["caption", "track_captions"],
        artifact_ids: [],
        playhead_seconds: 10,
        time_range_seconds: { start: 10, end: 20 },
      },
      instruction_summary: "Move and trim one caption clip",
      operations: [
        {
          type: "update_caption_clip",
          item_id: itemId,
          scene_id: "scene_002",
          timeline_start_seconds: 14,
          duration_seconds: 4,
        },
      ],
    });

    expect(revised.scenes[1]).toMatchObject({
      caption_timeline_start_seconds: 14,
      caption_duration_seconds: 4,
    });
    expect(revised.scenes[1]!.duration_seconds).toBe(10);
  });
});
