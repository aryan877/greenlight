import { mkdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { basename, resolve } from "node:path";

import cors from "cors";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { loadConfig } from "./config.js";
import { inspectImportedMedia } from "./media-import.js";
import { buildMcpServer } from "./mcp/tools.js";
import { CodexImageProvider } from "./providers/codex-image.js";
import { QualityInspector } from "./providers/quality.js";
import { OpenMojiToolkit } from "./providers/openmoji.js";
import { RemotionRenderer } from "./providers/render.js";
import {
  DisabledTranscriptionProvider,
  OpenRouterTranscriptionProvider,
} from "./providers/transcription.js";
import {
  DisabledVoiceProvider,
  OpenRouterVoiceProvider,
} from "./providers/voice.js";
import { YouTubeUploader } from "./providers/youtube.js";
import { ArtifactStore } from "./storage/artifacts.js";
import { GreenlightStore } from "./storage/store.js";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
mkdirSync(config.artifactDir, { recursive: true });

const store = new GreenlightStore(resolve(config.dataDir, "greenlight.sqlite"));
const artifacts = new ArtifactStore(config.artifactDir, store);
const image = new CodexImageProvider(config.codex, artifacts);
const openmoji = new OpenMojiToolkit(config.openMojiRoot, artifacts);
const voice =
  config.voice.provider === "openrouter"
    ? new OpenRouterVoiceProvider(config.voice)
    : new DisabledVoiceProvider();
const transcription =
  config.transcription.provider === "openrouter"
    ? new OpenRouterTranscriptionProvider(config.transcription)
    : new DisabledTranscriptionProvider();
const renderer = new RemotionRenderer(config.workspaceRoot, artifacts);
const quality = new QualityInspector(artifacts);
const youtube = new YouTubeUploader(config.youtube);
const app = express();

const hasMcpAccess = (authorization: string | undefined): boolean => {
  const expected = Buffer.from(`Bearer ${config.mcpAuthToken}`);
  const received = Buffer.from(authorization ?? "");
  return (
    expected.byteLength === received.byteLength &&
    timingSafeEqual(expected, received)
  );
};

app.use(
  cors({
    credentials: false,
    origin: (origin, done) => {
      if (!origin || origin === config.studioOrigin) {
        done(null, true);
        return;
      }
      done(new Error("origin_not_allowed"));
    },
  }),
);
app.use(express.json({ limit: "2mb" }));

app.get("/", (_request, response) => {
  response
    .type("text/plain")
    .send("Greenlight MCP · POST /mcp · GET /api/projects");
});

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "greenlight-mcp", version: "0.1.0" });
});

app.get("/api/projects", (_request, response) => {
  response.json({ projects: store.listProjects() });
});

app.get("/api/projects/:id", (request, response) => {
  const project = store.getProject(request.params.id);
  if (!project) {
    response.status(404).json({ error: "project_not_found" });
    return;
  }
  response.json({
    project,
    artifacts: store.listArtifacts(project.id),
    release: store.getLatestReleaseForProject(project.id),
  });
});

app.post(
  "/api/projects/:id/assets",
  express.raw({ type: "application/octet-stream", limit: "256mb" }),
  async (request, response) => {
    try {
      const project = store.getProject(request.params.id);
      if (!project) {
        response.status(404).json({ error: "project_not_found" });
        return;
      }
      const encodedFilename = request.header("x-greenlight-filename");
      if (!encodedFilename) {
        response.status(400).json({ error: "filename_required" });
        return;
      }
      const filename = basename(decodeURIComponent(encodedFilename));
      const bytes = Buffer.isBuffer(request.body)
        ? request.body
        : Buffer.from(request.body ?? []);
      const media = inspectImportedMedia(filename, bytes);
      const artifact = await artifacts.importBuffer({
        projectId: project.id,
        kind: media.kind,
        filename: `creator-media${media.extension}`,
        bytes,
        provenance: {
          producer: "creator",
          source: "local_import",
          original_filename: filename,
          declared_mime_type: request.header("x-greenlight-mime") ?? null,
          inspected_mime_type: media.mimeType,
        },
      });
      response.status(201).json({ artifact });
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "media_import_failed";
      if (
        [
          "unsupported_media_type",
          "empty_media_file",
          "media_content_mismatch",
          "URI malformed",
        ].includes(code)
      ) {
        response.status(400).json({ error: code });
        return;
      }
      throw error;
    }
  },
);

app.get("/api/artifacts/:id", (request, response) => {
  try {
    const resolvedArtifact = artifacts.resolveArtifact(request.params.id);
    response.type(resolvedArtifact.artifact.mime_type);
    response.setHeader("x-greenlight-sha256", resolvedArtifact.artifact.sha256);
    response.sendFile(resolvedArtifact.absolutePath);
  } catch (error) {
    if (error instanceof Error && error.message === "artifact_not_found") {
      response.status(404).json({ error: "artifact_not_found" });
      return;
    }
    throw error;
  }
});

app.post("/mcp", async (request, response) => {
  if (!hasMcpAccess(request.header("authorization"))) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const server = buildMcpServer({
      artifacts,
      image,
      openmoji,
      quality,
      renderer,
      store,
      transcription,
      voice,
      youtube,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    console.error("[greenlight-mcp] request failed", message);
    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

const listener = app.listen(config.port, "127.0.0.1", () => {
  console.log(`[greenlight-mcp] http://localhost:${config.port}/mcp`);
});

const shutdown = () => {
  listener.close(() => {
    store.close();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
