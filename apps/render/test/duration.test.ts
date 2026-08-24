import { describe, expect, it } from "vitest";

import { getDurationInFrames, FPS } from "../src/GreenlightFilm";
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
});
