import {
  effectiveAudioTracks,
  MIN_SCENE_DURATION_SECONDS,
  productionDurationSeconds,
  scenePresentationDurationSeconds,
  sceneStartSeconds,
  VIDEO_FPS,
  type Artifact,
  type ContentPackage,
  type EditorPatchOperation,
  type EditorSelection,
  type EditorTimelineContext,
  type Scene,
} from "@greenlight/contracts";

export const sceneOffset = (scenes: Scene[], index: number) =>
  sceneStartSeconds(scenes, index);

export const totalDuration = (content: ContentPackage) =>
  productionDurationSeconds(content.scenes);

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

const TIMELINE_TICK_FRAMES = [
  1, 2, 5, 10, 15, 30, 60, 90, 150, 300, 450, 900, 1800,
] as const;

export const timelineTicks = (duration: number, width: number) => {
  const safeDuration = Math.max(duration, 1 / VIDEO_FPS);
  const pixelsPerSecond = Math.max(width, 1) / safeDuration;
  const targetFrames = (72 / pixelsPerSecond) * VIDEO_FPS;
  const stepFrames =
    TIMELINE_TICK_FRAMES.find((frames) => frames >= targetFrames) ??
    TIMELINE_TICK_FRAMES.at(-1)!;
  const stepSeconds = stepFrames / VIDEO_FPS;
  const ticks = Array.from(
    { length: Math.floor(safeDuration / stepSeconds) + 1 },
    (_, index) => Math.min(safeDuration, index * stepSeconds),
  );
  if (ticks.at(-1)! < safeDuration - 1 / VIDEO_FPS) ticks.push(safeDuration);
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
  sceneIds: string[];
  gapAfterSceneIds?: string[];
  playheadSeconds?: number;
  sourceLedgerArtifact: Artifact | null;
  extraArtifactIds?: string[];
}): EditorSelection => {
  const selected = input.content.scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => input.sceneIds.includes(scene.id));
  if (selected.length === 0) throw new Error("scene_not_found");

  const first = selected[0]!;
  const last = selected.at(-1)!;
  const artifactIds = [
    ...new Set([
      ...selected.flatMap(({ scene }) => sceneArtifacts(scene)),
      ...effectiveAudioTracks(input.content).flatMap((track) =>
        track.clips.flatMap((clip) =>
          input.sceneIds.includes(clip.scene_id)
            ? [
                clip.artifact_id,
                clip.transcript_artifact_id,
                clip.captions_artifact_id,
              ].filter((id): id is string => Boolean(id))
            : [],
        ),
      ),
      ...(input.extraArtifactIds ?? []),
    ]),
  ];
  if (
    selected.some(({ scene }) => scene.claim_ids.length > 0) &&
    input.sourceLedgerArtifact
  ) {
    artifactIds.push(input.sourceLedgerArtifact.id);
  }

  const selectedGapIds = new Set(input.gapAfterSceneIds ?? []);
  return {
    project_id: input.projectId,
    base_content_package_artifact_id: input.contentArtifactId,
    scene_ids: selected.map(({ scene }) => scene.id),
    track_ids: [
      "visual",
      "voice",
      "caption",
      "transcript",
      "release",
      ...[...selectedGapIds].map((sceneId) => `gap_after_${sceneId}`),
      ...effectiveAudioTracks(input.content).map((track) => track.id),
    ],
    artifact_ids: artifactIds,
    playhead_seconds:
      input.playheadSeconds === undefined
        ? null
        : snapToFrame(Math.max(0, input.playheadSeconds)),
    time_range_seconds: {
      start: sceneOffset(input.content.scenes, first.index),
      end:
        sceneOffset(input.content.scenes, last.index) +
        last.scene.duration_seconds +
        (selectedGapIds.has(last.scene.id)
          ? (last.scene.gap_after_seconds ?? 0)
          : 0),
    },
  };
};
