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

  it("rejects an idempotency key reused for different work", () => {
    const store = new GreenlightStore(":memory:");
    const project = store.createProject({
      topic: "Exact replay boundaries for consequential agent actions",
      audience: "builders",
      goal: "Never return one operation result for a different request",
      target_duration_seconds: 60,
      tone: "precise",
    });
    store.beginOperation({
      projectId: project.id,
      type: "youtube_publish",
      idempotencyKey: "publish:one-stable-key",
      payload: { release: "release_001" },
    });

    expect(() =>
      store.beginOperation({
        projectId: project.id,
        type: "youtube_publish",
        idempotencyKey: "publish:one-stable-key",
        payload: { release: "release_002" },
      }),
    ).toThrow("idempotency_key_conflict");
    store.close();
  });

  it("hashes release snapshots deterministically", () => {
    expect(hashJson({ b: 2, a: 1 })).toBe(hashJson({ a: 1, b: 2 }));
    expect(now()).toMatch(/Z$/);
  });

  it("claims an unlisted release exactly once", () => {
    const store = new GreenlightStore(":memory:");
    const project = store.createProject({
      topic: "One deliberate public release boundary",
      audience: "creators",
      goal: "Prevent competing publish requests",
      target_duration_seconds: 60,
      tone: "precise",
    });
    const release = store.createRelease({
      id: "release_001",
      project_id: project.id,
      youtube_video_id: "video_001",
      channel_id: "channel_001",
      video_sha256: "a".repeat(64),
      content_package_sha256: "e".repeat(64),
      metadata_sha256: "b".repeat(64),
      quality_report_sha256: "c".repeat(64),
      evidence_ledger_sha256: "d".repeat(64),
      privacy: "unlisted",
      created_at: now(),
    });

    store.claimRelease(release.id, "publishing");
    expect(() => store.claimRelease(release.id, "publishing")).toThrow(
      "release_not_unlisted",
    );
    store.completeRelease(release.id, "publishing", "public");
    expect(store.getRelease(release.id)?.privacy).toBe("public");
    store.close();
  });

  it("returns the existing immutable artifact for identical content", () => {
    const store = new GreenlightStore(":memory:");
    const project = store.createProject({
      topic: "Content addressed media inside one production workspace",
      audience: "video editors",
      goal: "Keep repeat imports stable without duplicating the payload",
      target_duration_seconds: 60,
      tone: "precise",
    });
    const artifact = {
      id: "artifact_first",
      project_id: project.id,
      kind: "image" as const,
      sha256: "a".repeat(64),
      relative_path: `${project.id}/image/${"a".repeat(64)}.png`,
      mime_type: "image/png",
      byte_size: 8,
      provenance: { source: "local_import" },
      created_at: now(),
    };

    const first = store.saveArtifact(artifact);
    const second = store.saveArtifact({
      ...artifact,
      id: "artifact_second",
      created_at: now(),
    });

    expect(second.id).toBe(first.id);
    expect(store.listArtifacts(project.id)).toHaveLength(1);
    store.close();
  });
});
