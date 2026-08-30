import {
  applyEditorPatch,
  effectiveAudioTracks,
  effectiveCaptionTracks,
  type Artifact,
  type ContentPackage,
} from "@greenlight/contracts";
import { describe, expect, it } from "vitest";

import {
  artifactDurationSeconds,
  captionItemId,
  changeSceneSpeed,
  createSelection,
  createTimelineContext,
  fitSourceDurationToFrames,
  gapItemId,
  timelineItems,
  timelineTracks,
  formatRulerTime,
  sceneOffset,
  sceneAtTimelineTime,
  sceneTimelineDuration,
  splitSceneAtPlayhead,
  timelineTicks,
  trackOperationSceneIds,
  transitionItemId,
  totalDuration,
  videoItemId,
} from "./model.js";

describe("source-backed media", () => {
  it("uses measured duration and never rounds beyond the source", () => {
    const artifact: Artifact = {
      id: "artifact_audio",
      project_id: "project_editor",
      kind: "audio",
      sha256: "a".repeat(64),
      relative_path: "audio/test.mp3",
      mime_type: "audio/mpeg",
      byte_size: 1,
      generation: null,
      provenance: { media_metadata: { duration_seconds: 3.156 } },
      created_at: "2026-08-26T00:00:00.000Z",
    };

    expect(artifactDurationSeconds(artifact, 5)).toBe(3.156);
    expect(fitSourceDurationToFrames(3.156)).toBe(94 / 30);
    expect(fitSourceDurationToFrames(0.01)).toBe(1 / 30);
  });
});

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
  release: {
    thumbnail_artifact_id: null,
    destination: "unlisted",
    publish_at: null,
  },
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
  generation: null,
  provenance: {},
  created_at: "2026-08-24T00:00:00.000Z",
} satisfies Artifact;

describe("editor selection", () => {
  it("returns no scene while the playhead is inside an explicit gap", () => {
    const withGap = structuredClone(content);
    withGap.scenes[0]!.gap_after_seconds = 3;

    expect(sceneAtTimelineTime(withGap, 1)?.id).toBe("scene_000");
    expect(sceneAtTimelineTime(withGap, 2.5)).toBeNull();
    expect(sceneAtTimelineTime(withGap, 5)?.id).toBe("scene_001");
  });

  it("tiles continuous scenes without overlaps or decorative gaps", () => {
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

  it("projects scene requests into exact independent timeline items", () => {
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
    expect(selection.item_ids).toHaveLength(45);
    expect(selection.track_ids).toEqual([
      "track_video",
      "track_narration",
      "track_captions",
      "visual",
      "caption",
      "voice",
      "transcript",
    ]);
    expect(selection.artifact_ids).toContain("transcript_004");
    expect(selection.artifact_ids).toContain(sourceLedger.id);
    expect(selection.artifact_ids).toContain("artifact_local_clip");
    expect(selection.time_range_seconds).not.toBeNull();
    expect(selection.time_range_seconds!.start).toBe(6);
    expect(selection.time_range_seconds!.end).toBe(36);
  });

  it("keeps one selected audio clip independent from video and captions", () => {
    const audioItem = timelineItems(content).find(
      (item) => item.kind === "audio",
    );
    expect(audioItem).toBeDefined();
    const selection = createSelection({
      projectId: content.project_id,
      contentArtifactId: "artifact_content",
      content,
      itemIds: [audioItem!.id],
      sourceLedgerArtifact: sourceLedger,
    });

    expect(selection.item_ids).toEqual([audioItem!.id]);
    expect(selection.scene_ids).toEqual([audioItem!.scene_id]);
    expect(selection.track_ids).toContain("track_narration");
    expect(selection.track_ids).toContain("voice");
    expect(selection.track_ids).not.toContain("visual");
    expect(selection.track_ids).not.toContain("caption");
  });

  it("keeps one selected caption clip independent from video and audio", () => {
    const captionItem = timelineItems(content).find(
      (item) => item.kind === "caption",
    );
    expect(captionItem).toBeDefined();
    const selection = createSelection({
      projectId: content.project_id,
      contentArtifactId: "artifact_content",
      content,
      itemIds: [captionItem!.id],
      sourceLedgerArtifact: sourceLedger,
    });

    expect(selection.item_ids).toEqual([captionItem!.id]);
    expect(selection.scene_ids).toEqual([captionItem!.scene_id]);
    expect(selection.track_ids).toContain("track_captions");
    expect(selection.track_ids).toContain("caption");
    expect(selection.track_ids).not.toContain("visual");
    expect(selection.track_ids).not.toContain("voice");
  });

  it("can give Producer one exact track without inventing a scene selection", () => {
    const selection = createSelection({
      projectId: content.project_id,
      contentArtifactId: "artifact_content",
      content,
      trackIds: ["track_narration"],
      sourceLedgerArtifact: null,
    });

    expect(selection.item_ids).toEqual([]);
    expect(selection.scene_ids).toEqual([]);
    expect(selection.track_ids).toEqual(["track_narration"]);
    expect(selection.time_range_seconds).toBeNull();
  });

  it("authorizes a whole-track mute across every clip on that track", () => {
    const narration = effectiveAudioTracks(content)[0]!;
    const operation = {
      type: "upsert_audio_track" as const,
      track: { ...narration, muted: true },
    };
    const selection = createSelection({
      projectId: content.project_id,
      contentArtifactId: "artifact_content",
      content,
      sceneIds: trackOperationSceneIds([operation]),
      trackIds: ["voice", narration.id],
      sourceLedgerArtifact: null,
    });

    const revised = applyEditorPatch(content, {
      selection,
      instruction_summary: "Mute Narration",
      operations: [operation],
    });

    expect(selection.scene_ids).toEqual(
      narration.clips.map((clip) => clip.scene_id),
    );
    expect(selection.item_ids).toEqual([]);
    expect(effectiveAudioTracks(revised)[0]?.muted).toBe(true);
  });

  it("keeps whole caption-track changes out of item selection", () => {
    const captions = effectiveCaptionTracks(content)[0]!;
    const operation = {
      type: "upsert_caption_track" as const,
      track: { ...captions, visible: false },
    };
    const selection = createSelection({
      projectId: content.project_id,
      contentArtifactId: "artifact_content",
      content,
      sceneIds: trackOperationSceneIds([operation]),
      trackIds: ["caption", captions.id],
      sourceLedgerArtifact: null,
    });

    expect(selection.item_ids).toEqual([]);
    expect(selection.scene_ids).toEqual(
      captions.clips.map((clip) => clip.scene_id),
    );
    expect(selection.time_range_seconds).toEqual({
      start: 0,
      end: totalDuration(content),
    });
  });

  it("keeps narration and captions fixed when only video is trimmed", () => {
    const video = timelineItems(content).find(
      (item) => item.kind === "video" && item.scene_id === "scene_000",
    )!;
    const before = timelineItems(content).filter(
      (item) =>
        item.scene_id === "scene_000" &&
        (item.kind === "audio" || item.kind === "caption"),
    );
    const selection = createSelection({
      projectId: content.project_id,
      contentArtifactId: "artifact_content",
      content,
      itemIds: [video.id],
      sourceLedgerArtifact: null,
    });

    const revised = applyEditorPatch(content, {
      selection,
      instruction_summary: "Trim only the video",
      operations: [
        {
          type: "update_scene",
          scene_id: "scene_000",
          duration_seconds: 1,
          gap_after_seconds: 1,
        },
      ],
    });
    const after = timelineItems(revised).filter((item) =>
      before.some((candidate) => candidate.id === item.id),
    );

    expect(
      after.map(({ id, start_seconds, end_seconds }) => ({
        id,
        start_seconds,
        end_seconds,
      })),
    ).toEqual(
      before.map(({ id, start_seconds, end_seconds }) => ({
        id,
        start_seconds,
        end_seconds,
      })),
    );
    expect(revised.audio_tracks?.[0]?.clips[0]).toMatchObject({
      timeline_start_seconds: 0,
      duration_seconds: 2,
    });
    expect(revised.scenes[0]).toMatchObject({
      caption_timeline_start_seconds: 0,
      caption_duration_seconds: 2,
    });
  });

  it("keeps narration and captions fixed when videos are reordered", () => {
    const items = timelineItems(content);
    const videoIds = items
      .filter((item) => item.kind === "video")
      .map((item) => item.id);
    const independentBefore = items
      .filter((item) => item.kind !== "video")
      .map(({ id, start_seconds, end_seconds }) => ({
        id,
        start_seconds,
        end_seconds,
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id));
    const selection = createSelection({
      projectId: content.project_id,
      contentArtifactId: "artifact_content",
      content,
      itemIds: videoIds,
      sourceLedgerArtifact: null,
    });
    const sceneIds = content.scenes.map((scene) => scene.id);

    const revised = applyEditorPatch(content, {
      selection,
      instruction_summary: "Reorder only the video clips",
      operations: [
        {
          type: "reorder_scenes",
          scene_ids: [sceneIds[1]!, sceneIds[0]!, ...sceneIds.slice(2)],
        },
      ],
    });
    const independentAfter = timelineItems(revised)
      .filter((item) => item.kind !== "video")
      .map(({ id, start_seconds, end_seconds }) => ({
        id,
        start_seconds,
        end_seconds,
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id));

    expect(independentAfter).toEqual(independentBefore);
  });

  it("exposes caption-track visibility to Studio and the Producer", () => {
    const hidden = structuredClone(content);
    hidden.caption_tracks = [
      {
        id: "track_captions",
        name: "Captions",
        kind: "caption",
        protected: true,
        visible: false,
      },
    ];

    expect(
      timelineTracks(hidden).find((track) => track.kind === "caption")?.visible,
    ).toBe(false);
    expect(
      createTimelineContext({
        projectId: hidden.project_id,
        contentArtifactId: "artifact_content",
        content: hidden,
        playheadSeconds: 0,
      }).tracks.find((track) => track.kind === "caption")?.visible,
    ).toBe(false);
  });

  it("gives dragged transitions their exact persisted cut and preset context", () => {
    const withTransition = structuredClone(content);
    withTransition.transition_tracks = [
      {
        id: "track_transitions",
        name: "Transitions",
        kind: "transition",
        protected: false,
        visible: true,
        clips: [
          {
            id: "transition_scene_000_scene_001",
            label: "Soft push",
            from_item_id: videoItemId("scene_000"),
            to_item_id: videoItemId("scene_001"),
            cut_seconds: 2,
            duration_seconds: 0.4,
            preset_id: "push",
            parameters: { direction: "left", intensity: 0.7 },
            sound_artifact_id: null,
          },
        ],
      },
    ];

    const item = timelineItems(withTransition).find(
      (candidate) =>
        candidate.id === transitionItemId("transition_scene_000_scene_001"),
    );

    expect(item).toMatchObject({
      kind: "transition",
      track_id: "track_transitions",
      transition: {
        cut_seconds: 2,
        duration_seconds: 0.4,
        preset_id: "push",
        parameters: { direction: "left", intensity: 0.7 },
      },
    });
    expect(
      createTimelineContext({
        projectId: withTransition.project_id,
        contentArtifactId: "artifact_content",
        content: withTransition,
        playheadSeconds: 2,
      }).items.find((candidate) => candidate.id === item?.id)?.transition,
    ).toMatchObject({ preset_id: "push", cut_seconds: 2 });
  });

  it("uses the persisted track order instead of rebuilding lane order", () => {
    const reordered = {
      ...content,
      track_order: ["track_captions", "track_narration", "track_video"],
    } satisfies ContentPackage;

    expect(timelineTracks(reordered).map((track) => track.id)).toEqual([
      "track_captions",
      "track_narration",
      "track_video",
    ]);
  });

  it("projects persisted audio and caption placements independently", () => {
    const placed = structuredClone(content);
    placed.scenes[1]!.caption_timeline_start_seconds = 7;
    placed.scenes[1]!.caption_duration_seconds = 1;
    placed.audio_tracks = [
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
            id: "clip_scene_001",
            scene_id: placed.scenes[1]!.id,
            label: "Moved narration",
            artifact_id: null,
            script: "One editable narration line.",
            transcript_artifact_id: null,
            captions_artifact_id: null,
            start_offset_seconds: 0,
            timeline_start_seconds: 8,
            source_in_seconds: 0,
            source_out_seconds: 2,
            duration_seconds: 1,
            playback_rate: 1,
            status: "draft",
          },
        ],
      },
    ];

    const projected = timelineItems(placed);
    expect(
      projected.find((item) => item.id === captionItemId("caption_scene_001")),
    ).toMatchObject({ start_seconds: 7, end_seconds: 8 });
    expect(
      projected.find((item) => item.id === "audio_clip_scene_001"),
    ).toMatchObject({ start_seconds: 8, end_seconds: 9 });
    expect(
      projected.find((item) => item.id === "video_scene_001"),
    ).toMatchObject({ start_seconds: 2, end_seconds: 4 });
  });

  it("gives Producer the complete cut while selection stays independent", () => {
    const timeline = createTimelineContext({
      projectId: content.project_id,
      contentArtifactId: "artifact_content",
      content,
      playheadSeconds: 7.271,
    });

    expect(timeline.scenes).toHaveLength(content.scenes.length);
    expect(timeline.playhead_seconds).toBe(7.266666666666667);
    expect(timeline.scenes[3]).toMatchObject({
      id: "scene_003",
      start_seconds: 6,
      end_seconds: 8,
    });
    expect(timeline.duration_seconds).toBe(40);
  });

  it("records an explicitly selected gap in Producer context", () => {
    const withGap = structuredClone(content);
    withGap.scenes[0]!.gap_after_seconds = 3;
    const selection = createSelection({
      projectId: withGap.project_id,
      contentArtifactId: "artifact_content",
      content: withGap,
      gapIds: [gapItemId(withGap.scenes[0]!.id)],
      sourceLedgerArtifact: null,
    });

    expect(selection.gap_ids).toEqual([gapItemId("scene_000")]);
    expect(selection.item_ids).toEqual([]);
    expect(selection.time_range_seconds).toEqual({ start: 2, end: 5 });
  });

  it("records the exact playhead and builds a frame-accurate direct cut", () => {
    const selected = createSelection({
      projectId: content.project_id,
      contentArtifactId: "artifact_content",
      content,
      sceneIds: [content.scenes[1]!.id],
      playheadSeconds: 2.37,
      sourceLedgerArtifact: null,
    });
    expect(selected.playhead_seconds).toBe(2.3666666666666667);

    const operation = splitSceneAtPlayhead({
      content,
      sceneId: content.scenes[1]!.id,
      playheadSeconds: 3,
      secondSceneId: "scene_cut_001",
    });
    expect(operation).not.toBeNull();
    expect(operation?.first.duration_seconds).toBe(1);
    expect(operation?.first.gap_after_seconds).toBe(0);
    expect(operation?.second.duration_seconds).toBe(1);
    expect(operation?.second.id).toBe("scene_cut_001");
  });

  it("makes the ruler more granular as visible pixels increase", () => {
    const compact = timelineTicks(30, 600);
    const detailed = timelineTicks(30, 4800);
    expect(detailed.stepSeconds).toBeLessThan(compact.stepSeconds);
    expect(detailed.ticks.length).toBeGreaterThan(compact.ticks.length);
    expect(formatRulerTime(5.5, detailed.stepSeconds)).toContain("5.50");
  });

  it("keeps the final ruler label from colliding with the previous tick", () => {
    const compact = timelineTicks(32.4, 760);
    const finalTick = compact.ticks.at(-1)!;
    const previousTick = compact.ticks.at(-2)!;

    expect(finalTick).toBe(32.4);
    expect((finalTick - previousTick) * (760 / 32.4)).toBeGreaterThanOrEqual(
      72,
    );
    expect(previousTick).toBe(25);
  });

  it("rate-stretches a scene without inventing a gap", () => {
    const scene = content.scenes[0]!;
    const operation = changeSceneSpeed(scene, 2);

    expect(operation.playback_rate).toBe(2);
    expect(operation.duration_seconds).toBe(1);
    expect(operation.gap_after_seconds).toBe(0);
  });

  it("preserves a source-backed clip range while changing its speed", () => {
    const scene = {
      ...content.scenes[0]!,
      duration_seconds: 4,
      source_clip: {
        artifact_id: "video_source_001",
        in_seconds: 3,
        out_seconds: 7,
        source_duration_seconds: 20,
      },
    };
    const operation = changeSceneSpeed(scene, 1.25);

    expect(operation.duration_seconds).toBe(3.2);
    expect(operation.playback_rate).toBe(1.25);
    expect(operation).not.toHaveProperty("source_clip");
  });
});
