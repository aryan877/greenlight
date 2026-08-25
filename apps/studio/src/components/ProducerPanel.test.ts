import { describe, expect, it } from "vitest";

import { attachProducerSceneReference } from "../editor/producer-draft.js";

describe("Producer composer references", () => {
  it("keeps dropped scenes as deduplicated structured references", () => {
    const first = attachProducerSceneReference([], {
      sceneId: "scene_edit",
      title: "Edit one scene",
    });
    const second = attachProducerSceneReference(first, {
      sceneId: "scene_build",
      title: "Build it that way",
    });

    expect(second.map(({ sceneId }) => sceneId)).toEqual([
      "scene_edit",
      "scene_build",
    ]);
    expect(
      attachProducerSceneReference(second, {
        sceneId: "scene_edit",
        title: "Edit one scene",
      }),
    ).toBe(second);
  });
});
