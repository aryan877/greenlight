import type { ContentPackage } from "@greenlight/contracts";
import { describe, expect, it } from "vitest";

import { timelineAudioSources } from "./timeline-audio.js";

const contentPackageFixture = (): ContentPackage => ({
  version: 1,
  project_id: "project_audio",
  headline: "Audio",
  dek: "Audio monitor fixture",
  scenes: [
    {
      id: "scene_audio",
      kind: "hook",
      title: "Audio",
      narration: "Voice",
      narration_artifact_id: "artifact_voice",
      captions_artifact_id: null,
      transcript_artifact_id: null,
      claim_ids: [],
      duration_seconds: 4,
      playback_rate: 1,
      visual: {
        treatment: "type",
        prompt: null,
        artifact_ids: [],
        accent: "signal",
      },
    },
  ],
  localized_narration_tracks: [],
  release: {
    thumbnail_artifact_id: null,
    destination: "unlisted",
    publish_at: null,
  },
  metadata: {
    title: "Audio",
    description: "Audio",
    tags: [],
    category_id: "28",
    made_for_kids: false,
    contains_synthetic_media: true,
  },
});

describe("timelineAudioSources", () => {
  it("keeps editing playback independent from export policy", () => {
    const content = contentPackageFixture();
    content.scenes[0]!.playback_rate = 1.5;
    content.audio_tracks = [
      {
        id: "track_voice",
        name: "Narration",
        role: "narration",
        locale: null,
        voice_label: null,
        muted: false,
        solo: false,
        export_enabled: false,
        gain: 0.75,
        clips: [
          {
            id: "clip_voice",
            scene_id: content.scenes[0]!.id,
            label: "Voice",
            artifact_id: "artifact_voice",
            script: "Voice",
            transcript_artifact_id: null,
            captions_artifact_id: null,
            start_offset_seconds: 0.5,
            source_in_seconds: 1,
            source_out_seconds: 3,
            playback_rate: 2,
            status: "generated",
          },
        ],
      },
    ];

    expect(timelineAudioSources(content)).toEqual([
      {
        id: "clip_voice",
        artifactId: "artifact_voice",
        startSeconds: 0.5,
        endSeconds: 1.5,
        sourceInSeconds: 1,
        playbackRate: 3,
        gain: 0.75,
        duckingGain: 1,
        duckingWindows: [
          {
            startSeconds: 0.5,
            endSeconds: 1.5,
          },
        ],
      },
    ]);
  });

  it("respects mute and solo while monitoring", () => {
    const content = contentPackageFixture();
    const sceneId = content.scenes[0]!.id;
    const clip = (id: string) => ({
      id,
      scene_id: sceneId,
      label: id,
      artifact_id: `artifact_${id}`,
      script: id,
      transcript_artifact_id: null,
      captions_artifact_id: null,
      start_offset_seconds: 0,
      source_in_seconds: 0,
      source_out_seconds: null,
      playback_rate: 1,
      status: "generated" as const,
    });
    content.audio_tracks = [
      {
        id: "track_a",
        name: "A",
        role: "narration",
        locale: null,
        voice_label: null,
        muted: false,
        solo: false,
        export_enabled: true,
        gain: 1,
        clips: [clip("a")],
      },
      {
        id: "track_b",
        name: "B",
        role: "music",
        locale: null,
        voice_label: null,
        muted: false,
        solo: true,
        export_enabled: true,
        gain: 1,
        clips: [clip("b")],
      },
    ];

    expect(timelineAudioSources(content).map((source) => source.id)).toEqual([
      "b",
    ]);
  });
});
