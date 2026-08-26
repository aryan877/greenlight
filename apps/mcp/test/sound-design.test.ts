import { describe, expect, it } from "vitest";

import { generateSoundEffect } from "../src/providers/sound-design.js";

describe("local sound design", () => {
  it("generates a deterministic playable PCM WAV", () => {
    const input = {
      project_id: "project_sound_test",
      preset_id: "whoosh" as const,
      duration_seconds: 0.5,
      intensity: 0.75,
      variant: 2,
    };
    const first = generateSoundEffect(input);
    const second = generateSoundEffect(input);

    expect(first.bytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(first.bytes.subarray(8, 12).toString()).toBe("WAVE");
    expect(first.durationSeconds).toBe(0.5);
    expect(first.sampleRate).toBe(48_000);
    expect(first.bytes.equals(second.bytes)).toBe(true);
  });

  it("keeps variants distinct without a provider call", () => {
    const base = {
      project_id: "project_sound_test",
      preset_id: "glitch" as const,
      duration_seconds: 0.4,
      intensity: 0.75,
    };

    expect(
      generateSoundEffect({ ...base, variant: 0 }).bytes.equals(
        generateSoundEffect({ ...base, variant: 1 }).bytes,
      ),
    ).toBe(false);
  });
});
