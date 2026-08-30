import { describe, expect, it } from "vitest";

import {
  detectedBlackDurationSeconds,
  integratedLoudnessLufs,
} from "./quality.js";

describe("quality measurements", () => {
  it("sums blackdetect segments", () => {
    expect(
      detectedBlackDurationSeconds(
        "black_start:0 black_end:0.5 black_duration:0.5\nblack_start:4 black_end:4.3 black_duration:0.3",
      ),
    ).toBeCloseTo(0.8);
  });

  it("uses the final EBU R128 integrated loudness summary", () => {
    expect(
      integratedLoudnessLufs("I: -22.1 LUFS\nSummary:\nI: -14.3 LUFS"),
    ).toBe(-14.3);
    expect(integratedLoudnessLufs("I: -inf LUFS")).toBeNull();
  });
});
