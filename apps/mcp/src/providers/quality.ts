import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  captionArtifactIdForTimelineClip,
  contentPackageSchema,
  effectiveCaptionTracks,
  evidenceLedgerSchema,
  productionDurationSeconds,
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

export const detectedBlackDurationSeconds = (output: string) =>
  [...output.matchAll(/black_duration:([0-9.]+)/g)].reduce(
    (sum, match) => sum + Number(match[1] ?? 0),
    0,
  );

export const integratedLoudnessLufs = (output: string) => {
  const matches = [
    ...output.matchAll(/\bI:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*LUFS/g),
  ];
  const value = matches.at(-1)?.[1];
  if (!value || value === "-inf") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export class QualityInspector {
  constructor(
    private readonly artifacts: ArtifactStore,
    private readonly ffprobePath = "ffprobe",
    private readonly execute: typeof runFile = runFile,
    private readonly ffmpegPath = "ffmpeg",
  ) {}

  async inspect(input: {
    contentPackageArtifactId: string;
    evidenceLedgerArtifactId: string;
    projectId: string;
    videoArtifactId: string;
  }) {
    const video = await this.artifacts.ensureLocal(input.videoArtifactId);
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
    const plannedDuration = productionDurationSeconds(content.scenes);
    const [blackResult, loudnessResult] = await Promise.all([
      this.execute(
        this.ffmpegPath,
        [
          "-hide_banner",
          "-i",
          video.absolutePath,
          "-vf",
          "blackdetect=d=0.25:pix_th=0.10",
          "-an",
          "-f",
          "null",
          "-",
        ],
        { encoding: "utf8", timeout: 120_000 },
      ),
      this.execute(
        this.ffmpegPath,
        [
          "-hide_banner",
          "-i",
          video.absolutePath,
          "-af",
          "ebur128=framelog=verbose",
          "-vn",
          "-f",
          "null",
          "-",
        ],
        { encoding: "utf8", timeout: 120_000 },
      ),
    ]);
    const blackDuration = detectedBlackDurationSeconds(blackResult.stderr);
    const plannedBlackDuration = content.scenes.reduce(
      (sum, scene) => sum + (scene.gap_after_seconds ?? 0),
      0,
    );
    const unexpectedBlackDuration = Math.max(
      0,
      blackDuration - plannedBlackDuration,
    );
    const loudness = integratedLoudnessLufs(loudnessResult.stderr);
    const captionClips = effectiveCaptionTracks(content)
      .filter((track) => track.visible)
      .flatMap((track) => track.clips);
    const missingTimedCaptionClips = captionClips.filter(
      (clip) =>
        !clip.transcript_artifact_id ||
        !captionArtifactIdForTimelineClip(content, clip),
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
        name: "loudness",
        passed: loudness !== null && loudness >= -18 && loudness <= -12,
        detail:
          loudness === null
            ? "Integrated loudness could not be measured."
            : `Integrated loudness is ${loudness.toFixed(1)} LUFS; target is -18 to -12 LUFS.`,
        measured: loudness,
      },
      {
        name: "unexpected_black_frames",
        passed: unexpectedBlackDuration <= 0.35,
        detail:
          unexpectedBlackDuration <= 0.35
            ? "No unexpected black segment longer than the tolerance."
            : `${unexpectedBlackDuration.toFixed(2)}s of black exceeds explicit timeline gaps.`,
        measured: unexpectedBlackDuration,
      },
      {
        name: "timed_captions",
        passed:
          captionClips.length > 0 && missingTimedCaptionClips.length === 0,
        detail:
          captionClips.length > 0 && missingTimedCaptionClips.length === 0
            ? "Every visible caption clip resolves to measured words."
            : `Missing timed captions: ${missingTimedCaptionClips
                .map((clip) => clip.label)
                .join(", ")}`,
        measured: missingTimedCaptionClips.length,
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
      content_package_artifact_id: input.contentPackageArtifactId,
      evidence_ledger_artifact_id: input.evidenceLedgerArtifactId,
      passed: checks.every((check) => check.passed),
      checks,
      created_at: now(),
    });
  }
}
