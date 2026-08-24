import { describe, expect, it } from "vitest";

import {
  getDurationInFrames,
  FPS,
  TRANSITION_FRAMES,
} from "../src/GreenlightFilm";
import { fixturePackage } from "../src/fixture";

describe("GreenlightFilm", () => {
  it("derives duration from scenes and transition overlap", () => {
    const sceneFrames = fixturePackage.scenes.reduce(
      (total, scene) => total + scene.duration_seconds * FPS,
      0,
    );
    expect(getDurationInFrames(fixturePackage)).toBe(
      sceneFrames - (fixturePackage.scenes.length - 1) * TRANSITION_FRAMES,
    );
  });
});
