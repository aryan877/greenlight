import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { hashJson, now } from "../src/lib/canonical.js";
import { GreenlightStore } from "../src/storage/store.js";

describe("GreenlightStore", () => {
  it("migrates legacy artifact uniqueness without losing references", async () => {
    const directory = await mkdtemp(join(tmpdir(), "greenlight-store-"));
    const path = join(directory, "legacy.sqlite");
    const legacy = new Database(path);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        stage TEXT NOT NULL,
        brief_json TEXT NOT NULL,
        blocker TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        kind TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        provenance_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(project_id, kind, sha256)
      );
      CREATE TABLE project_content_heads (
        project_id TEXT PRIMARY KEY REFERENCES projects(id),
        artifact_id TEXT NOT NULL REFERENCES artifacts(id),
        updated_at TEXT NOT NULL
      );
    `);
    const timestamp = "2026-08-30T00:00:00.000Z";
    legacy
      .prepare("INSERT INTO projects VALUES (?, 'brief', ?, NULL, ?, ?)")
      .run(
        "project_legacy",
        JSON.stringify({
          topic: "Legacy artifact migration",
          audience: "creators",
          goal: "Keep existing project references valid",
          target_duration_seconds: 30,
          tone: "clear",
        }),
        timestamp,
        timestamp,
      );
    legacy
      .prepare("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        "artifact_legacy",
        "project_legacy",
        "content_package",
        "f".repeat(64),
        "project_legacy/content_package/legacy.json",
        "application/json",
        2,
        "{}",
        timestamp,
      );
    legacy
      .prepare("INSERT INTO project_content_heads VALUES (?, ?, ?)")
      .run("project_legacy", "artifact_legacy", timestamp);
    legacy.close();

    const migrated = new GreenlightStore(path);
    try {
      expect(migrated.getArtifact("artifact_legacy")?.generation).toBeNull();
      expect(
        migrated.db
          .prepare(
            "SELECT artifact_id FROM project_content_heads WHERE project_id = ?",
          )
          .get("project_legacy"),
      ).toEqual({ artifact_id: "artifact_legacy" });
      expect(migrated.db.pragma("foreign_key_check")).toEqual([]);
      const schema = migrated.db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'",
        )
        .get() as { sql: string };
      expect(schema.sql).not.toContain("UNIQUE(project_id, kind, sha256)");
    } finally {
      migrated.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

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

  it("claims a private review release exactly once", () => {
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
      privacy: "private",
      created_at: now(),
    });

    store.claimRelease(release.id, "publishing");
    expect(() => store.claimRelease(release.id, "publishing")).toThrow(
      "release_not_staged",
    );
    store.rollbackReleaseClaim(release.id, "publishing");
    expect(store.getRelease(release.id)?.privacy).toBe("private");
    expect(() => store.rollbackReleaseClaim(release.id, "publishing")).toThrow(
      "release_rollback_failed",
    );
    store.close();
  });

  it("resumes local reconciliation after an external release succeeds", () => {
    const store = new GreenlightStore(":memory:");
    const project = store.createProject({
      topic: "Recovering an externally completed release",
      audience: "creators",
      goal: "Never report a successful publish as failed",
      target_duration_seconds: 60,
      tone: "precise",
    });
    const release = store.createRelease({
      id: "release_reconcile",
      project_id: project.id,
      youtube_video_id: "video_reconcile",
      channel_id: "channel_reconcile",
      video_sha256: "a".repeat(64),
      content_package_sha256: "b".repeat(64),
      metadata_sha256: "c".repeat(64),
      quality_report_sha256: "d".repeat(64),
      evidence_ledger_sha256: "e".repeat(64),
      privacy: "unlisted",
      created_at: now(),
    });
    const request = {
      project_id: project.id,
      youtube_release_id: release.id,
    };
    const operation = store.beginOperation({
      projectId: project.id,
      type: "youtube_publish",
      idempotencyKey: "publish:reconcile",
      payload: request,
    });
    store.claimRelease(release.id, "publishing");
    store.recordOperationExternalSuccess(operation.id, {
      youtube: { video_id: "video_reconcile", privacy_status: "public" },
    });

    const resumed = store.beginOperation({
      projectId: project.id,
      type: "youtube_publish",
      idempotencyKey: "publish:reconcile",
      payload: request,
    });
    expect(resumed.state).toBe("external_succeeded");
    expect(resumed.result).toMatchObject({
      youtube: { privacy_status: "public" },
    });

    const reconciledProject = store.reconcileReleaseSuccess({
      id: release.id,
      from: "publishing",
      privacy: "public",
      projectId: project.id,
    });
    const output = { youtube: resumed.result, project: reconciledProject };
    store.finishOperation(operation.id, output);

    expect(store.getRelease(release.id)?.privacy).toBe("public");
    expect(store.getProject(project.id)?.stage).toBe("released");
    expect(
      store.beginOperation({
        projectId: project.id,
        type: "youtube_publish",
        idempotencyKey: "publish:reconcile",
        payload: request,
      }).state,
    ).toBe("succeeded");
    store.close();
  });

  it("keeps separate attribution records for one content-addressed payload", () => {
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
      generation: null,
      provenance: { source: "local_import" },
      created_at: now(),
    };

    const first = store.saveArtifact(artifact);
    const second = store.saveArtifact({
      ...artifact,
      id: "artifact_second",
      provenance: { source: "second_import" },
      created_at: now(),
    });

    expect(second.id).not.toBe(first.id);
    expect(second.relative_path).toBe(first.relative_path);
    expect(second.provenance.source).toBe("second_import");
    expect(store.listArtifacts(project.id)).toHaveLength(2);
    store.close();
  });

  it("lists projects with artifact counts in one store query", () => {
    const store = new GreenlightStore(":memory:");
    const first = store.createProject({
      topic: "A multilingual production",
      audience: "creators",
      goal: "Edit every language from one timeline",
      target_duration_seconds: 60,
      tone: "direct",
    });
    const second = store.createProject({
      topic: "A clean production history",
      audience: "editors",
      goal: "Open prior work without scanning every artifact",
      target_duration_seconds: 60,
      tone: "precise",
    });
    store.saveArtifact({
      id: "artifact_counted",
      project_id: first.id,
      kind: "image",
      sha256: "b".repeat(64),
      relative_path: `${first.id}/image/${"b".repeat(64)}.png`,
      mime_type: "image/png",
      byte_size: 8,
      generation: null,
      provenance: { source: "test" },
      created_at: now(),
    });

    const counts = new Map(
      store
        .listProjectsWithArtifactCounts()
        .map(({ project, artifactCount }) => [project.id, artifactCount]),
    );
    expect(counts.get(first.id)).toBe(1);
    expect(counts.get(second.id)).toBe(0);
    expect(store.countArtifacts(first.id)).toBe(1);
    store.close();
  });
});
