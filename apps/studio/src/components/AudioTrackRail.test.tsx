import type { AudioTrack, Scene } from "@greenlight/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AudioTrackRail } from "./AudioTrackRail.js";

const scene = {
  id: "scene_audio_001",
  kind: "explanation",
  title: "One scene",
  narration: "One narration line.",
  narration_artifact_id: null,
  captions_artifact_id: null,
  transcript_artifact_id: null,
  claim_ids: [],
  duration_seconds: 10,
  playback_rate: 1,
  visual: {
    treatment: "type",
    prompt: null,
    artifact_ids: [],
    accent: "signal",
  },
} satisfies Scene;

const track = (id: string, name: string, role: AudioTrack["role"]) =>
  ({
    id,
    name,
    role,
    locale: role === "dub" ? "hi-IN" : null,
    voice_label: role === "music" ? null : "Kore",
    muted: false,
    solo: false,
    export_enabled: true,
    gain: 1,
    clips: [
      {
        id: `clip_${id}`,
        scene_id: scene.id,
        label: name,
        artifact_id: null,
        script: role === "music" ? null : scene.narration,
        transcript_artifact_id: null,
        captions_artifact_id: null,
        start_offset_seconds: 0,
        source_in_seconds: 0,
        source_out_seconds: null,
        playback_rate: 1,
        status: "draft",
      },
    ],
  }) satisfies AudioTrack;

describe("AudioTrackRail", () => {
  it("names every audio lane and exposes real mixer controls", () => {
    const html = renderToStaticMarkup(
      <AudioTrackRail
        audioTracks={[
          track("track_primary_voice", "Primary voice", "narration"),
          track("track_hindi_dub", "Hindi dub", "dub"),
          track("track_music_bed", "Music", "music"),
        ]}
        height={156}
        onChangeTrack={() => undefined}
        onRequestTrack={() => undefined}
        scenes={[scene]}
      />,
    );

    expect(html).toContain("Primary voice");
    expect(html).toContain("Hindi dub");
    expect(html).toContain("Music");
    expect(html).toContain('aria-label="Mute Hindi dub"');
    expect(html).toContain('aria-label="Hear only Hindi dub"');
    expect(html).toContain('aria-label="Exclude Hindi dub from export"');
  });
});
