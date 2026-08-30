import { describe, expect, it } from "vitest";

import {
  audioClipRenderPlacement,
  captionClipRenderPlacement,
  getDurationInFrames,
  FPS,
  narrationDuckingWindows,
} from "../src/greenlight-film";
import { fixturePackage } from "../src/fixture";

describe("GreenlightFilm", () => {
  it("derives duration from edge-to-edge scenes and explicit gaps", () => {
    const sceneFrames = fixturePackage.scenes.reduce(
      (total, scene) =>
        total +
        scene.duration_seconds * FPS +
        (scene.gap_after_seconds ?? 0) * FPS,
      0,
    );
    expect(getDurationInFrames(fixturePackage)).toBe(sceneFrames);
  });

  it("renders independent audio and caption timeline placements", () => {
    const content = structuredClone(fixturePackage);
    const scene = content.scenes[0]!;
    const captionClip = {
      id: "caption_scene_hook",
      scene_id: scene.id,
      label: scene.narration,
      artifact_id: null,
      transcript_artifact_id: null,
      timeline_start_seconds: 3,
      duration_seconds: 2,
    };
    const clip = {
      id: "clip_scene_hook",
      scene_id: scene.id,
      label: "Hook narration",
      artifact_id: null,
      script: scene.narration,
      transcript_artifact_id: null,
      captions_artifact_id: null,
      start_offset_seconds: 0,
      timeline_start_seconds: 5,
      source_in_seconds: 0,
      source_out_seconds: 8,
      duration_seconds: 3,
      playback_rate: 1,
      status: "draft" as const,
    };

    expect(audioClipRenderPlacement(content, clip)).toMatchObject({
      from: 5 * FPS,
      durationInFrames: 3 * FPS,
    });
    expect(captionClipRenderPlacement(captionClip)).toEqual({
      from: 3 * FPS,
      durationInFrames: 2 * FPS,
    });
  });

  it("keeps caption placement independent from narration artifact ownership", () => {
    const content = structuredClone(fixturePackage);
    const scene = content.scenes[0]!;
    scene.captions_artifact_id = "artifact_caption_hook";
    scene.transcript_artifact_id = "artifact_transcript_hook";
    const clip = {
      id: "caption_scene_hook",
      scene_id: scene.id,
      label: scene.narration,
      artifact_id: null,
      transcript_artifact_id: scene.transcript_artifact_id,
      timeline_start_seconds: 1,
      duration_seconds: 4,
    };

    expect(captionClipRenderPlacement(clip)).toEqual({
      from: FPS,
      durationInFrames: 4 * FPS,
    });
  });

  it("ducks only under narration clips that have a renderable artifact", () => {
    const content = structuredClone(fixturePackage);
    expect(narrationDuckingWindows(content, {})).toEqual([]);

    content.scenes[0]!.narration_artifact_id = "artifact_voice_hook";
    expect(
      narrationDuckingWindows(content, {
        artifact_voice_hook: "assets/voice-hook.wav",
      }),
    ).toEqual([{ from: 0, to: 8 * FPS }]);
  });
});
