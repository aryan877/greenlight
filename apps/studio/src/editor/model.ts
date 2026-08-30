import {
  audioClipDurationSeconds,
  audioTimelineItemId,
  captionTimelineItemId,
  effectiveAudioTracks,
  effectiveCaptionTracks,
  effectiveTransitionTracks,
  effectiveVideoTracks,
  MIN_SCENE_DURATION_SECONDS,
  productionDurationSeconds,
  scenePresentationDurationSeconds,
  sceneStartSeconds,
  timelineGapId,
  transitionTimelineItemId,
  videoTimelineItemId,
  VIDEO_FPS,
  type Artifact,
  type ContentPackage,
  type EditorPatchOperation,
  type EditorSelection,
  type EditorTimelineItem,
  type EditorTimelineGap,
  type EditorTimelineTrack,
  type EditorTimelineContext,
  type Scene,
} from "@greenlight/contracts";

export const sceneOffset = (scenes: Scene[], index: number) =>
  sceneStartSeconds(scenes, index);

export const totalDuration = (content: ContentPackage) =>
  productionDurationSeconds(content.scenes);

export const sceneAtTimelineTime = (
  content: ContentPackage,
  seconds: number,
): Scene | null =>
  content.scenes.find((scene, index) => {
    const start = sceneOffset(content.scenes, index);
    return seconds >= start && seconds < start + scene.duration_seconds;
  }) ?? null;

export const trackOperationSceneIds = (
  operations: EditorPatchOperation[],
): string[] => [
  ...new Set(
    operations.flatMap((operation) => {
      if (operation.type === "upsert_audio_track") {
        return operation.track.clips.map((clip) => clip.scene_id);
      }
      if (operation.type === "upsert_localized_track") {
        return [operation.track.scene_id];
      }
      return [];
    }),
  ),
];

export const videoItemId = videoTimelineItemId;
export const captionItemId = captionTimelineItemId;
export const audioItemId = audioTimelineItemId;
export const transitionItemId = transitionTimelineItemId;
export const gapItemId = timelineGapId;

export const timelineItems = (
  content: ContentPackage,
): EditorTimelineItem[] => {
  const sceneVideoItems = content.scenes.map((scene, index) => {
    const start = snapToFrame(sceneOffset(content.scenes, index));
    return {
      id: videoItemId(scene.id),
      kind: "video" as const,
      track_id: scene.video_track_id ?? "track_video",
      scene_id: scene.id,
      label: scene.title,
      start_seconds: start,
      end_seconds: snapToFrame(start + scene.duration_seconds),
      artifact_ids: scene.visual.artifact_ids,
    };
  });

  const overlayVideoItems = effectiveVideoTracks(content).flatMap((track) =>
    (track.clips ?? []).map((clip) => ({
      id: videoItemId(clip.id),
      kind: "video" as const,
      track_id: track.id,
      scene_id: clip.scene_id,
      label: clip.label,
      start_seconds: clip.timeline_start_seconds,
      end_seconds: snapToFrame(
        clip.timeline_start_seconds + clip.duration_seconds,
      ),
      artifact_ids: [clip.artifact_id, clip.provenance_artifact_id].filter(
        (id): id is string => Boolean(id),
      ),
    })),
  );

  const audioItems = effectiveAudioTracks(content).flatMap((track) =>
    track.clips.flatMap((clip) => {
      const sceneIndex = content.scenes.findIndex(
        (scene) => scene.id === clip.scene_id,
      );
      const scene = content.scenes[sceneIndex];
      if (!scene) return [];
      const sceneStart = sceneOffset(content.scenes, sceneIndex);
      const start = snapToFrame(
        clip.timeline_start_seconds ?? sceneStart + clip.start_offset_seconds,
      );
      const sourceDuration = audioClipDurationSeconds(clip, scene);
      const end = snapToFrame(
        Math.min(
          totalDuration(content),
          start + Math.max(1 / VIDEO_FPS, sourceDuration),
        ),
      );
      return [
        {
          id: audioItemId(clip.id),
          kind: "audio" as const,
          track_id: track.id,
          scene_id: scene.id,
          label: clip.label,
          start_seconds: start,
          end_seconds: end,
          artifact_ids: [clip.artifact_id, clip.transcript_artifact_id].filter(
            (id): id is string => Boolean(id),
          ),
        },
      ];
    }),
  );

  const captionItems = effectiveCaptionTracks(content).flatMap((track) =>
    track.clips.map((clip) => ({
      id: captionItemId(clip.id),
      kind: "caption" as const,
      track_id: track.id,
      scene_id: clip.scene_id,
      label: clip.label,
      start_seconds: clip.timeline_start_seconds,
      end_seconds: snapToFrame(
        clip.timeline_start_seconds + clip.duration_seconds,
      ),
      artifact_ids: [clip.artifact_id, clip.transcript_artifact_id].filter(
        (id): id is string => Boolean(id),
      ),
    })),
  );

  const transitionItems = effectiveTransitionTracks(content).flatMap((track) =>
    track.clips.map((clip) => ({
      id: transitionItemId(clip.id),
      kind: "transition" as const,
      track_id: track.id,
      scene_id:
        content.scenes.find(
          (scene, index) =>
            sceneOffset(content.scenes, index) <= clip.cut_seconds &&
            sceneOffset(content.scenes, index) +
              scene.duration_seconds +
              (scene.gap_after_seconds ?? 0) >=
              clip.cut_seconds,
        )?.id ?? content.scenes[0]!.id,
      label: clip.label,
      start_seconds: snapToFrame(
        Math.max(0, clip.cut_seconds - clip.duration_seconds / 2),
      ),
      end_seconds: snapToFrame(
        Math.min(
          totalDuration(content),
          clip.cut_seconds + clip.duration_seconds / 2,
        ),
      ),
      artifact_ids: [clip.sound_artifact_id].filter((id): id is string =>
        Boolean(id),
      ),
      transition: {
        from_item_id: clip.from_item_id,
        to_item_id: clip.to_item_id,
        cut_seconds: clip.cut_seconds,
        duration_seconds: clip.duration_seconds,
        preset_id: clip.preset_id,
        parameters: clip.parameters,
        sound_artifact_id: clip.sound_artifact_id,
      },
    })),
  );

  return [
    ...sceneVideoItems,
    ...overlayVideoItems,
    ...audioItems,
    ...captionItems,
    ...transitionItems,
  ];
};

export const timelineGaps = (content: ContentPackage): EditorTimelineGap[] =>
  content.scenes.flatMap((scene, index) => {
    const duration = snapToFrame(scene.gap_after_seconds ?? 0);
    if (duration <= 0) return [];
    const start = snapToFrame(
      sceneOffset(content.scenes, index) + scene.duration_seconds,
    );
    return [
      {
        id: gapItemId(scene.id),
        after_scene_id: scene.id,
        label: `Gap after ${scene.title}`,
        start_seconds: start,
        end_seconds: snapToFrame(start + duration),
      },
    ];
  });

export const timelineTracks = (
  content: ContentPackage,
): EditorTimelineTrack[] => {
  const tracks: EditorTimelineTrack[] = [
    ...effectiveVideoTracks(content).map((track) => ({
      ...track,
      role: null,
      muted: false,
      solo: false,
      export_enabled: true,
      gain: 1,
      ducking: null,
      visible: true,
    })),
    ...effectiveAudioTracks(content).map((track, index, audioTracks) => ({
      id: track.id,
      kind: "audio" as const,
      name: track.name,
      protected:
        track.id === "track_narration" ||
        (track.role === "narration" &&
          audioTracks.findIndex(
            (candidate) => candidate.role === "narration",
          ) === index),
      role: track.role,
      muted: track.muted,
      solo: track.solo,
      export_enabled: track.export_enabled,
      gain: track.gain,
      ducking: track.ducking,
      visible: true,
    })),
    ...effectiveCaptionTracks(content).map((track) => ({
      ...track,
      role: null,
      muted: false,
      solo: false,
      export_enabled: true,
      gain: 1,
      ducking: null,
      visible: track.visible,
    })),
    ...effectiveTransitionTracks(content).map((track) => ({
      ...track,
      role: null,
      muted: false,
      solo: false,
      export_enabled: true,
      gain: 1,
      ducking: null,
      visible: track.visible,
    })),
  ];
  if (!content.track_order) return tracks;
  const order = new Map(
    content.track_order.map((trackId, index) => [trackId, index]),
  );
  return tracks.toSorted(
    (left, right) => order.get(left.id)! - order.get(right.id)!,
  );
};

export const createTimelineContext = (input: {
  projectId: string;
  contentArtifactId: string;
  content: ContentPackage;
  playheadSeconds: number;
}): EditorTimelineContext => ({
  project_id: input.projectId,
  content_package_artifact_id: input.contentArtifactId,
  headline: input.content.headline,
  duration_seconds: snapToFrame(totalDuration(input.content)),
  playhead_seconds: snapToFrame(Math.max(0, input.playheadSeconds)),
  tracks: timelineTracks(input.content),
  items: timelineItems(input.content),
  gaps: timelineGaps(input.content),
  scenes: input.content.scenes.map((scene, index) => {
    const start = snapToFrame(sceneOffset(input.content.scenes, index));
    return {
      id: scene.id,
      title: scene.title,
      start_seconds: start,
      end_seconds: snapToFrame(start + scene.duration_seconds),
      gap_after_seconds: snapToFrame(scene.gap_after_seconds ?? 0),
      playback_rate: scene.playback_rate,
    };
  }),
});

export const sceneTimelineDuration = (scenes: Scene[], index: number) => {
  return scenePresentationDurationSeconds(scenes, index);
};

export const snapToFrame = (seconds: number) =>
  Math.round(seconds * VIDEO_FPS) / VIDEO_FPS;

export const fitSourceDurationToFrames = (seconds: number) =>
  Math.max(
    1 / VIDEO_FPS,
    Math.floor((Math.max(0, seconds) + Number.EPSILON) * VIDEO_FPS) / VIDEO_FPS,
  );

export const artifactDurationSeconds = (
  artifact: Artifact,
  fallbackSeconds: number,
) => {
  const mediaMetadata = artifact.provenance.media_metadata;
  const measured =
    mediaMetadata &&
    typeof mediaMetadata === "object" &&
    "duration_seconds" in mediaMetadata
      ? mediaMetadata.duration_seconds
      : artifact.provenance.measured_duration_seconds;
  return typeof measured === "number" &&
    Number.isFinite(measured) &&
    measured > 0
    ? measured
    : fallbackSeconds;
};

const TIMELINE_TICK_FRAMES = [
  1, 2, 5, 10, 15, 30, 60, 90, 150, 300, 450, 900, 1800,
] as const;

export const timelineTicks = (duration: number, width: number) => {
  const safeDuration = Math.max(duration, 1 / VIDEO_FPS);
  const pixelsPerSecond = Math.max(width, 1) / safeDuration;
  const minimumTickPixels = 72;
  const targetFrames = (minimumTickPixels / pixelsPerSecond) * VIDEO_FPS;
  const stepFrames =
    TIMELINE_TICK_FRAMES.find((frames) => frames >= targetFrames) ??
    TIMELINE_TICK_FRAMES.at(-1)!;
  const stepSeconds = stepFrames / VIDEO_FPS;
  const ticks = Array.from(
    { length: Math.floor(safeDuration / stepSeconds) + 1 },
    (_, index) => Math.min(safeDuration, index * stepSeconds),
  );
  if (ticks.at(-1)! < safeDuration - 1 / VIDEO_FPS) {
    const previous = ticks.at(-1)!;
    if (
      ticks.length > 1 &&
      (safeDuration - previous) * pixelsPerSecond < minimumTickPixels
    ) {
      ticks.pop();
    }
    ticks.push(safeDuration);
  }
  return { stepSeconds, ticks };
};

export const formatRulerTime = (seconds: number, stepSeconds: number) => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  const decimals = stepSeconds < 0.1 ? 3 : stepSeconds < 1 ? 2 : 1;
  return `${minutes}:${rest.toFixed(decimals).padStart(3 + decimals, "0")}`;
};

export const formatTime = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
};

export const changeSceneSpeed = (
  scene: Scene,
  playbackRate: number,
): Extract<EditorPatchOperation, { type: "update_scene" }> => {
  const nextRate = Math.max(0.5, Math.min(3, playbackRate));
  const sourceSeconds = scene.source_clip
    ? scene.source_clip.out_seconds - scene.source_clip.in_seconds
    : scene.duration_seconds * scene.playback_rate;
  const duration = Math.max(
    MIN_SCENE_DURATION_SECONDS,
    snapToFrame(sourceSeconds / nextRate),
  );

  return {
    type: "update_scene",
    scene_id: scene.id,
    playback_rate: nextRate,
    duration_seconds: duration,
    gap_after_seconds: scene.gap_after_seconds ?? 0,
  };
};

export const splitSceneAtPlayhead = (input: {
  content: ContentPackage;
  sceneId: string;
  playheadSeconds: number;
  secondSceneId: string;
}): Extract<EditorPatchOperation, { type: "split_scene" }> | null => {
  const index = input.content.scenes.findIndex(
    (scene) => scene.id === input.sceneId,
  );
  const scene = input.content.scenes[index];
  if (!scene || input.secondSceneId === scene.id) return null;
  const localTime = snapToFrame(
    input.playheadSeconds - sceneOffset(input.content.scenes, index),
  );
  const secondDuration = snapToFrame(scene.duration_seconds - localTime);
  if (
    localTime < MIN_SCENE_DURATION_SECONDS ||
    secondDuration < MIN_SCENE_DURATION_SECONDS
  ) {
    return null;
  }
  const sourceBoundary = scene.source_clip
    ? scene.source_clip.in_seconds + localTime * scene.playback_rate
    : null;
  const first: Scene = {
    ...scene,
    duration_seconds: localTime,
    gap_after_seconds: 0,
    ...(scene.source_clip && sourceBoundary !== null
      ? {
          source_clip: {
            ...scene.source_clip,
            out_seconds: sourceBoundary,
          },
        }
      : {}),
  };
  const second: Scene = {
    ...scene,
    id: input.secondSceneId,
    duration_seconds: secondDuration,
    gap_after_seconds: scene.gap_after_seconds ?? 0,
    ...(scene.source_clip && sourceBoundary !== null
      ? {
          source_clip: {
            ...scene.source_clip,
            in_seconds: sourceBoundary,
          },
        }
      : {}),
  };
  return { type: "split_scene", scene_id: scene.id, first, second };
};

const sceneArtifacts = (scene: Scene) => [
  ...scene.visual.artifact_ids,
  ...(scene.narration_artifact_id ? [scene.narration_artifact_id] : []),
  ...(scene.captions_artifact_id ? [scene.captions_artifact_id] : []),
  ...(scene.transcript_artifact_id ? [scene.transcript_artifact_id] : []),
];

export const createSelection = (input: {
  projectId: string;
  contentArtifactId: string;
  content: ContentPackage;
  itemIds?: string[];
  sceneIds?: string[];
  trackIds?: string[];
  gapIds?: string[];
  playheadSeconds?: number;
  sourceLedgerArtifact: Artifact | null;
  extraArtifactIds?: string[];
}): EditorSelection => {
  const allItems = timelineItems(input.content);
  const requestedItemIds = new Set(input.itemIds ?? []);
  const requestedSceneIds = new Set(input.sceneIds ?? []);
  const allGaps = timelineGaps(input.content);
  const requestedGapIds = new Set(input.gapIds ?? []);
  const selectedGaps = allGaps.filter((gap) => requestedGapIds.has(gap.id));
  const selectedItems = allItems.filter((item) =>
    requestedItemIds.size > 0
      ? requestedItemIds.has(item.id)
      : requestedSceneIds.has(item.scene_id),
  );
  const selectedSceneIds = new Set([
    ...requestedSceneIds,
    ...selectedItems.map((item) => item.scene_id),
    ...selectedGaps.map((gap) => gap.after_scene_id),
  ]);
  const selected = input.content.scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => selectedSceneIds.has(scene.id));
  const requestedTrackIds = new Set(input.trackIds ?? []);
  if (
    selected.length === 0 &&
    requestedTrackIds.size === 0 &&
    selectedGaps.length === 0
  ) {
    throw new Error("scene_or_track_not_found");
  }

  const first = selected[0];
  const last = selected.at(-1);
  const selectedRanges = [
    ...selectedItems.map((item) => ({
      start: item.start_seconds,
      end: item.end_seconds,
    })),
    ...selectedGaps.map((gap) => ({
      start: gap.start_seconds,
      end: gap.end_seconds,
    })),
  ];
  const artifactIds = [
    ...new Set([
      ...selectedItems.flatMap((item) => item.artifact_ids),
      ...(input.extraArtifactIds ?? []),
    ]),
  ];
  if (
    selected.some(({ scene }) => scene.claim_ids.length > 0) &&
    input.sourceLedgerArtifact
  ) {
    artifactIds.push(input.sourceLedgerArtifact.id);
  }

  return {
    project_id: input.projectId,
    base_content_package_artifact_id: input.contentArtifactId,
    item_ids: selectedItems.map((item) => item.id),
    scene_ids: selected.map(({ scene }) => scene.id),
    track_ids: [
      ...new Set(selectedItems.map((item) => item.track_id)),
      ...requestedTrackIds,
      ...(selectedItems.some((item) => item.kind === "video")
        ? (["visual"] as const)
        : []),
      ...(selectedItems.some((item) => item.kind === "caption")
        ? (["caption"] as const)
        : []),
      ...(selectedItems.some((item) => item.kind === "audio")
        ? (["voice"] as const)
        : []),
      ...(selectedItems.some((item) => item.kind === "transition")
        ? (["transition"] as const)
        : []),
      ...(selectedItems.some(
        (item) => item.kind === "audio" && item.artifact_ids.length > 0,
      )
        ? (["transcript"] as const)
        : []),
    ],
    gap_ids: selectedGaps.map((gap) => gap.id),
    artifact_ids: artifactIds,
    playhead_seconds:
      input.playheadSeconds === undefined
        ? null
        : snapToFrame(Math.max(0, input.playheadSeconds)),
    time_range_seconds:
      selectedRanges.length > 0
        ? {
            start: Math.min(...selectedRanges.map((range) => range.start)),
            end: Math.max(...selectedRanges.map((range) => range.end)),
          }
        : first && last
          ? {
              start: sceneOffset(input.content.scenes, first.index),
              end:
                sceneOffset(input.content.scenes, last.index) +
                last.scene.duration_seconds,
            }
          : null,
  };
};
