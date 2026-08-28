import { chmod, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ArtifactStore } from "../src/storage/artifacts.js";
import {
  codexConnectionFromStatus,
  CodexImageProvider,
} from "../src/providers/codex-image.js";

describe("Codex image capability status", () => {
  it("recognizes a ChatGPT login", () => {
    expect(codexConnectionFromStatus("Logged in using ChatGPT")).toBe(
      "chatgpt",
    );
  });

  it("recognizes an API-key login", () => {
    expect(codexConnectionFromStatus("Logged in using an API key")).toBe(
      "api_key",
    );
  });

  it("does not treat an unauthenticated response as connected", () => {
    expect(codexConnectionFromStatus("Not logged in")).toBeNull();
  });

  it("rejects cleanly when the app-server binary disappears before spawn", async () => {
    const directory = await mkdtemp(join(tmpdir(), "greenlight-codex-test-"));
    const binaryPath = join(directory, "codex-fixture");
    await writeFile(
      binaryPath,
      '#!/bin/sh\nif [ "$1" = "login" ]; then echo "Logged in using ChatGPT"; exit 0; fi\nexit 1\n',
    );
    await chmod(binaryPath, 0o700);
    const provider = new CodexImageProvider(
      { binaryPath, model: null },
      {} as ArtifactStore,
    );

    try {
      expect((await provider.describe()).connected).toBe(true);
      await unlink(binaryPath);
      await expect(
        provider.generate({
          aspectRatio: "16:9",
          kind: "image",
          projectId: "project_spawn_failure",
          prompt: "A test image that should never be generated",
          sceneId: null,
        }),
      ).rejects.toThrow("codex_app_server_spawn_failed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
