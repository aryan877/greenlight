import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  artifactSchema,
  projectBriefSchema,
  projectSchema,
  projectStageSchema,
  releaseSnapshotSchema,
  type Artifact,
  type Project,
  type ProjectBrief,
  type ProjectStage,
  type ReleaseSnapshot,
} from "@greenlight/contracts";

import { createId, hashJson, now } from "../lib/canonical.js";

type ProjectRow = {
  id: string;
  stage: string;
  brief_json: string;
  blocker: string | null;
  created_at: string;
  updated_at: string;
};

type ArtifactRow = {
  id: string;
  project_id: string;
  kind: string;
  sha256: string;
  relative_path: string;
  mime_type: string;
  byte_size: number;
  generation_json: string | null;
  provenance_json: string;
  created_at: string;
};

type ReleaseRow = {
  id: string;
  project_id?: string;
  youtube_video_id?: string;
  channel_id?: string;
  snapshot_json: string;
  snapshot_sha256: string;
  privacy: string;
  created_at?: string;
};

const migrations = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  blocker TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  generation_json TEXT,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, kind, sha256)
);

CREATE TABLE IF NOT EXISTS project_content_heads (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,
  state TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  input_sha256 TEXT NOT NULL,
  result_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  youtube_video_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL UNIQUE,
  privacy TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS artifacts_project_idx ON artifacts(project_id, created_at);
CREATE INDEX IF NOT EXISTS operations_project_idx ON operations(project_id, created_at);
CREATE INDEX IF NOT EXISTS releases_project_idx ON releases(project_id, created_at);
`;

const toProject = (row: ProjectRow): Project =>
  projectSchema.parse({
    id: row.id,
    stage: row.stage,
    brief: JSON.parse(row.brief_json),
    blocker: row.blocker,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });

const toArtifact = (row: ArtifactRow): Artifact =>
  artifactSchema.parse({
    id: row.id,
    project_id: row.project_id,
    kind: row.kind,
    sha256: row.sha256,
    relative_path: row.relative_path,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    generation: row.generation_json ? JSON.parse(row.generation_json) : null,
    provenance: JSON.parse(row.provenance_json),
    created_at: row.created_at,
  });

export class GreenlightStore {
  readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec(migrations);
    const artifactColumns = this.db
      .prepare("PRAGMA table_info(artifacts)")
      .all() as Array<{ name: string }>;
    if (!artifactColumns.some((column) => column.name === "generation_json")) {
      this.db.exec("ALTER TABLE artifacts ADD COLUMN generation_json TEXT");
    }
  }

  close(): void {
    this.db.close();
  }

  createProject(input: ProjectBrief): Project {
    const brief = projectBriefSchema.parse(input);
    const timestamp = now();
    const project = projectSchema.parse({
      id: createId("project"),
      brief,
      stage: "brief",
      blocker: null,
      created_at: timestamp,
      updated_at: timestamp,
    });
    this.db
      .prepare(
        `INSERT INTO projects
          (id, stage, brief_json, blocker, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.stage,
        JSON.stringify(project.brief),
        project.blocker,
        project.created_at,
        project.updated_at,
      );
    return project;
  }

  getProject(id: string): Project | null {
    const row = this.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }

  listProjects(): Project[] {
    const rows = this.db
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all() as ProjectRow[];
    return rows.map(toProject);
  }

  listProjectsWithArtifactCounts(): Array<{
    project: Project;
    artifactCount: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT projects.*, COUNT(artifacts.id) AS artifact_count
         FROM projects
         LEFT JOIN artifacts ON artifacts.project_id = projects.id
         GROUP BY projects.id
         ORDER BY projects.updated_at DESC`,
      )
      .all() as Array<ProjectRow & { artifact_count: number }>;
    return rows.map((row) => ({
      project: toProject(row),
      artifactCount: row.artifact_count,
    }));
  }

  countArtifacts(projectId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM artifacts WHERE project_id = ?")
      .get(projectId) as { count: number };
    return row.count;
  }

  setProjectStage(
    id: string,
    stageInput: ProjectStage,
    blocker: string | null = null,
  ): Project {
    const stage = projectStageSchema.parse(stageInput);
    const timestamp = now();
    const result = this.db
      .prepare(
        "UPDATE projects SET stage = ?, blocker = ?, updated_at = ? WHERE id = ?",
      )
      .run(stage, blocker, timestamp, id);
    if (result.changes !== 1) throw new Error("project_not_found");
    return this.getProject(id)!;
  }

  saveArtifact(artifact: Artifact): Artifact {
    const valid = artifactSchema.parse(artifact);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO artifacts
          (id, project_id, kind, sha256, relative_path, mime_type, byte_size, generation_json, provenance_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        valid.id,
        valid.project_id,
        valid.kind,
        valid.sha256,
        valid.relative_path,
        valid.mime_type,
        valid.byte_size,
        valid.generation ? JSON.stringify(valid.generation) : null,
        JSON.stringify(valid.provenance),
        valid.created_at,
      );
    const saved = this.db
      .prepare(
        "SELECT * FROM artifacts WHERE project_id = ? AND kind = ? AND sha256 = ?",
      )
      .get(valid.project_id, valid.kind, valid.sha256) as
      ArtifactRow | undefined;
    if (!saved) throw new Error("artifact_save_failed");
    return toArtifact(saved);
  }

  getArtifact(id: string): Artifact | null {
    const row = this.db
      .prepare("SELECT * FROM artifacts WHERE id = ?")
      .get(id) as ArtifactRow | undefined;
    return row ? toArtifact(row) : null;
  }

  listArtifacts(projectId: string): Artifact[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at ASC, rowid ASC",
      )
      .all(projectId) as ArtifactRow[];
    return rows.map(toArtifact);
  }

  getLatestArtifact(
    projectId: string,
    kind: Artifact["kind"],
  ): Artifact | null {
    const row = this.db
      .prepare(
        `SELECT * FROM artifacts
         WHERE project_id = ? AND kind = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(projectId, kind) as ArtifactRow | undefined;
    return row ? toArtifact(row) : null;
  }

  getCurrentContentArtifact(projectId: string): Artifact | null {
    const row = this.db
      .prepare(
        `SELECT artifacts.* FROM project_content_heads
         JOIN artifacts ON artifacts.id = project_content_heads.artifact_id
         WHERE project_content_heads.project_id = ?`,
      )
      .get(projectId) as ArtifactRow | undefined;
    return row
      ? toArtifact(row)
      : this.getLatestArtifact(projectId, "content_package");
  }

  setCurrentContentArtifact(projectId: string, artifactId: string): Artifact {
    const artifact = this.getArtifact(artifactId);
    if (
      !artifact ||
      artifact.project_id !== projectId ||
      artifact.kind !== "content_package"
    ) {
      throw new Error("invalid_content_revision");
    }
    this.db
      .prepare(
        `INSERT INTO project_content_heads (project_id, artifact_id, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           artifact_id = excluded.artifact_id,
           updated_at = excluded.updated_at`,
      )
      .run(projectId, artifactId, now());
    return artifact;
  }

  beginOperation(input: {
    projectId: string;
    type: string;
    idempotencyKey: string;
    payload: unknown;
  }): { id: string; existing: boolean; result: unknown | null } {
    const existing = this.db
      .prepare(
        `SELECT id, project_id, type, input_sha256, result_json
         FROM operations WHERE idempotency_key = ?`,
      )
      .get(input.idempotencyKey) as
      | {
          id: string;
          project_id: string;
          type: string;
          input_sha256: string;
          result_json: string | null;
        }
      | undefined;
    if (existing) {
      if (
        existing.project_id !== input.projectId ||
        existing.type !== input.type ||
        existing.input_sha256 !== hashJson(input.payload)
      ) {
        throw new Error("idempotency_key_conflict");
      }
      return {
        id: existing.id,
        existing: true,
        result: existing.result_json ? JSON.parse(existing.result_json) : null,
      };
    }

    const id = createId("operation");
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO operations
          (id, project_id, type, state, idempotency_key, input_sha256, created_at, updated_at)
         VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.type,
        input.idempotencyKey,
        hashJson(input.payload),
        timestamp,
        timestamp,
      );
    return { id, existing: false, result: null };
  }

  finishOperation(id: string, result: unknown): void {
    this.db
      .prepare(
        "UPDATE operations SET state = 'succeeded', result_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(JSON.stringify(result), now(), id);
  }

  failOperation(id: string, errorCode: string): void {
    this.db
      .prepare(
        "UPDATE operations SET state = 'failed', error_code = ?, updated_at = ? WHERE id = ?",
      )
      .run(errorCode, now(), id);
  }

  createRelease(snapshotInput: ReleaseSnapshot): {
    id: string;
    snapshot: ReleaseSnapshot;
    snapshotSha256: string;
  } {
    const snapshot = releaseSnapshotSchema.parse(snapshotInput);
    const timestamp = now();
    const snapshotSha256 = hashJson(snapshot);
    this.db
      .prepare(
        `INSERT INTO releases
          (id, project_id, youtube_video_id, channel_id, snapshot_json, snapshot_sha256, privacy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.id,
        snapshot.project_id,
        snapshot.youtube_video_id,
        snapshot.channel_id,
        JSON.stringify(snapshot),
        snapshotSha256,
        snapshot.privacy,
        timestamp,
        timestamp,
      );
    return { id: snapshot.id, snapshot, snapshotSha256 };
  }

  getRelease(id: string): {
    snapshot: ReleaseSnapshot;
    snapshotSha256: string;
    privacy: string;
  } | null {
    const row = this.db
      .prepare(
        "SELECT id, snapshot_json, snapshot_sha256, privacy FROM releases WHERE id = ?",
      )
      .get(id) as ReleaseRow | undefined;
    if (!row) return null;
    return {
      snapshot: releaseSnapshotSchema.parse(JSON.parse(row.snapshot_json)),
      snapshotSha256: row.snapshot_sha256,
      privacy: row.privacy,
    };
  }

  getLatestReleaseForProject(projectId: string): {
    snapshot: ReleaseSnapshot;
    snapshotSha256: string;
    privacy: string;
  } | null {
    const row = this.db
      .prepare(
        `SELECT id, snapshot_json, snapshot_sha256, privacy
         FROM releases WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(projectId) as ReleaseRow | undefined;
    if (!row) return null;
    return {
      snapshot: releaseSnapshotSchema.parse(JSON.parse(row.snapshot_json)),
      snapshotSha256: row.snapshot_sha256,
      privacy: row.privacy,
    };
  }

  claimRelease(id: string, state: "publishing" | "scheduling"): void {
    const result = this.db
      .prepare(
        "UPDATE releases SET privacy = ?, updated_at = ? WHERE id = ? AND privacy = 'unlisted'",
      )
      .run(state, now(), id);
    if (result.changes !== 1) throw new Error("release_not_unlisted");
  }

  completeRelease(
    id: string,
    from: "publishing" | "scheduling",
    privacy: "public" | "scheduled",
  ): void {
    const result = this.db
      .prepare(
        "UPDATE releases SET privacy = ?, updated_at = ? WHERE id = ? AND privacy = ?",
      )
      .run(privacy, now(), id, from);
    if (result.changes !== 1) throw new Error("release_state_changed");
  }

  rollbackReleaseClaim(id: string, from: "publishing" | "scheduling"): void {
    const result = this.db
      .prepare(
        "UPDATE releases SET privacy = 'unlisted', updated_at = ? WHERE id = ? AND privacy = ?",
      )
      .run(now(), id, from);
    if (result.changes !== 1) throw new Error("release_rollback_failed");
  }
}
