import {
  applyEditorPatch,
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
        id: "track_primary_voice",
        name: "Primary voice",
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
      "track_primary_voice",
      "track_hindi_dub",
    ]);
    expect(revised.audio_tracks?.[0]?.clips).toHaveLength(3);
    expect(revised.audio_tracks?.[1]?.clips[0]?.scene_id).toBe("scene_002");
  });
});
