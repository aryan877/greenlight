import { describe, expect, it } from "vitest";

import { analyzePcm, normalizationGain } from "./audio-waveforms.js";

describe("audio waveform analysis", () => {
  it("returns stable peaks and RMS from decoded samples", () => {
    const result = analyzePcm(new Float32Array([0, 0.5, -1, 0.25]), 2);
    expect(result.peaks).toEqual([0.5, 1]);
    expect(result.peak).toBe(1);
    expect(result.rms).toBeCloseTo(0.573, 3);
  });

  it("targets a quieter bed for music than narration", () => {
    expect(normalizationGain(0.1, "narration")).toBeCloseTo(1.26);
    expect(normalizationGain(0.1, "music")).toBeCloseTo(0.63);
    expect(normalizationGain(0, "music")).toBe(1);
  });
});
