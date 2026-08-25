import {
  applyEditorPatch,
  type Artifact,
  type ContentPackage,
  type EditorPatchInput,
} from "@greenlight/contracts";

import { greenlightApi } from "../api/greenlight.js";
import { formatTime, sceneOffset } from "../editor/model.js";
import { SceneCanvas } from "./ProgramMonitor.js";

const affectedSceneIds = (patch: EditorPatchInput) => [
  ...new Set(
    patch.operations.flatMap((operation) => {
      if (operation.type === "split_scene") {
        return [operation.scene_id, operation.second.id];
      }
      if (operation.type === "reorder_scenes") return operation.scene_ids;
      if (operation.type === "upsert_localized_track") {
        return [operation.track.scene_id];
      }
      if (operation.type === "upsert_audio_track") {
        return operation.track.clips.map((clip) => clip.scene_id);
      }
      return "scene_id" in operation ? [operation.scene_id] : [];
    }),
  ),
];

export const EditPatchPreview = ({
  artifacts,
  content,
  patch,
}: {
  artifacts: Artifact[];
  content: ContentPackage;
  patch: EditorPatchInput;
}) => {
  let revised: ContentPackage;
  try {
    revised = applyEditorPatch(content, patch);
  } catch {
    return null;
  }
  const sceneId = affectedSceneIds(patch)[0];
  const patchedIds = new Set(affectedSceneIds(patch));
  const affectedIndexes = content.scenes.flatMap((scene, index) =>
    patchedIds.has(scene.id) ? [index] : [],
  );
  const beforeIndex = Math.min(...affectedIndexes);
  const lastBeforeIndex = Math.max(...affectedIndexes);
  const before = content.scenes[beforeIndex];
  if (!before) return null;
  const beforeRange = content.scenes.slice(beforeIndex, lastBeforeIndex + 1);
  const afterRange = revised.scenes.filter((scene) => patchedIds.has(scene.id));
  const after = revised.scenes.find((scene) => scene.id === sceneId) ?? null;
  const sourceArtifact =
    beforeRange.length === 1 && before.source_clip
      ? artifacts.find(
          (artifact) => artifact.id === before.source_clip?.artifact_id,
        )
      : null;
  const renderedArtifact = artifacts
    .filter(
      (artifact) =>
        artifact.kind === "video" &&
        artifact.provenance.content_package_artifact_id ===
          patch.selection.base_content_package_artifact_id,
    )
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  const video = sourceArtifact ?? renderedArtifact ?? null;
  const rangeStart = sceneOffset(content.scenes, beforeIndex);
  const rangeEnd =
    sceneOffset(content.scenes, lastBeforeIndex) +
    content.scenes[lastBeforeIndex]!.duration_seconds;
  const sourceStart = sourceArtifact
    ? (before.source_clip?.in_seconds ?? 0)
    : rangeStart;
  const sourceEnd = sourceArtifact
    ? (before.source_clip?.out_seconds ?? before.duration_seconds)
    : rangeEnd;
  const operation = patch.operations.find(
    (candidate) => "scene_id" in candidate && candidate.scene_id === sceneId,
  );
  const localMarkerSeconds =
    operation?.type === "split_scene"
      ? operation.first.duration_seconds
      : operation?.type === "update_scene" &&
          operation.duration_seconds !== undefined
        ? operation.duration_seconds
        : null;
  const markerSeconds =
    localMarkerSeconds === null
      ? null
      : sceneOffset(
          content.scenes,
          operation && "scene_id" in operation
            ? content.scenes.findIndex(
                (scene) => scene.id === operation.scene_id,
              )
            : beforeIndex,
        ) -
        rangeStart +
        localMarkerSeconds;
  const beforeDuration = rangeEnd - rangeStart;
  const afterDuration = afterRange.reduce(
    (total, scene, index) =>
      total +
      scene.duration_seconds +
      (index < afterRange.length - 1 ? (scene.gap_after_seconds ?? 0) : 0),
    0,
  );
  const markerPercent =
    markerSeconds === null
      ? null
      : Math.min(100, Math.max(0, (markerSeconds / beforeDuration) * 100));
  const label =
    operation?.type === "split_scene"
      ? "Split"
      : operation?.type === "update_scene" &&
          operation.playback_rate !== undefined
        ? `${operation.playback_rate.toFixed(2)}×`
        : "New end";

  return (
    <div className="mt-3 overflow-hidden border border-warning/20 bg-surface">
      {video ? (
        <div className="relative aspect-video overflow-hidden bg-[#f8faf9]">
          <video
            controls
            preload="metadata"
            playsInline
            onLoadedMetadata={(event) => {
              event.currentTarget.playbackRate = sourceArtifact
                ? before.playback_rate
                : 1;
            }}
            src={`${greenlightApi.artifactUrl(video.id)}#t=${sourceStart.toFixed(3)},${sourceEnd.toFixed(3)}`}
            className="block size-full object-contain"
          />
          {markerPercent !== null ? (
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-warning"
              style={{ left: `${markerPercent}%` }}
            >
              <span className="absolute left-1 top-1 bg-warning px-1.5 py-0.5 font-mono text-[8px] text-white">
                {label} · {formatTime(markerSeconds ?? 0)}
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="relative aspect-video overflow-hidden bg-[#f8faf9]">
          <SceneCanvas scene={after ?? before} artifacts={artifacts} />
          {markerPercent !== null ? (
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-warning"
              style={{ left: `${markerPercent}%` }}
            >
              <span className="absolute left-1 top-1 bg-warning px-1.5 py-0.5 font-mono text-[8px] text-white">
                {label} · {formatTime(markerSeconds ?? 0)}
              </span>
            </div>
          ) : null}
        </div>
      )}
      <div className="px-3 py-2.5">
        <div className="relative flex h-6 overflow-hidden border-y border-line bg-surface-sunken">
          {beforeRange.map((scene) => (
            <div
              key={scene.id}
              className="min-w-0 border-r border-surface bg-track-video px-1.5 py-1 text-[8px] text-ink last:border-r-0"
              style={{
                width: `${(scene.duration_seconds / beforeDuration) * 100}%`,
              }}
            >
              <span className="block truncate">{scene.title}</span>
            </div>
          ))}
          {markerPercent !== null ? (
            <div
              className="absolute inset-y-0 w-px bg-warning"
              style={{ left: `${markerPercent}%` }}
            />
          ) : null}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[8px] text-ink-caption">
          <span>{formatTime(0)}</span>
          <span>{formatTime(beforeDuration)}</span>
        </div>
        {afterRange.length > 0 ? (
          <div className="mt-2 flex h-5 overflow-hidden border border-line-subtle">
            {afterRange.map((scene) => (
              <div
                key={scene.id}
                className="min-w-0 border-r border-surface bg-warning-soft px-1.5 py-0.5 text-[8px] text-ink-secondary last:border-r-0"
                style={{
                  width: `${afterDuration > 0 ? (scene.duration_seconds / afterDuration) * 100 : 100}%`,
                }}
              >
                <span className="block truncate">{scene.title}</span>
              </div>
            ))}
          </div>
        ) : null}
        <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-ink-secondary">
          {afterRange.length > 1
            ? `${afterRange.length} scenes in the proposed range`
            : (after?.narration ?? before.narration)}
        </p>
        <div className="mt-2 flex items-center gap-2 text-[9px] text-ink-tertiary">
          <span>{formatTime(beforeDuration)} before</span>
          <span aria-hidden="true">→</span>
          <span className="font-medium text-ink-secondary">
            {afterRange.length > 0 ? formatTime(afterDuration) : "removed"}{" "}
            after
          </span>
          {after?.gap_after_seconds ? (
            <span className="ml-auto text-warning">
              {formatTime(after.gap_after_seconds)} gap
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
