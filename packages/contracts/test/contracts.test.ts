import { describe, expect, it } from "vitest";

import {
  applyEditorPatch,
  audibleAudioTracks,
  captionArtifactIdForTimelineClip,
  captionTrackSchema,
  contentPackageSchema,
  editorPatchInputSchema,
  editorTimelineItemSchema,
  effectiveAudioTracks,
  effectiveCaptionTracks,
  evidenceLedgerSchema,
  isYoutubeReviewPrivacy,
  productionDurationSeconds,
  productionPlanInputSchema,
  projectBriefSchema,
  sceneStartSeconds,
  videoTimelineItemId,
} from "../src/index.js";

describe("Greenlight contracts", () => {
  it("uses one edge-to-edge clock and records only explicit gaps", () => {
    const scenes = [
      { duration_seconds: 8 },
      { duration_seconds: 7, gap_after_seconds: 2 },
      { duration_seconds: 6 },
    ];
    expect(sceneStartSeconds(scenes, 1)).toBe(8);
    expect(sceneStartSeconds(scenes, 2)).toBe(17);
    expect(productionDurationSeconds(scenes)).toBe(23);
  });

  it("applies safe brief defaults", () => {
    const brief = projectBriefSchema.parse({
      topic: "Why agent approvals matter",
      audience: "software builders",
      goal: "Explain the last responsible moment",
    });

    expect(brief.target_duration_seconds).toBe(60);
    expect(brief.tone).toContain("curious");
  });

  it("keeps production plans concise with one active step", () => {
    expect(
      productionPlanInputSchema.parse({
        plan_id: "phone_explainer",
        steps: [
          { id: "research", label: "Research the topic", status: "completed" },
          { id: "edit", label: "Build the first cut", status: "in_progress" },
          { id: "review", label: "Render and check", status: "pending" },
        ],
      }).title,
    ).toBe("Production plan");

    expect(
      productionPlanInputSchema.safeParse({
        plan_id: "phone_explainer",
        steps: [
          {
            id: "research",
            label: "Research the topic",
            status: "in_progress",
          },
          { id: "edit", label: "Build the first cut", status: "in_progress" },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts only safe YouTube review privacy states", () => {
    expect(isYoutubeReviewPrivacy("private")).toBe(true);
    expect(isYoutubeReviewPrivacy("unlisted")).toBe(true);
    expect(isYoutubeReviewPrivacy("public")).toBe(false);
  });

  it("rejects claims that cite missing sources", () => {
    const parsed = evidenceLedgerSchema.safeParse({
      project_id: "project_001",
      sources: [
        {
          id: "source_001",
          url: "https://example.com/source",
          title: "A source",
          publisher: "Example",
          accessed_at: "2026-08-24T07:00:00.000Z",
          excerpt: "Evidence",
        },
      ],
      claims: [
        {
          id: "claim_001",
          text: "A claim with a broken citation",
          source_ids: ["source_missing"],
          status: "supported",
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects timelines outside the short-video window", () => {
    const parsed = contentPackageSchema.safeParse({
      version: 1,
      project_id: "project_001",
      headline: "Approval is the product",
      dek: "The moment a safe agent hands control back to you.",
      scenes: Array.from({ length: 3 }, (_, index) => ({
        id: `scene_00${index}`,
        kind: index === 0 ? "hook" : "explanation",
        title: `Scene ${index}`,
        narration: "A short line.",
        claim_ids: [],
        duration_seconds: 2,
        visual: { treatment: "type", accent: "signal" },
      })),
      metadata: {
        title: "Approval is the product",
        description: "A concise description.",
        tags: ["agents"],
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects transitions with dangling or nonadjacent video endpoints", () => {
    const base = {
      version: 1,
      project_id: "project_transition_validation",
      headline: "Transitions belong to real cuts",
      dek: "Every transition keeps exact references to both neighboring clips.",
      scenes: ["one", "two", "three"].map((id, index) => ({
        id: `scene_${id}`,
        kind: index === 0 ? "hook" : "explanation",
        title: `Scene ${id}`,
        narration: `Narration for scene ${id}.`,
        claim_ids: [],
        duration_seconds: 10,
        visual: { treatment: "type", accent: "signal" },
      })),
      metadata: {
        title: "Transitions belong to real cuts",
        description: "Transition endpoint validation fixture.",
        tags: ["editing"],
      },
    };
    const transition = {
      id: "clip_transition_invalid",
      label: "Crossfade",
      from_item_id: videoTimelineItemId("scene_one"),
      to_item_id: videoTimelineItemId("scene_missing"),
      cut_seconds: 10,
      duration_seconds: 0.4,
      preset_id: "crossfade",
      parameters: {},
      sound_artifact_id: null,
    };
    const withTransition = (clip: typeof transition) => ({
      ...base,
      transition_tracks: [
        {
          id: "track_transitions",
          name: "Transitions",
          kind: "transition",
          visible: true,
          clips: [clip],
        },
      ],
    });

    expect(
      contentPackageSchema.safeParse(withTransition(transition)).success,
    ).toBe(false);
    expect(
      contentPackageSchema.safeParse(
        withTransition({
          ...transition,
          to_item_id: videoTimelineItemId("scene_three"),
          cut_seconds: 20,
        }),
      ).success,
    ).toBe(false);
  });

  it("removes every timeline dependency when deleting a scene", () => {
    const scenes = ["one", "two", "three"].map((id, index) => ({
      id: `scene_${id}`,
      kind: index === 0 ? ("hook" as const) : ("explanation" as const),
      title: `Scene ${id}`,
      narration: `Narration for scene ${id}.`,
      claim_ids: [],
      duration_seconds: 15,
      visual: { treatment: "type" as const, accent: "signal" as const },
    }));
    const content = contentPackageSchema.parse({
      version: 1,
      project_id: "project_scene_removal",
      headline: "Scene removal stays atomic",
      dek: "Dependent clips and transitions leave with their scene.",
      scenes,
      video_tracks: [
        {
          id: "track_video",
          name: "Video",
          kind: "video",
          protected: true,
          visible: true,
        },
        {
          id: "track_overlay",
          name: "Overlay",
          kind: "video",
          clips: [
            {
              id: "clip_scene_two",
              scene_id: "scene_two",
              label: "Scene two overlay",
              artifact_id: "artifact_overlay",
              timeline_start_seconds: 15,
              source_in_seconds: 0,
              source_out_seconds: 5,
              source_duration_seconds: 5,
              duration_seconds: 5,
            },
          ],
        },
      ],
      caption_tracks: [
        {
          id: "track_captions",
          name: "Captions",
          kind: "caption",
          clips: [
            {
              id: "caption_scene_two",
              scene_id: "scene_two",
              label: "Scene two caption",
              timeline_start_seconds: 15,
              duration_seconds: 5,
            },
          ],
        },
      ],
      transition_tracks: [
        {
          id: "track_transitions",
          name: "Transitions",
          kind: "transition",
          clips: [
            {
              id: "transition_into_two",
              label: "Crossfade",
              from_item_id: videoTimelineItemId("scene_one"),
              to_item_id: videoTimelineItemId("scene_two"),
              cut_seconds: 15,
              duration_seconds: 0.4,
              preset_id: "crossfade",
            },
          ],
        },
      ],
      metadata: {
        title: "Scene removal stays atomic",
        description: "Scene deletion fixture.",
        tags: ["editing"],
      },
    });

    const revised = applyEditorPatch(content, {
      selection: {
        project_id: content.project_id,
        base_content_package_artifact_id: "artifact_scene_removal",
        item_ids: [],
        scene_ids: ["scene_two"],
        track_ids: ["visual"],
        gap_ids: [],
        artifact_ids: [],
        playhead_seconds: null,
        time_range_seconds: null,
      },
      instruction_summary: "Remove scene two and its timeline dependencies",
      operations: [{ type: "remove_scene", scene_id: "scene_two" }],
    });

    expect(revised.scenes.map((scene) => scene.id)).toEqual([
      "scene_one",
      "scene_three",
    ]);
    expect(revised.video_tracks?.[1]?.clips).toEqual([]);
    expect(revised.caption_tracks?.[0]?.clips).toEqual([]);
    expect(revised.transition_tracks?.[0]?.clips).toEqual([]);
  });

  it("removes a transition when dragging a scene breaks its cut", () => {
    const scenes = ["one", "two", "three"].map((id, index) => ({
      id: `scene_${id}`,
      kind: index === 0 ? ("hook" as const) : ("explanation" as const),
      title: `Scene ${id}`,
      narration: `Narration for scene ${id}.`,
      claim_ids: [],
      duration_seconds: 10,
      visual: { treatment: "type" as const, accent: "signal" as const },
    }));
    const content = contentPackageSchema.parse({
      version: 1,
      project_id: "project_drag_reorder",
      headline: "Scene dragging stays valid",
      dek: "A transition only survives while its two clips share a cut.",
      scenes,
      transition_tracks: [
        {
          id: "track_transitions",
          name: "Transitions",
          kind: "transition",
          clips: [
            {
              id: "transition_one_to_two",
              label: "Crossfade",
              from_item_id: videoTimelineItemId("scene_one"),
              to_item_id: videoTimelineItemId("scene_two"),
              cut_seconds: 10,
              duration_seconds: 0.4,
              preset_id: "crossfade",
            },
          ],
        },
      ],
      metadata: {
        title: "Scene dragging stays valid",
        description: "Scene drag transition fixture.",
        tags: ["editing"],
      },
    });

    const revised = applyEditorPatch(content, {
      selection: {
        project_id: content.project_id,
        base_content_package_artifact_id: "artifact_drag_reorder",
        item_ids: scenes.map((scene) => videoTimelineItemId(scene.id)),
        scene_ids: scenes.map((scene) => scene.id),
        track_ids: ["visual"],
        gap_ids: [],
        artifact_ids: [],
        playhead_seconds: null,
        time_range_seconds: null,
      },
      instruction_summary: "Move scene one after scene three",
      operations: [
        {
          type: "reorder_scenes",
          scene_ids: ["scene_two", "scene_three", "scene_one"],
        },
      ],
    });

    expect(revised.scenes.map((scene) => scene.id)).toEqual([
      "scene_two",
      "scene_three",
      "scene_one",
    ]);
    expect(revised.transition_tracks?.[0]?.clips).toEqual([]);
  });

  it("requires editor operations to contain a real change", () => {
    const parsed = editorPatchInputSchema.safeParse({
      selection: {
        project_id: "project_001",
        base_content_package_artifact_id: "artifact_001",
        scene_ids: ["scene_001"],
      },
      instruction_summary: "Change the selected beat",
      operations: [{ type: "update_scene", scene_id: "scene_001" }],
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts exact clip deletion and transition replacement operations", () => {
    const selection = {
      project_id: "project_001",
      base_content_package_artifact_id: "artifact_001",
      item_ids: [
        "audio_clip_voice_001",
        "caption_clip_caption_001",
        "transition_clip_transition_001",
      ],
      scene_ids: ["scene_001"],
      track_ids: ["voice", "caption", "transition"],
      gap_ids: [],
      artifact_ids: [],
      playhead_seconds: 1,
      time_range_seconds: null,
    };
    const parsed = editorPatchInputSchema.safeParse({
      selection,
      instruction_summary: "Delete clips and replace the selected transition",
      operations: [
        {
          type: "remove_audio_clip",
          item_id: "audio_clip_voice_001",
          clip_id: "clip_voice_001",
        },
        {
          type: "remove_caption_clip",
          item_id: "caption_clip_caption_001",
          clip_id: "clip_caption_001",
        },
        {
          type: "update_transition_clip",
          item_id: "transition_clip_transition_001",
          clip_id: "clip_transition_001",
          label: "Crossfade",
          preset_id: "crossfade",
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("allows an exact item time range inside its parent scene", () => {
    const content = contentPackageSchema.parse({
      version: 1,
      project_id: "project_item_range",
      headline: "Exact item edits stay exact",
      dek: "A selected clip does not need to claim its entire parent scene.",
      scenes: [
        {
          id: "scene_item_range",
          kind: "hook",
          title: "One scene",
          narration: "A scene with one independently timed caption.",
          claim_ids: [],
          duration_seconds: 30,
          visual: { treatment: "type", accent: "signal" },
        },
      ],
      caption_tracks: [
        {
          id: "track_captions",
          name: "Captions",
          kind: "caption",
          visible: true,
          clips: [
            {
              id: "clip_caption_range",
              scene_id: "scene_item_range",
              label: "Only this caption",
              timeline_start_seconds: 2,
              duration_seconds: 2,
            },
          ],
        },
      ],
      metadata: {
        title: "Exact item edits stay exact",
        description: "Item-scoped selection fixture.",
        tags: ["editing"],
      },
    });

    expect(() =>
      applyEditorPatch(content, {
        selection: {
          project_id: content.project_id,
          base_content_package_artifact_id: "artifact_item_range",
          item_ids: ["caption_clip_caption_range"],
          scene_ids: ["scene_item_range"],
          track_ids: ["track_captions", "caption"],
          gap_ids: [],
          artifact_ids: [],
          playhead_seconds: 3,
          time_range_seconds: { start: 2, end: 4 },
        },
        instruction_summary: "Trim only the selected caption",
        operations: [
          {
            type: "update_caption_clip",
            item_id: "caption_clip_caption_range",
            clip_id: "clip_caption_range",
            duration_seconds: 1,
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects timeline IDs that disagree with their typed item kind", () => {
    const parsed = editorTimelineItemSchema.safeParse({
      id: "video_scene_001",
      kind: "caption",
      track_id: "track_captions",
      scene_id: "scene_001",
      label: "One caption",
      start_seconds: 0,
      end_seconds: 1,
      artifact_ids: [],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects edit timing between production frames", () => {
    const parsed = editorPatchInputSchema.safeParse({
      selection: {
        project_id: "project_001",
        base_content_package_artifact_id: "artifact_001",
        scene_ids: ["scene_001"],
      },
      instruction_summary: "Trim on the exact frame grid",
      operations: [
        {
          type: "update_scene",
          scene_id: "scene_001",
          duration_seconds: 1.01,
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("does not impose an arbitrary scene-count cap", () => {
    const parsed = contentPackageSchema.safeParse({
      version: 1,
      project_id: "project_001",
      headline: "A cut with many precise beats",
      dek: "Each short beat remains independently editable on the timeline.",
      scenes: Array.from({ length: 20 }, (_, index) => ({
        id: `scene_${String(index).padStart(3, "0")}`,
        kind: index === 0 ? "hook" : "explanation",
        title: `Beat ${index + 1}`,
        narration: "A measured line.",
        claim_ids: [],
        duration_seconds: 2,
        visual: { treatment: "type", accent: "signal" },
      })),
      metadata: {
        title: "A cut with many precise beats",
        description: "A concise production.",
        tags: ["editing"],
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("keeps captions word-timed and ordered", () => {
    const parsed = captionTrackSchema.parse({
      version: 1,
      project_id: "project_001",
      scene_id: "scene_001",
      locale: "en",
      transcript_artifact_id: "artifact_transcript_001",
      cues: [
        {
          text: "Hello",
          startMs: 0,
          endMs: 320,
          timestampMs: null,
          confidence: null,
        },
        {
          text: " world",
          startMs: 340,
          endMs: 720,
          timestampMs: null,
          confidence: null,
        },
      ],
    });

    expect(parsed.cues.map((cue) => cue.text).join("")).toBe("Hello world");
  });

  it("normalizes legacy narration and obeys track mute, solo, and export state", () => {
    const content = contentPackageSchema.parse({
      version: 1,
      project_id: "project_audio",
      headline: "A production with named audio",
      dek: "Every language remains editable one scene at a time.",
      scenes: Array.from({ length: 3 }, (_, index) => ({
        id: `scene_audio_${index}`,
        kind: index === 0 ? "hook" : "explanation",
        title: `Audio scene ${index + 1}`,
        narration: "One independently editable narration clip.",
        narration_artifact_id: `artifact_voice_${index}`,
        claim_ids: [],
        duration_seconds: 10,
        visual: { treatment: "type", accent: "signal" },
      })),
      metadata: {
        title: "A production with named audio",
        description: "A concise production.",
        tags: ["audio"],
      },
    });
    const [primary] = effectiveAudioTracks(content);
    expect(primary?.name).toBe("Narration");
    expect(primary?.clips).toHaveLength(3);

    const explicit = contentPackageSchema.parse({
      ...content,
      audio_tracks: [
        { ...primary!, muted: false, solo: false, export_enabled: true },
        {
          ...primary!,
          id: "track_hindi_dub",
          name: "Hindi dub",
          role: "dub",
          locale: "hi-IN",
          solo: true,
          clips: primary!.clips.map((clip) => ({
            ...clip,
            id: `hindi_${clip.id}`,
          })),
        },
        {
          ...primary!,
          id: "track_music_bed",
          name: "Music",
          role: "music",
          muted: true,
          clips: primary!.clips.map((clip) => ({
            ...clip,
            id: `music_${clip.id}`,
          })),
        },
      ],
    });
    expect(audibleAudioTracks(explicit).map((track) => track.id)).toEqual([
      "track_hindi_dub",
    ]);
  });

  it("resolves a caption lane through its matching measured narration clip", () => {
    const content = contentPackageSchema.parse({
      version: 1,
      project_id: "project_caption_resolution",
      headline: "Captions follow the spoken timeline",
      dek: "Measured words remain attached to the narration that created them.",
      scenes: Array.from({ length: 3 }, (_, index) => ({
        id: `scene_caption_${index}`,
        kind: index === 0 ? "hook" : "explanation",
        title: `Caption scene ${index + 1}`,
        narration: "One independently measured narration clip.",
        narration_artifact_id: `artifact_voice_caption_${index}`,
        captions_artifact_id: `artifact_captions_${index}`,
        transcript_artifact_id: `artifact_transcript_${index}`,
        claim_ids: [],
        duration_seconds: 10,
        visual: { treatment: "type", accent: "signal" },
      })),
      metadata: {
        title: "Captions follow the spoken timeline",
        description: "Caption artifact resolution fixture.",
        tags: ["captions"],
      },
    });
    const clip = effectiveCaptionTracks(content)[0]!.clips[1]!;

    expect(clip.artifact_id).toBe("artifact_captions_1");
    expect(captionArtifactIdForTimelineClip(content, clip)).toBe(
      "artifact_captions_1",
    );

    const independentClip = { ...clip, artifact_id: null };
    expect(captionArtifactIdForTimelineClip(content, independentClip)).toBe(
      "artifact_captions_1",
    );
  });

  it("rejects ambiguous or incomplete lane ordering", () => {
    const parsed = contentPackageSchema.safeParse({
      version: 1,
      project_id: "project_tracks",
      headline: "Every lane has one stable place",
      dek: "Track order contains every real editor lane exactly once.",
      scenes: Array.from({ length: 3 }, (_, index) => ({
        id: `scene_tracks_${index}`,
        kind: index === 0 ? "hook" : "explanation",
        title: `Track scene ${index + 1}`,
        narration: "One independently editable narration clip.",
        claim_ids: [],
        duration_seconds: 10,
        visual: { treatment: "type", accent: "signal" },
      })),
      track_order: ["track_video", "track_video", "track_captions"],
      metadata: {
        title: "Every lane has one stable place",
        description: "A concise production.",
        tags: ["editing"],
      },
    });

    expect(parsed.success).toBe(false);
  });
});
