import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ArtifactStore } from "../src/storage/artifacts.js";
import { GreenlightStore } from "../src/storage/store.js";

describe("artifact sandbox transfer", () => {
  it("rehydrates an R2 original into the VPS cache and verifies its hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "greenlight-r2-cache-"));
    const store = new GreenlightStore(":memory:");
    try {
      const project = store.createProject({
        topic: "Remote editing workspace",
        audience: "video creators",
        goal: "Keep immutable originals remote and active files hot",
        target_duration_seconds: 30,
        tone: "clear",
      });
      const original = Buffer.from("canonical-r2-video-fixture");
      const remoteKey = `demo/projects/${project.id}/uploads/source.mp4`;
      const reads: string[] = [];
      const artifacts = new ArtifactStore(root, store, async (key) => {
        reads.push(key);
        return new Response(original, {
          headers: { "content-length": String(original.byteLength) },
        });
      });
      const artifact = await artifacts.importBuffer({
        projectId: project.id,
        kind: "video",
        filename: "source.mp4",
        bytes: original,
        provenance: { producer: "creator" },
        storage: { backend: "r2", remoteKey },
      });
      const cachedPath = artifacts.resolveArtifact(artifact.id).absolutePath;
      await rm(cachedPath);

      await expect(
        artifacts.readChunk(artifact.id, 0, original.byteLength),
      ).resolves.toEqual(original);
      expect(reads).toEqual([remoteKey]);
      expect(store.getArtifactStorage(artifact.id)).toEqual({
        backend: "r2",
        remoteKey,
      });
      expect(JSON.stringify(artifact)).not.toContain(remoteKey);
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reconstructs immutable media from bounded chunks", async () => {
    const root = await mkdtemp(join(tmpdir(), "greenlight-artifact-"));
    const store = new GreenlightStore(":memory:");
    try {
      const project = store.createProject({
        topic: "Sandbox media transfer",
        audience: "video creators",
        goal: "Process selected media without exposing host paths",
        target_duration_seconds: 30,
        tone: "clear",
      });
      const artifacts = new ArtifactStore(root, store);
      const original = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
      const artifact = await artifacts.importBuffer({
        projectId: project.id,
        kind: "video",
        filename: "source.mp4",
        bytes: original,
        provenance: { producer: "creator_import" },
      });

      const chunks: Buffer[] = [];
      for (let offset = 0; offset < artifact.byte_size; offset += 7) {
        chunks.push(await artifacts.readChunk(artifact.id, offset, 7));
      }

      expect(Buffer.concat(chunks)).toEqual(original);
      await expect(
        artifacts.readChunk(artifact.id, artifact.byte_size + 1, 1),
      ).rejects.toThrow("artifact_offset_out_of_range");
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists generated-media metadata as structured artifact state", async () => {
    const root = await mkdtemp(join(tmpdir(), "greenlight-generated-"));
    const databasePath = join(root, "greenlight.sqlite");
    const store = new GreenlightStore(databasePath);
    try {
      const project = store.createProject({
        topic: "Durable generated media provenance",
        audience: "video creators",
        goal: "Keep generation facts attached across restarts",
        target_duration_seconds: 30,
        tone: "clear",
      });
      const artifacts = new ArtifactStore(join(root, "artifacts"), store);
      const promptHash = "b".repeat(64);
      const artifact = await artifacts.importBuffer({
        projectId: project.id,
        kind: "image",
        filename: "generated.png",
        bytes: Buffer.from("generated-image-fixture"),
        generation: {
          media_type: "image",
          provider: "openrouter",
          model: "gpt-image-current",
          runtime: "openrouter_images_api",
          input_hashes: [promptHash],
          prompt_sha256: promptHash,
          width: 1920,
          height: 1080,
          generated_at: "2026-08-30T00:00:00.000Z",
          provider_reported_cost: null,
          disclosure: {
            contains_synthetic_media: true,
            method: "generated",
          },
        },
        provenance: { purpose: "thumbnail" },
      });
      const secondPromptHash = "c".repeat(64);
      const second = await artifacts.importBuffer({
        projectId: project.id,
        kind: "image",
        filename: "generated.png",
        bytes: Buffer.from("generated-image-fixture"),
        generation: {
          media_type: "image",
          provider: "openrouter",
          model: "gpt-image-current",
          runtime: "openrouter_images_api",
          input_hashes: [secondPromptHash],
          prompt_sha256: secondPromptHash,
          width: 1920,
          height: 1080,
          generated_at: "2026-08-30T00:01:00.000Z",
          provider_reported_cost: null,
          disclosure: {
            contains_synthetic_media: true,
            method: "generated",
          },
        },
        provenance: { purpose: "scene" },
      });

      expect(second.id).not.toBe(artifact.id);
      expect(second.relative_path).toBe(artifact.relative_path);
      expect(second.generation?.input_hashes).toEqual([secondPromptHash]);

      const reopened = new GreenlightStore(databasePath);
      try {
        expect(reopened.getArtifact(artifact.id)?.generation).toMatchObject({
          media_type: "image",
          input_hashes: [promptHash],
          width: 1920,
          height: 1080,
        });
        expect(reopened.getArtifact(second.id)?.provenance.purpose).toBe(
          "scene",
        );
      } finally {
        reopened.close();
      }
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
