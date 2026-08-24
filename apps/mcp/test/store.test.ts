import { describe, expect, it } from "vitest";

import { hashJson, now } from "../src/lib/canonical.js";
import { GreenlightStore } from "../src/storage/store.js";

describe("GreenlightStore", () => {
  it("persists the explicit project state machine", () => {
    const store = new GreenlightStore(":memory:");
    const project = store.createProject({
      topic: "The last responsible moment in an agent workflow",
      audience: "builders",
      goal: "Show why public release should need approval",
      target_duration_seconds: 60,
      tone: "editorial",
    });

    expect(store.getProject(project.id)?.stage).toBe("brief");
    expect(store.setProjectStage(project.id, "researching").stage).toBe(
      "researching",
    );
    store.close();
  });

  it("returns an existing operation for one idempotency key", () => {
    const store = new GreenlightStore(":memory:");
    const project = store.createProject({
      topic: "Idempotent publishing for agent workflows",
      audience: "builders",
      goal: "Prevent duplicate external actions",
      target_duration_seconds: 60,
      tone: "direct",
    });
    const first = store.beginOperation({
      projectId: project.id,
      type: "upload_unlisted",
      idempotencyKey: "upload:project:package:channel",
      payload: { artifact: "video_001" },
    });
    store.finishOperation(first.id, { video_id: "youtube_001" });
    const second = store.beginOperation({
      projectId: project.id,
      type: "upload_unlisted",
      idempotencyKey: "upload:project:package:channel",
      payload: { artifact: "video_001" },
    });

    expect(second.existing).toBe(true);
    expect(second.result).toEqual({ video_id: "youtube_001" });
    store.close();
  });

  it("hashes release snapshots deterministically", () => {
    expect(hashJson({ b: 2, a: 1 })).toBe(hashJson({ a: 1, b: 2 }));
    expect(now()).toMatch(/Z$/);
  });
});
