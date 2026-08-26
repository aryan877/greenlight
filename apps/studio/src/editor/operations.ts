import {
  effectiveAudioTracks,
  effectiveCaptionTracks,
  effectiveTransitionTracks,
  effectiveVideoTracks,
  type ContentPackage,
  type EditorPatchOperation,
  type EditorTimelineItem,
  type EditorTimelineTrack,
} from "@greenlight/contracts";

import {
  audioItemId,
  captionItemId,
  snapToFrame,
  timelineItems,
  timelineTracks,
  transitionItemId,
  totalDuration,
  videoItemId,
} from "./model.js";

export type TimelineEditPlan = {
  operations: EditorPatchOperation[];
  sceneScope: "all" | "items";
};

export const BROLL_TRACK_ID = "track_broll";

export const buildBrollPlacementOperation = (
  content: ContentPackage,
  input: {
    artifactId: string;
    clipId: string;
    durationSeconds: number;
    label: string;
    licenseArtifactId: string;
    sceneId: string;
    sourceDurationSeconds: number;
    startSeconds: number;
  },
): EditorPatchOperation => {
  const existing = effectiveVideoTracks(content).find(
    (track) => track.id === BROLL_TRACK_ID,
  );
  const track = existing ?? {
    id: BROLL_TRACK_ID,
    name: "B-roll",
    kind: "video" as const,
    protected: false,
    visible: true,
    clips: [],
  };

  return {
    type: "upsert_video_track",
    track: {
      ...track,
      clips: [
        ...(track.clips ?? []),
        {
          id: input.clipId,
          scene_id: input.sceneId,
          label: input.label,
          artifact_id: input.artifactId,
          timeline_start_seconds: input.startSeconds,
          source_in_seconds: 0,
          source_out_seconds: input.durationSeconds,
          source_duration_seconds: input.sourceDurationSeconds,
          duration_seconds: input.durationSeconds,
          playback_rate: 1,
          fit: "cover",
          opacity: 1,
          provenance_artifact_id: input.licenseArtifactId,
        },
      ],
    },
  };
};

const unreachableTimelineItemKind = (kind: never): never => {
  throw new Error(`Unsupported timeline item kind: ${String(kind)}`);
};

export const maximumTimelineItemDuration = (
  content: ContentPackage,
  item: EditorTimelineItem,
) => {
  const scene = content.scenes.find(
    (candidate) => candidate.id === item.scene_id,
  );
  if (!scene) return item.end_seconds - item.start_seconds;
  switch (item.kind) {
    case "video": {
      const clip = effectiveVideoTracks(content)
        .flatMap((track) => track.clips ?? [])
        .find((candidate) => videoItemId(candidate.id) === item.id);
      if (clip) {
        return Math.min(
          (clip.source_out_seconds - clip.source_in_seconds) /
            clip.playback_rate,
          totalDuration(content) - item.start_seconds,
        );
      }
      const currentGap = scene.gap_after_seconds ?? 0;
      const sourceMaximum = scene.source_clip
        ? (scene.source_clip.source_duration_seconds -
            scene.source_clip.in_seconds) /
          scene.playback_rate
        : scene.duration_seconds;
      return Math.max(
        scene.duration_seconds,
        Math.min(sourceMaximum, scene.duration_seconds + currentGap),
      );
    }
    case "caption":
      return Math.min(
        scene.duration_seconds,
        totalDuration(content) - item.start_seconds,
      );
    case "audio": {
      const clip = effectiveAudioTracks(content)
        .flatMap((track) => track.clips)
        .find((candidate) => audioItemId(candidate.id) === item.id);
      if (!clip) return item.end_seconds - item.start_seconds;
      const sourceMaximum =
        clip.source_out_seconds === null
          ? scene.duration_seconds - clip.start_offset_seconds
          : (clip.source_out_seconds - clip.source_in_seconds) /
            clip.playback_rate;
      return Math.min(
        sourceMaximum,
        totalDuration(content) - item.start_seconds,
      );
    }
    case "transition":
      return Math.min(3, totalDuration(content) - item.start_seconds);
    default:
      return unreachableTimelineItemKind(item.kind);
  }
};

export const buildTimelineTrimPlan = (
  content: ContentPackage,
  item: EditorTimelineItem,
  nextDuration: number,
): TimelineEditPlan | null => {
  const scene = content.scenes.find(
    (candidate) => candidate.id === item.scene_id,
  );
  if (!scene) return null;
  switch (item.kind) {
    case "audio": {
      const clip = effectiveAudioTracks(content)
        .flatMap((track) => track.clips)
        .find((candidate) => audioItemId(candidate.id) === item.id);
      if (!clip) return null;
      return {
        sceneScope: "items",
        operations: [
          {
            type: "update_audio_clip",
            item_id: item.id,
            clip_id: clip.id,
            duration_seconds: nextDuration,
          },
        ],
      };
    }
    case "caption": {
      const clip = effectiveCaptionTracks(content)
        .flatMap((track) => track.clips)
        .find((candidate) => captionItemId(candidate.id) === item.id);
      if (!clip) return null;
      return {
        sceneScope: "items",
        operations: [
          {
            type: "update_caption_clip",
            item_id: item.id,
            clip_id: clip.id,
            duration_seconds: nextDuration,
          },
        ],
      };
    }
    case "video": {
      const clip = effectiveVideoTracks(content)
        .flatMap((track) => track.clips ?? [])
        .find((candidate) => videoItemId(candidate.id) === item.id);
      if (clip) {
        return {
          sceneScope: "items",
          operations: [
            {
              type: "update_video_clip",
              item_id: item.id,
              clip_id: clip.id,
              duration_seconds: nextDuration,
              source_out_seconds:
                clip.source_in_seconds + nextDuration * clip.playback_rate,
            },
          ],
        };
      }
      const currentGap = scene.gap_after_seconds ?? 0;
      const sourceClip = scene.source_clip
        ? {
            ...scene.source_clip,
            out_seconds:
              scene.source_clip.in_seconds + nextDuration * scene.playback_rate,
          }
        : undefined;
      return {
        sceneScope: "all",
        operations: [
          {
            type: "update_scene",
            scene_id: scene.id,
            duration_seconds: nextDuration,
            gap_after_seconds: Math.max(
              0,
              currentGap + scene.duration_seconds - nextDuration,
            ),
            ...(sourceClip ? { source_clip: sourceClip } : {}),
          },
        ],
      };
    }
    case "transition": {
      const clip = effectiveTransitionTracks(content)
        .flatMap((track) => track.clips)
        .find((candidate) => transitionItemId(candidate.id) === item.id);
      if (!clip) return null;
      return {
        sceneScope: "items",
        operations: [
          {
            type: "update_transition_clip",
            item_id: item.id,
            clip_id: clip.id,
            duration_seconds: nextDuration,
          },
        ],
      };
    }
    default:
      return unreachableTimelineItemKind(item.kind);
  }
};

export const buildTimelineMovePlan = (
  content: ContentPackage,
  input: {
    itemIds: string[];
    primaryItemId: string;
    deltaSeconds: number;
    targetTrackId: string | null;
    dropIndex: number;
  },
): TimelineEditPlan => {
  const items = timelineItems(content);
  const tracks = timelineTracks(content);
  const laneIndex = new Map(tracks.map((track, index) => [track.id, index]));
  const draggedItems = items.filter((item) => input.itemIds.includes(item.id));
  const explicitVideoItemIds = new Set(
    effectiveVideoTracks(content)
      .flatMap((track) => track.clips ?? [])
      .map((clip) => videoItemId(clip.id)),
  );
  const movingSceneIds = new Set(
    draggedItems
      .filter(
        (item) => item.kind === "video" && !explicitVideoItemIds.has(item.id),
      )
      .map((item) => item.scene_id),
  );
  const operations: EditorPatchOperation[] = [];

  if (movingSceneIds.size > 0) {
    const movingScenes = content.scenes.filter((scene) =>
      movingSceneIds.has(scene.id),
    );
    const order = content.scenes
      .filter((scene) => !movingSceneIds.has(scene.id))
      .map((scene) => scene.id);
    order.splice(input.dropIndex, 0, ...movingScenes.map((scene) => scene.id));
    if (
      !order.every((sceneId, index) => sceneId === content.scenes[index]?.id)
    ) {
      operations.push({ type: "reorder_scenes", scene_ids: order });
    }
  }

  const primaryItem = items.find((item) => item.id === input.primaryItemId);
  const primaryTrackIndex = primaryItem
    ? (laneIndex.get(primaryItem.track_id) ?? 0)
    : 0;
  const targetTrackIndex = input.targetTrackId
    ? (laneIndex.get(input.targetTrackId) ?? primaryTrackIndex)
    : primaryTrackIndex;
  const laneDelta = targetTrackIndex - primaryTrackIndex;
  const audioClips = effectiveAudioTracks(content).flatMap(
    (track) => track.clips,
  );
  const captionClips = effectiveCaptionTracks(content).flatMap(
    (track) => track.clips,
  );
  const videoClips = effectiveVideoTracks(content).flatMap(
    (track) => track.clips ?? [],
  );
  const transitionClips = effectiveTransitionTracks(content).flatMap(
    (track) => track.clips,
  );

  for (const item of draggedItems) {
    const currentTrackIndex = laneIndex.get(item.track_id) ?? 0;
    const candidateTrack = tracks[currentTrackIndex + laneDelta];
    const targetTrackId =
      candidateTrack?.kind === item.kind ? candidateTrack.id : item.track_id;
    switch (item.kind) {
      case "audio": {
        const clip = audioClips.find(
          (candidate) => audioItemId(candidate.id) === item.id,
        );
        if (!clip) break;
        if (input.deltaSeconds !== 0 || targetTrackId !== item.track_id) {
          operations.push({
            type: "update_audio_clip",
            item_id: item.id,
            clip_id: clip.id,
            target_track_id: targetTrackId,
            timeline_start_seconds: snapToFrame(
              item.start_seconds + input.deltaSeconds,
            ),
          });
        }
        break;
      }
      case "caption": {
        const clip = captionClips.find(
          (candidate) => captionItemId(candidate.id) === item.id,
        );
        if (!clip) break;
        if (input.deltaSeconds !== 0 || targetTrackId !== item.track_id) {
          operations.push({
            type: "update_caption_clip",
            item_id: item.id,
            clip_id: clip.id,
            target_track_id: targetTrackId,
            timeline_start_seconds: snapToFrame(
              item.start_seconds + input.deltaSeconds,
            ),
          });
        }
        break;
      }
      case "video":
        if (explicitVideoItemIds.has(item.id)) {
          const clip = videoClips.find(
            (candidate) => videoItemId(candidate.id) === item.id,
          );
          if (
            clip &&
            (input.deltaSeconds !== 0 || targetTrackId !== item.track_id)
          ) {
            operations.push({
              type: "update_video_clip",
              item_id: item.id,
              clip_id: clip.id,
              target_track_id: targetTrackId,
              timeline_start_seconds: snapToFrame(
                item.start_seconds + input.deltaSeconds,
              ),
            });
          }
          break;
        }
        if (targetTrackId !== item.track_id) {
          operations.push({
            type: "update_scene",
            scene_id: item.scene_id,
            video_track_id: targetTrackId,
          });
        }
        break;
      case "transition": {
        const clip = transitionClips.find(
          (candidate) => transitionItemId(candidate.id) === item.id,
        );
        if (
          clip &&
          (input.deltaSeconds !== 0 || targetTrackId !== item.track_id)
        ) {
          operations.push({
            type: "update_transition_clip",
            item_id: item.id,
            clip_id: clip.id,
            target_track_id: targetTrackId,
            cut_seconds: snapToFrame(clip.cut_seconds + input.deltaSeconds),
          });
        }
        break;
      }
      default:
        unreachableTimelineItemKind(item.kind);
    }
  }

  return {
    operations,
    sceneScope: movingSceneIds.size > 0 ? "all" : "items",
  };
};
