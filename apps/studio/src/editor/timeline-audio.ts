import {
  audioClipDurationSeconds,
  effectiveAudioTracks,
  type ContentPackage,
} from "@greenlight/contracts";

import { sceneOffset } from "./model.js";

export type TimelineAudioSource = {
  id: string;
  artifactId: string;
  startSeconds: number;
  endSeconds: number;
  sourceInSeconds: number;
  playbackRate: number;
  gain: number;
};

export const timelineAudioSources = (
  content: ContentPackage,
): TimelineAudioSource[] => {
  const tracks = effectiveAudioTracks(content);
  const hasSolo = tracks.some((track) => track.solo && !track.muted);

  return tracks.flatMap((track) => {
    if (track.muted || (hasSolo && !track.solo)) return [];

    return track.clips.flatMap((clip) => {
      if (!clip.artifact_id) return [];
      const sceneIndex = content.scenes.findIndex(
        (scene) => scene.id === clip.scene_id,
      );
      const scene = content.scenes[sceneIndex];
      if (!scene) return [];
      const startSeconds =
        clip.timeline_start_seconds ??
        sceneOffset(content.scenes, sceneIndex) + clip.start_offset_seconds;
      const durationSeconds = Math.max(
        0,
        audioClipDurationSeconds(clip, scene),
      );
      if (durationSeconds <= 0) return [];

      return [
        {
          id: clip.id,
          artifactId: clip.artifact_id,
          startSeconds,
          endSeconds: startSeconds + durationSeconds,
          sourceInSeconds: clip.source_in_seconds,
          playbackRate: clip.playback_rate * scene.playback_rate,
          gain: track.gain,
        },
      ];
    });
  });
};
