import { describe, expect, it } from "vitest";

import { agentArtifactReference } from "../src/mcp/tools.js";

describe("agent artifact references", () => {
  it("exposes an immutable managed reference without a storage path", () => {
    const reference = agentArtifactReference({
      id: "artifact_12345678",
      project_id: "project_12345678",
      kind: "video",
      sha256: "a".repeat(64),
      relative_path: "project_12345678/video/private-source.mp4",
      mime_type: "video/mp4",
      byte_size: 42,
      generation: null,
      provenance: { provider: "pexels" },
      created_at: "2026-08-30T00:00:00.000Z",
    });

    expect(reference.workspace_ref).toBe(
      "greenlight://artifacts/artifact_12345678",
    );
    expect(reference).not.toHaveProperty("relative_path");
    expect(reference).not.toHaveProperty("sha256");
  });
});
