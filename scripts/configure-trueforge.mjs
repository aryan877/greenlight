import { readFile } from "node:fs/promises";

const trueForgeUrl = (
  process.env.TRUEFORGE_API_URL ?? "http://localhost:8790"
).replace(/\/$/, "");
const mcpUrl = process.env.GREENLIGHT_MCP_URL ?? "http://localhost:8941/mcp";
const openRouterKey = process.env.OPENROUTER_API_KEY;
const upstreamModel =
  process.env.GREENLIGHT_ROOT_MODEL ?? "deepseek/deepseek-v4-flash-vision-exp";

if (!openRouterKey) {
  throw new Error(
    "OPENROUTER_API_KEY is required. Put it in ignored .env and rerun the command.",
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
    },
  }),
});

const manifest = { ...agentSource.manifest, instructions: instructions.trim() };
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
console.log(
  `Configured TrueForge agent: ${saved.data.name} (${saved.data.id})`,
);
