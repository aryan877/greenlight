import {
  applyEditorPatch,
  contentPackageSchema,
  editorPatchInputSchema,
  type EditorPatchInput,
} from "@greenlight/contracts";

import { hashJson } from "../lib/canonical.js";
import type { ArtifactStore } from "../storage/artifacts.js";
import type { GreenlightStore } from "../storage/store.js";

export const saveEditorPatch = async (input: {
  artifacts: ArtifactStore;
  producer: "creator" | "trueforge";
  request: EditorPatchInput;
  store: GreenlightStore;
}) => {
  const request = editorPatchInputSchema.parse(input.request);
  const { selection } = request;
  const baseArtifact = input.artifacts.resolveArtifact(
    selection.base_content_package_artifact_id,
  );
  if (
    baseArtifact.artifact.project_id !== selection.project_id ||
    baseArtifact.artifact.kind !== "content_package"
  ) {
    throw new Error("invalid_base_content_package");
  }
  if (!input.store.getProject(selection.project_id)) {
    throw new Error("project_not_found");
  }
  const latestContent = input.store.getLatestArtifact(
    selection.project_id,
    "content_package",
  );
  if (latestContent?.id !== selection.base_content_package_artifact_id) {
    throw new Error("stale_content_package");
  }

  const base = contentPackageSchema.parse(
    await input.artifacts.readJson(selection.base_content_package_artifact_id),
  );
  const revised = applyEditorPatch(base, request);
  const requireArtifactKind = (artifactId: string | null, kinds: string[]) => {
    if (!artifactId) return;
    const resolved = input.artifacts.resolveArtifact(artifactId).artifact;
    if (
      resolved.project_id !== selection.project_id ||
      !kinds.includes(resolved.kind)
    ) {
      throw new Error("invalid_scene_media_artifact");
    }
  };
  for (const scene of revised.scenes) {
    for (const artifactId of scene.visual.artifact_ids) {
      requireArtifactKind(artifactId, ["image", "video", "thumbnail"]);
    }
    requireArtifactKind(scene.source_clip?.artifact_id ?? null, ["video"]);
    requireArtifactKind(scene.narration_artifact_id, ["narration"]);
    requireArtifactKind(scene.captions_artifact_id, ["caption"]);
    requireArtifactKind(scene.transcript_artifact_id, ["transcript"]);
  }
  for (const track of revised.localized_narration_tracks ?? []) {
    requireArtifactKind(track.narration_artifact_id, ["narration"]);
    requireArtifactKind(track.captions_artifact_id, ["caption"]);
    requireArtifactKind(track.transcript_artifact_id, ["transcript"]);
  }
  for (const track of revised.audio_tracks ?? []) {
    for (const clip of track.clips) {
      requireArtifactKind(clip.artifact_id, ["narration"]);
      requireArtifactKind(clip.captions_artifact_id, ["caption"]);
      requireArtifactKind(clip.transcript_artifact_id, ["transcript"]);
    }
  }

  const permittedSceneIds = new Set(selection.scene_ids);
  for (const operation of request.operations) {
    if (operation.type === "split_scene") {
      permittedSceneIds.add(operation.second.id);
    }
  }
  const requireArtifactScope = (artifactId: string | null) => {
    if (!artifactId || selection.artifact_ids.includes(artifactId)) return;
    const artifact = input.artifacts.resolveArtifact(artifactId).artifact;
    const sceneId = artifact.provenance.scene_id;
    if (typeof sceneId !== "string" || !permittedSceneIds.has(sceneId)) {
      throw new Error("artifact_outside_selection");
    }
  };
  for (const operation of request.operations) {
    if (operation.type === "update_scene") {
      for (const artifactId of operation.visual?.artifact_ids ?? []) {
        requireArtifactScope(artifactId);
      }
      requireArtifactScope(operation.narration_artifact_id ?? null);
      requireArtifactScope(operation.captions_artifact_id ?? null);
      requireArtifactScope(operation.transcript_artifact_id ?? null);
      requireArtifactScope(operation.source_clip?.artifact_id ?? null);
    }
    if (operation.type === "split_scene") {
      for (const scene of [operation.first, operation.second]) {
        for (const artifactId of scene.visual.artifact_ids) {
          requireArtifactScope(artifactId);
        }
        requireArtifactScope(scene.narration_artifact_id);
        requireArtifactScope(scene.captions_artifact_id);
        requireArtifactScope(scene.transcript_artifact_id);
      }
    }
    if (operation.type === "upsert_audio_track") {
      for (const clip of operation.track.clips) {
        requireArtifactScope(clip.artifact_id);
        requireArtifactScope(clip.captions_artifact_id);
        requireArtifactScope(clip.transcript_artifact_id);
      }
    }
  }

  const patchArtifact = await input.artifacts.importJson({
    projectId: selection.project_id,
    kind: "edit_patch",
    value: {
      version: 1,
      ...request,
      base_content_package_sha256: baseArtifact.artifact.sha256,
      result_content_package_hash: hashJson(revised),
      created_at: new Date().toISOString(),
    },
    provenance: {
      producer: input.producer,
      base_content_package_artifact_id:
        selection.base_content_package_artifact_id,
      contract_version: 1,
    },
  });
  const contentArtifact = await input.artifacts.importJson({
    projectId: selection.project_id,
    kind: "content_package",
    value: revised,
    provenance: {
      producer: input.producer,
      parent_content_package_artifact_id:
        selection.base_content_package_artifact_id,
      edit_patch_artifact_id: patchArtifact.id,
      contract_version: 1,
    },
  });
  return {
    patch_artifact: patchArtifact,
    content_package_artifact: contentArtifact,
    project: input.store.setProjectStage(selection.project_id, "packaged"),
  };
};
