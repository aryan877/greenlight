import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ArtifactStore } from "../storage/artifacts.js";

const runFile = promisify(execFile);

export class RemotionRenderer {
  constructor(
    private readonly workspaceRoot: string,
    private readonly artifacts: ArtifactStore,
    private readonly execute: typeof runFile = runFile,
  ) {}

  async render(input: { contentPackageArtifactId: string; projectId: string }) {
    const content = this.artifacts.resolveArtifact(
      input.contentPackageArtifactId,
    );
    if (
      content.artifact.project_id !== input.projectId ||
      content.artifact.kind !== "content_package"
    ) {
      throw new Error("invalid_content_package_artifact");
    }
    const workDir = await mkdtemp(join(tmpdir(), "greenlight-render-"));
    const videoPath = join(workDir, "video.mp4");
    const thumbnailPath = join(workDir, "thumbnail.png");
    const assetManifestPath = join(workDir, "assets.json");
    try {
      const packageValue = await this.artifacts.readJson<{
        scenes: Array<{
          captions_artifact_id: string | null;
          narration_artifact_id: string | null;
          visual: { artifact_ids: string[] };
        }>;
      }>(input.contentPackageArtifactId);
      const assetIds = new Set<string>(
        packageValue.scenes
          .flatMap((scene) => [
            ...scene.visual.artifact_ids,
            scene.narration_artifact_id,
            scene.captions_artifact_id,
          ])
          .filter((id): id is string => Boolean(id)),
      );
      const assetFiles = Object.fromEntries(
        [...assetIds].map((id) => {
          const resolved = this.artifacts.resolveArtifact(id);
          if (resolved.artifact.project_id !== input.projectId) {
            throw new Error("render_asset_project_mismatch");
          }
          return [id, resolved.absolutePath];
        }),
      );
      await writeFile(assetManifestPath, JSON.stringify(assetFiles));
      await this.execute(
        "pnpm",
        [
          "--dir",
          this.workspaceRoot,
          "--filter",
          "@greenlight/render",
          "render",
          "--input",
          content.absolutePath,
          "--output",
          videoPath,
          "--thumbnail",
          thumbnailPath,
          "--assets",
          assetManifestPath,
        ],
        { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 30 * 60_000 },
      );
      const [videoBytes, thumbnailBytes] = await Promise.all([
        readFile(videoPath),
        readFile(thumbnailPath),
      ]);
      const provenance = {
        producer: "remotion",
        content_package_artifact_id: content.artifact.id,
        content_package_sha256: content.artifact.sha256,
      };
      const [video, thumbnail] = await Promise.all([
        this.artifacts.importBuffer({
          projectId: input.projectId,
          kind: "video",
          filename: "video.mp4",
          bytes: videoBytes,
          provenance,
        }),
        this.artifacts.importBuffer({
          projectId: input.projectId,
          kind: "thumbnail",
          filename: "thumbnail.png",
          bytes: thumbnailBytes,
          provenance,
        }),
      ]);
      return { video, thumbnail };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
