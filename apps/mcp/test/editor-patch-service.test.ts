import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ContentPackage } from "@greenlight/contracts";
import { describe, expect, it } from "vitest";

import { saveEditorPatch } from "../src/services/editor-patches.js";
import { ArtifactStore } from "../src/storage/artifacts.js";
import { GreenlightStore } from "../src/storage/store.js";

describe("editor patch revisions", () => {
  it("uses one immutable revision path for direct creator edits", async () => {
    const root = await mkdtemp(join(tmpdir(), "greenlight-editor-"));
    const store = new GreenlightStore(":memory:");
    try {
      const project = store.createProject({
        topic: "Direct timeline editing",
        audience: "video creators",
        goal: "Keep manual edits immediate and reversible",
        target_duration_seconds: 30,
        tone: "clear",
      });
      const artifacts = new ArtifactStore(root, store);
      const content: ContentPackage = {
        version: 1,
        project_id: project.id,
        headline: "One clean cut",
        dek: "The source remains immutable.",
        scenes: [
          {
            id: "scene_open",
            kind: "hook",
            title: "Open",
            narration: "Start with one clear idea.",
            narration_artifact_id: null,
            captions_artifact_id: null,
            transcript_artifact_id: null,
            claim_ids: [],
            duration_seconds: 30,
            playback_rate: 1,
            visual: {
              treatment: "type",
              prompt: null,
              artifact_ids: [],
              accent: "signal",
            },
          },
        ],
        localized_narration_tracks: [],
        metadata: {
          title: "One clean cut",
          description: "A direct-edit test.",
          tags: ["editing"],
          category_id: "28",
          made_for_kids: false,
          contains_synthetic_media: false,
        },
      };
      const base = await artifacts.importJson({
        projectId: project.id,
        kind: "content_package",
        value: content,
        provenance: { producer: "creator" },
      });
      const saved = await saveEditorPatch({
        artifacts,
        producer: "creator",
        store,
        request: {
          instruction_summary: "Trim “Open” to three seconds",
          selection: {
            project_id: project.id,
            base_content_package_artifact_id: base.id,
            scene_ids: ["scene_open"],
            track_ids: ["visual", "voice", "caption", "transcript"],
            artifact_ids: [],
            time_range_seconds: { start: 0, end: 30 },
          },
          operations: [
            {
              type: "update_scene",
              scene_id: "scene_open",
              duration_seconds: 29,
              gap_after_seconds: 1,
            },
          ],
        },
      });

      expect(saved.patch_artifact.provenance.producer).toBe("creator");
      expect(saved.content_package_artifact.id).not.toBe(base.id);
      expect(
        (await artifacts.readJson<ContentPackage>(base.id)).scenes[0],
      ).toMatchObject({ duration_seconds: 30 });
      expect(
        (
          await artifacts.readJson<ContentPackage>(
            saved.content_package_artifact.id,
          )
        ).scenes[0],
      ).toMatchObject({ duration_seconds: 29, gap_after_seconds: 1 });
    } finally {
      store.close();
      await rm(root, { force: true, recursive: true });
    }
  });
});
