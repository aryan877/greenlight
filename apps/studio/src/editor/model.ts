import type {
  Artifact,
  ContentPackage,
  EditorSelection,
  Scene,
} from "@greenlight/contracts";

export const sceneOffset = (scenes: Scene[], index: number) =>
  scenes
    .slice(0, index)
    .reduce((sum, scene) => sum + scene.duration_seconds, 0);

export const totalDuration = (content: ContentPackage) =>
  content.scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0);

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
  sourceLedgerArtifact: Artifact | null;
}): EditorSelection => {
  const selected = input.content.scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => input.sceneIds.includes(scene.id));
  if (selected.length === 0) throw new Error("scene_not_found");

  const first = selected[0]!;
  const last = selected.at(-1)!;
  const artifactIds = [
    ...new Set(selected.flatMap(({ scene }) => sceneArtifacts(scene))),
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
    scene_ids: selected.map(({ scene }) => scene.id),
    track_ids: ["visual", "voice", "caption", "transcript"],
    artifact_ids: artifactIds,
    time_range_seconds: {
      start: sceneOffset(input.content.scenes, first.index),
      end:
        sceneOffset(input.content.scenes, last.index) +
        last.scene.duration_seconds,
    },
  };
};
