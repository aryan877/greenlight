import {
  effectiveAudioTracks,
  effectiveCaptionTracks,
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
  totalDuration,
} from "./model.js";

export type TimelineEditPlan = {
  operations: EditorPatchOperation[];
  sceneScope: "all" | "items";
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
  const movingSceneIds = new Set(
    draggedItems
      .filter((item) => item.kind === "video")
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
        if (targetTrackId !== item.track_id) {
          operations.push({
            type: "update_scene",
            scene_id: item.scene_id,
            video_track_id: targetTrackId,
          });
        }
        break;
      default:
        unreachableTimelineItemKind(item.kind);
    }
  }

  return {
    operations,
    sceneScope: movingSceneIds.size > 0 ? "all" : "items",
  };
};
