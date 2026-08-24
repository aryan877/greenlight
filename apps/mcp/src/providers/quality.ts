import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  contentPackageSchema,
  evidenceLedgerSchema,
  qualityReportSchema,
  type QualityCheck,
} from "@greenlight/contracts";

import { now } from "../lib/canonical.js";
import type { ArtifactStore } from "../storage/artifacts.js";

const runFile = promisify(execFile);

type Probe = {
  format?: { duration?: string };
  streams?: Array<{ codec_type?: string; height?: number; width?: number }>;
};

export class QualityInspector {
  constructor(
    private readonly artifacts: ArtifactStore,
    private readonly ffprobePath = "ffprobe",
    private readonly execute: typeof runFile = runFile,
  ) {}

  async inspect(input: {
    contentPackageArtifactId: string;
    evidenceLedgerArtifactId: string;
    projectId: string;
    videoArtifactId: string;
  }) {
    const video = this.artifacts.resolveArtifact(input.videoArtifactId);
    const contentArtifact = this.artifacts.resolveArtifact(
      input.contentPackageArtifactId,
    );
    const evidenceArtifact = this.artifacts.resolveArtifact(
      input.evidenceLedgerArtifactId,
    );
    for (const artifact of [
      video.artifact,
      contentArtifact.artifact,
      evidenceArtifact.artifact,
    ]) {
      if (artifact.project_id !== input.projectId) {
        throw new Error("artifact_project_mismatch");
      }
    }
    if (video.artifact.kind !== "video")
      throw new Error("video_artifact_required");
    if (contentArtifact.artifact.kind !== "content_package") {
      throw new Error("content_package_artifact_required");
    }
    if (evidenceArtifact.artifact.kind !== "evidence_ledger") {
      throw new Error("evidence_ledger_artifact_required");
    }

    const [content, evidence, probeResult] = await Promise.all([
      this.artifacts
        .readJson(input.contentPackageArtifactId)
        .then(contentPackageSchema.parse),
      this.artifacts
        .readJson(input.evidenceLedgerArtifactId)
        .then(evidenceLedgerSchema.parse),
      this.execute(
        this.ffprobePath,
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration:stream=codec_type,width,height",
          "-of",
          "json",
          video.absolutePath,
        ],
        { encoding: "utf8", timeout: 30_000 },
      ).then(({ stdout }) => JSON.parse(stdout) as Probe),
    ]);

    const claims = new Map(evidence.claims.map((claim) => [claim.id, claim]));
    const referencedClaims = content.scenes.flatMap((scene) => scene.claim_ids);
    const unresolved = referencedClaims.filter(
      (claimId) => claims.get(claimId)?.status !== "supported",
    );
    const duration = Number(probeResult.format?.duration ?? 0);
    const visual = probeResult.streams?.find(
      (stream) => stream.codec_type === "video",
    );
    const hasAudio = probeResult.streams?.some(
      (stream) => stream.codec_type === "audio",
    );
    const plannedDuration = content.scenes.reduce(
      (total, scene) => total + scene.duration_seconds,
      0,
    );
    const checks: QualityCheck[] = [
      {
        name: "evidence_coverage",
        passed: unresolved.length === 0,
        detail:
          unresolved.length === 0
            ? "Every referenced claim is supported."
            : `Unresolved scene claims: ${[...new Set(unresolved)].join(", ")}`,
        measured: unresolved.length,
      },
      {
        name: "duration",
        passed: Math.abs(duration - plannedDuration) <= 1.5,
        detail: `Rendered ${duration.toFixed(2)}s; planned ${plannedDuration.toFixed(2)}s.`,
        measured: duration,
      },
      {
        name: "frame_size",
        passed: (visual?.width ?? 0) >= 1280 && (visual?.height ?? 0) >= 720,
        detail: `Rendered ${visual?.width ?? 0}×${visual?.height ?? 0}.`,
        measured: `${visual?.width ?? 0}x${visual?.height ?? 0}`,
      },
      {
        name: "audio_stream",
        passed: Boolean(hasAudio),
        detail: hasAudio
          ? "Narration audio stream is present."
          : "No audio stream found.",
        measured: Boolean(hasAudio),
      },
      {
        name: "youtube_metadata",
        passed:
          content.metadata.title.length <= 100 &&
          content.metadata.description.length <= 5000 &&
          content.metadata.tags.length <= 30,
        detail: "Title, description, and tag counts fit YouTube limits.",
        measured: content.metadata.tags.length,
      },
    ];
    return qualityReportSchema.parse({
      project_id: input.projectId,
      video_artifact_id: input.videoArtifactId,
      passed: checks.every((check) => check.passed),
      checks,
      created_at: now(),
    });
  }
}
