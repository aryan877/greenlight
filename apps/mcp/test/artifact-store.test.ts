import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ArtifactStore } from "../src/storage/artifacts.js";
import { GreenlightStore } from "../src/storage/store.js";

describe("artifact sandbox transfer", () => {
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
          provider: "codex_subscription",
          model: null,
          runtime: "codex app-server",
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

      const reopened = new GreenlightStore(databasePath);
      try {
        expect(reopened.getArtifact(artifact.id)?.generation).toMatchObject({
          media_type: "image",
          input_hashes: [promptHash],
          width: 1920,
          height: 1080,
        });
      } finally {
        reopened.close();
      }
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
