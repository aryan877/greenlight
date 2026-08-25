import {
  effectiveAudioTracks,
  productionDurationSeconds,
  scenePresentationDurationSeconds,
  sceneStartSeconds,
  VIDEO_FPS,
  type Artifact,
  type ContentPackage,
  type EditorSelection,
  type Scene,
} from "@greenlight/contracts";

export const sceneOffset = (scenes: Scene[], index: number) =>
  sceneStartSeconds(scenes, index);

export const totalDuration = (content: ContentPackage) =>
  productionDurationSeconds(content.scenes);

export const sceneTimelineDuration = (scenes: Scene[], index: number) => {
  return scenePresentationDurationSeconds(scenes, index);
};

export const snapToFrame = (seconds: number) =>
  Math.round(seconds * VIDEO_FPS) / VIDEO_FPS;

export const snapTimelineSeconds = (
  seconds: number,
  pixelsPerSecond: number,
  candidates: number[] = [],
) => {
  const frameTime = snapToFrame(seconds);
  const thresholdSeconds = 7 / Math.max(pixelsPerSecond, 1);
  const meaningful = [Math.round(frameTime), ...candidates]
    .map(snapToFrame)
    .filter((candidate) => Math.abs(candidate - frameTime) <= thresholdSeconds)
    .sort(
      (left, right) => Math.abs(left - frameTime) - Math.abs(right - frameTime),
    );
  return meaningful[0] ?? frameTime;
};

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
      ...[...selectedGapIds].map((sceneId) => `gap_after_${sceneId}`),
      ...effectiveAudioTracks(input.content).map((track) => track.id),
    ],
    artifact_ids: artifactIds,
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
