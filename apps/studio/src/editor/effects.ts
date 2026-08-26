import {
  effectiveTransitionTracks,
  effectiveVideoTracks,
  transitionPresetRegistry,
  VIDEO_FPS,
  type ContentPackage,
  type EditorPatchOperation,
  type EditorTimelineItem,
  type TransitionPresetId,
  type TransitionTimelineClip,
} from "@greenlight/contracts";

import { snapToFrame } from "./model.js";

type TransitionTrackOperation = Extract<
  EditorPatchOperation,
  { type: "upsert_transition_track" }
>;

export type TransitionTrackEdit = {
  operation: TransitionTrackOperation;
  clip: TransitionTimelineClip;
  leftItem: EditorTimelineItem;
  rightItem: EditorTimelineItem;
};

export const buildTransitionTrackEdit = ({
  content,
  items,
  targetSeconds,
  preset,
  createClipId,
}: {
  content: ContentPackage;
  items: EditorTimelineItem[];
  targetSeconds: number;
  preset: TransitionPresetId;
  createClipId: () => string;
}): TransitionTrackEdit | null => {
  const primaryTrack =
    effectiveVideoTracks(content).find((track) => track.protected) ??
    effectiveVideoTracks(content)[0];
  if (!primaryTrack) return null;

  const videoItems = items
    .filter(
      (item) => item.kind === "video" && item.track_id === primaryTrack.id,
    )
    .sort((left, right) => left.start_seconds - right.start_seconds);
  if (videoItems.length < 2) return null;

  const pairs = videoItems
    .slice(0, -1)
    .map((leftItem, index) => ({
      leftItem,
      rightItem: videoItems[index + 1]!,
      cutSeconds: videoItems[index + 1]!.start_seconds,
    }))
    .filter(
      ({ leftItem, rightItem }) =>
        Math.abs(leftItem.end_seconds - rightItem.start_seconds) <=
        1 / VIDEO_FPS,
    );
  if (pairs.length === 0) return null;
  const pair = pairs.reduce((nearest, candidate) =>
    Math.abs(candidate.cutSeconds - targetSeconds) <
    Math.abs(nearest.cutSeconds - targetSeconds)
      ? candidate
      : nearest,
  );

  const existingTrack = effectiveTransitionTracks(content).find(
    (track) => track.id === "track_transitions",
  );
  const track = existingTrack ?? {
    id: "track_transitions",
    name: "Transitions",
    kind: "transition" as const,
    protected: false,
    visible: true,
    clips: [],
  };
  const existingClip = track.clips.find(
    (clip) =>
      clip.from_item_id === pair.leftItem.id &&
      clip.to_item_id === pair.rightItem.id,
  );
  const definition = transitionPresetRegistry[preset];
  const clip: TransitionTimelineClip = {
    id: existingClip?.id ?? createClipId(),
    label: definition.label,
    from_item_id: pair.leftItem.id,
    to_item_id: pair.rightItem.id,
    cut_seconds: snapToFrame(pair.cutSeconds),
    duration_seconds: snapToFrame(definition.default_duration_seconds),
    preset_id: preset,
    parameters: existingClip?.parameters ?? {},
    sound_artifact_id: existingClip?.sound_artifact_id ?? null,
  };

  return {
    leftItem: pair.leftItem,
    rightItem: pair.rightItem,
    clip,
    operation: {
      type: "upsert_transition_track",
      track: {
        ...track,
        clips: existingClip
          ? track.clips.map((candidate) =>
              candidate.id === existingClip.id ? clip : candidate,
            )
          : [...track.clips, clip],
      },
    },
  };
};
