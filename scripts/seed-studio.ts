import { fixturePackage } from "../apps/render/src/fixture.js";
import { loadConfig } from "../apps/mcp/src/config.js";
import { ArtifactStore } from "../apps/mcp/src/storage/artifacts.js";
import { GreenlightStore } from "../apps/mcp/src/storage/store.js";
import { resolve } from "node:path";

const config = loadConfig();
const store = new GreenlightStore(resolve(config.dataDir, "greenlight.sqlite"));
const artifacts = new ArtifactStore(config.artifactDir, store);
const existing = store
  .listProjects()
  .find((project) => project.brief.topic === "The last responsible moment");

if (existing) {
  console.log(existing.id);
  store.close();
  process.exit(0);
}

const project = store.createProject({
  topic: "The last responsible moment",
  audience: "builders shipping agents with real-world tools",
  goal: "Explain why public release deserves an explicit human approval gate",
  target_duration_seconds: 56,
  tone: "precise, editorial, calm",
});

const accessedAt = new Date().toISOString();
await artifacts.importJson({
  projectId: project.id,
  kind: "evidence_ledger",
  value: {
    project_id: project.id,
    sources: [
      {
        id: "source_trueforge_intro",
        url: "https://trueforge.dev/introduction",
        title: "Introduction to TrueForge",
        publisher: "TrueFoundry",
        accessed_at: accessedAt,
        excerpt:
          "The agent harness sits between a user goal and the final response, routing model, tools, sandbox, approval gates, and recorded execution.",
        license: null,
      },
      {
        id: "source_trueforge_api",
        url: "https://trueforge.dev/api/overview",
        title: "TrueForge API concepts",
        publisher: "TrueFoundry",
        accessed_at: accessedAt,
        excerpt:
          "A tool approval pauses a turn and resumes after the user supplies an approval decision.",
        license: null,
      },
    ],
    claims: [
      {
        id: "claim_pipeline",
        text: "TrueForge records agent work across model, tools, sandbox, and approval events.",
        source_ids: ["source_trueforge_intro"],
        status: "supported",
        note: null,
      },
      {
        id: "claim_publication",
        text: "Greenlight treats public YouTube release as an externally consequential tool action.",
        source_ids: ["source_trueforge_api"],
        status: "supported",
        note: "This is Greenlight's policy implemented with TrueForge tool approval.",
      },
      {
        id: "claim_unlisted",
        text: "Greenlight stages a completed release unlisted before requesting public-release approval.",
        source_ids: ["source_trueforge_api"],
        status: "supported",
        note: "This is Greenlight's unlisted-first invariant.",
      },
      {
        id: "claim_approval",
        text: "TrueForge can pause a tool call until a person approves or rejects it.",
        source_ids: ["source_trueforge_api"],
        status: "supported",
        note: null,
      },
    ],
  },
  provenance: { producer: "greenlight_demo_seed", contract_version: 1 },
});

await artifacts.importJson({
  projectId: project.id,
  kind: "content_package",
  value: {
    ...fixturePackage,
    project_id: project.id,
    localized_narration_tracks: fixturePackage.scenes
      .slice(0, 2)
      .map((scene) => ({
        id: `track_hi_${scene.id}`,
        scene_id: scene.id,
        locale: "hi-IN",
        script: scene.narration,
        narration_artifact_id: null,
        captions_artifact_id: null,
        status: "draft",
      })),
  },
  provenance: {
    producer: "greenlight_demo_seed",
    evidence_ledger: true,
    contract_version: 1,
  },
});

store.setProjectStage(project.id, "packaged");
console.log(project.id);
store.close();
