import { readFile } from "node:fs/promises";

const trueForgeUrl = (
  process.env.TRUEFORGE_API_URL ?? "http://localhost:8790"
).replace(/\/$/, "");
const mcpUrl = process.env.GREENLIGHT_MCP_URL ?? "http://localhost:8941/mcp";
const openRouterKey = process.env.OPENROUTER_API_KEY;
const mcpAuthToken = process.env.GREENLIGHT_MCP_AUTH_TOKEN;
const upstreamModel =
  process.env.GREENLIGHT_ROOT_MODEL ?? "deepseek/deepseek-v4-flash-vision-exp";
const skillsRepoUrl =
  process.env.GREENLIGHT_SKILLS_REPO_URL ??
  "https://github.com/aryan877/greenlight.git";
const skillsRef = process.env.GREENLIGHT_SKILLS_REF ?? "main";
const skillsMode = process.env.GREENLIGHT_ENABLE_GIT_SKILLS ?? "auto";

const skillManifests = [
  {
    name: "marketing-editor",
    description:
      "Tighten creator-facing hooks, scripts, questions, options, and review copy into short, concrete human language.",
    path: "agents/skills/marketing-editor",
  },
  {
    name: "evidence-desk",
    description:
      "Plan focused research, reconcile sources, and build claim-level evidence before scripting factual scenes.",
    path: "agents/skills/evidence-desk",
  },
  {
    name: "youtube-release",
    description:
      "Package a finished cut with an honest title-thumbnail pair, useful metadata, and unlisted-first YouTube release safety.",
    path: "agents/skills/youtube-release",
  },
  {
    name: "edit-decision",
    description:
      "Resolve timeline, transcript, timing, and sandbox media-edit decisions without inventing timestamps or host paths.",
    path: "agents/skills/edit-decision",
  },
];

if (!openRouterKey) {
  throw new Error(
    "OPENROUTER_API_KEY is required. Put it in ignored .env and rerun the command.",
  );
}
if (!mcpAuthToken || mcpAuthToken.length < 32) {
  throw new Error(
    "GREENLIGHT_MCP_AUTH_TOKEN must contain at least 32 characters.",
  );
}

const request = async (path, init = {}) => {
  const response = await fetch(`${trueForgeUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message ?? body?.message ?? response.statusText;
    throw new Error(
      `${init.method ?? "GET"} ${path} failed (${response.status}): ${detail}`,
    );
  }
  return body;
};

const gitSkillsAreAvailable = async () => {
  if (skillsMode === "true") return true;
  if (skillsMode === "false") return false;
  const url = new URL(skillsRepoUrl);
  const [owner, rawRepository] = url.pathname.split("/").filter(Boolean);
  if (url.hostname !== "github.com" || !owner || !rawRepository) return false;
  const repository = rawRepository.replace(/\.git$/, "");
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
    { headers: { accept: "application/vnd.github+json" } },
  ).catch(() => null);
  return response?.ok === true;
};

const resolveCompactionThreshold = async () => {
  const fallback = 50_000;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { authorization: `Bearer ${openRouterKey}` },
    });
    if (!response.ok) return fallback;
    const body = await response.json();
    const model = body?.data?.find((entry) => entry.id === upstreamModel);
    const contextLength = model?.context_length;
    if (!Number.isFinite(contextLength) || contextLength <= 0) return fallback;
    return Math.max(
      12_000,
      Math.min(fallback, Math.floor(contextLength * 0.55)),
    );
  } catch {
    return fallback;
  }
};

const [agentSource, instructions] = await Promise.all([
  readFile(
    new URL("../agents/producer/agent.json", import.meta.url),
    "utf8",
  ).then(JSON.parse),
  readFile(
    new URL("../agents/producer/instructions.md", import.meta.url),
    "utf8",
  ),
]);

await request("/api/v1/settings/model-providers", {
  method: "PUT",
  body: JSON.stringify({
    manifest: {
      type: "custom",
      name: "greenlight",
      base_url: "https://openrouter.ai/api/v1",
      auth: { api_key: openRouterKey },
      models: [
        {
          model_id: upstreamModel,
          name: "root-model",
          properties: {},
        },
      ],
    },
  }),
});

await request("/api/v1/settings/mcp-servers", {
  method: "PUT",
  body: JSON.stringify({
    manifest: {
      type: "remote",
      name: "greenlight",
      url: mcpUrl,
      description:
        "Typed Greenlight production state, artifact, media, render, quality, YouTube staging, and release tools.",
      auth: {
        type: "header",
        headers: { authorization: `Bearer ${mcpAuthToken}` },
      },
    },
  }),
});

const mcpCatalog = await request("/api/v1/catalogs/mcp-servers");
const exaCatalogEntry = mcpCatalog.data.find((entry) => entry.name === "exa");
if (!exaCatalogEntry) {
  throw new Error(
    "TrueForge's MCP catalog does not contain the Exa connector.",
  );
}
const { logo: _exaLogo, ...exaManifest } = exaCatalogEntry;
await request("/api/v1/settings/mcp-servers", {
  method: "PUT",
  body: JSON.stringify({ manifest: exaManifest }),
});

const enableGitSkills = await gitSkillsAreAvailable();
if (enableGitSkills) {
  for (const skill of skillManifests) {
    await request("/api/v1/settings/skills", {
      method: "PUT",
      body: JSON.stringify({
        manifest: {
          type: "git",
          name: skill.name,
          url: skillsRepoUrl,
          path: skill.path,
          ref: skillsRef,
          description: skill.description,
        },
      }),
    });
  }
}

const compactionThreshold = await resolveCompactionThreshold();
const manifest = {
  ...agentSource.manifest,
  skills: enableGitSkills ? agentSource.manifest.skills : [],
  instructions: instructions.trim(),
  config: {
    ...agentSource.manifest.config,
    context_management: {
      ...agentSource.manifest.config.context_management,
      compaction: {
        enabled: true,
        compaction_threshold_tokens: compactionThreshold,
      },
      large_tool_response: { enabled: true },
    },
  },
};
const agents = await request("/api/v1/agents");
const existing = agents.data.find((agent) => agent.name === agentSource.name);
const saved = existing
  ? await request(`/api/v1/agents/${encodeURIComponent(existing.id)}`, {
      method: "PUT",
      body: JSON.stringify({ manifest }),
    })
  : await request("/api/v1/agents", {
      method: "POST",
      body: JSON.stringify({ name: agentSource.name, manifest }),
    });

console.log(
  `Configured TrueForge provider: greenlight/root-model -> ${upstreamModel}`,
);
console.log(`Configured TrueForge connector: greenlight -> ${mcpUrl}`);
console.log("Configured TrueForge connector: exa (deferred web research)");
console.log(
  enableGitSkills
    ? `Configured TrueForge skills: ${skillManifests.map((skill) => skill.name).join(", ")}`
    : "Deferred TrueForge Git skills until their repository is publicly cloneable",
);
console.log(
  `Configured TrueForge agent: ${saved.data.name} (${saved.data.id})`,
);
console.log(`Configured compaction threshold: ${compactionThreshold} tokens`);
