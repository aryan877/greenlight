import { afterEach, describe, expect, it, vi } from "vitest";

import { greenlightApi } from "./greenlight.js";

const contentPackage = {
  version: 1,
  project_id: "project_artifact",
  headline: "A streamed package",
  dek: "The artifact endpoint returns the package as file bytes.",
  scenes: Array.from({ length: 5 }, (_, index) => ({
    id: `scene_${String(index).padStart(3, "0")}`,
    kind: index === 0 ? "hook" : "explanation",
    title: `Scene ${index + 1}`,
    narration: "A concise narration line.",
    claim_ids: [],
    duration_seconds: 6,
    visual: { treatment: "type", accent: "signal" },
  })),
  metadata: {
    title: "A streamed package",
    description: "A package loaded from immutable artifact bytes.",
    tags: ["agents"],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("greenlight artifact client", () => {
  it("decodes a JSON content package served as an artifact file", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(contentPackage), {
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await greenlightApi.getContentPackage("artifact_content");

    expect(result.project_id).toBe("project_artifact");
    expect(result.scenes).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledWith(
      "/greenlight-api/artifacts/artifact_content",
      { headers: { accept: "application/json" } },
    );
  });

  it("reports malformed artifact JSON clearly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })),
    );

    await expect(
      greenlightApi.getContentPackage("artifact_broken"),
    ).rejects.toThrow("invalid JSON artifact");
  });
});
