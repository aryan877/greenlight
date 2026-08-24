import { describe, expect, it } from "vitest";

import {
  contentPackageSchema,
  editorPatchInputSchema,
  evidenceLedgerSchema,
  projectBriefSchema,
} from "../src/index.js";

describe("Greenlight contracts", () => {
  it("applies safe brief defaults", () => {
    const brief = projectBriefSchema.parse({
      topic: "Why agent approvals matter",
      audience: "software builders",
      goal: "Explain the last responsible moment",
    });

    expect(brief.target_duration_seconds).toBe(60);
    expect(brief.tone).toContain("curious");
  });

  it("rejects claims that cite missing sources", () => {
    const parsed = evidenceLedgerSchema.safeParse({
      project_id: "project_001",
      sources: [
        {
          id: "source_001",
          url: "https://example.com/source",
          title: "A source",
          publisher: "Example",
          accessed_at: "2026-08-24T07:00:00.000Z",
          excerpt: "Evidence",
        },
      ],
      claims: [
        {
          id: "claim_001",
          text: "A claim with a broken citation",
          source_ids: ["source_missing"],
          status: "supported",
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects timelines outside the short-video window", () => {
    const parsed = contentPackageSchema.safeParse({
      version: 1,
      project_id: "project_001",
      headline: "Approval is the product",
      dek: "The moment a safe agent hands control back to you.",
      scenes: Array.from({ length: 3 }, (_, index) => ({
        id: `scene_00${index}`,
        kind: index === 0 ? "hook" : "explanation",
        title: `Scene ${index}`,
        narration: "A short line.",
        claim_ids: [],
        duration_seconds: 2,
        visual: { treatment: "type", accent: "signal" },
      })),
      metadata: {
        title: "Approval is the product",
        description: "A concise description.",
        tags: ["agents"],
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("requires editor operations to contain a real change", () => {
    const parsed = editorPatchInputSchema.safeParse({
      selection: {
        project_id: "project_001",
        base_content_package_artifact_id: "artifact_001",
        scene_ids: ["scene_001"],
      },
      instruction_summary: "Change the selected beat",
      operations: [{ type: "update_scene", scene_id: "scene_001" }],
    });

    expect(parsed.success).toBe(false);
  });

  it("does not impose an arbitrary scene-count cap", () => {
    const parsed = contentPackageSchema.safeParse({
      version: 1,
      project_id: "project_001",
      headline: "A cut with many precise beats",
      dek: "Each short beat remains a complete editable scene bundle.",
      scenes: Array.from({ length: 20 }, (_, index) => ({
        id: `scene_${String(index).padStart(3, "0")}`,
        kind: index === 0 ? "hook" : "explanation",
        title: `Beat ${index + 1}`,
        narration: "A measured line.",
        claim_ids: [],
        duration_seconds: 2,
        visual: { treatment: "type", accent: "signal" },
      })),
      metadata: {
        title: "A cut with many precise beats",
        description: "A concise production.",
        tags: ["editing"],
      },
    });

    expect(parsed.success).toBe(true);
  });
});
