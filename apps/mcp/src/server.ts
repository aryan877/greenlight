import { mkdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { basename, resolve } from "node:path";

import cors from "cors";
import express from "express";
import { z } from "zod";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  editorPatchInputSchema,
  generateSoundEffectInputSchema,
  importMediaLibraryAssetInputSchema,
  projectBriefSchema,
  searchMediaLibraryInputSchema,
  type Project,
} from "@greenlight/contracts";

import { loadConfig } from "./config.js";
import { inspectImportedMedia } from "./media-import.js";
import { sha256 } from "./lib/canonical.js";
import { buildMcpServer } from "./mcp/tools.js";
import { CodexImageProvider } from "./providers/codex-image.js";
import { QualityInspector } from "./providers/quality.js";
import { OpenMojiToolkit } from "./providers/openmoji.js";
import { probeImportedMedia } from "./providers/media-metadata.js";
import { MediaLibraryProvider } from "./providers/media-library.js";
import { LlmGatewayProvider } from "./providers/llm-gateway.js";
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
import {
  restoreContentRevision,
  saveEditorPatch,
} from "./services/editor-patches.js";
import { importLibraryAsset } from "./services/media-library.js";
import { generateSoundEffectArtifact } from "./services/sound-design.js";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
mkdirSync(config.artifactDir, { recursive: true });

const store = new GreenlightStore(resolve(config.dataDir, "greenlight.sqlite"));
const artifacts = new ArtifactStore(config.artifactDir, store);
const image = new CodexImageProvider(config.codex, artifacts);
const openmoji = new OpenMojiToolkit(config.openMojiRoot, artifacts);
const mediaLibrary = new MediaLibraryProvider(config.mediaLibrary);
const llmGateway = new LlmGatewayProvider(config.llmGateway);
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

const hasBearerSecret = (
  secret: string | null,
  authorization: string | undefined,
): boolean => {
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);
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
app.post(
  "/api/llm/v1/chat/completions",
  express.json({ limit: "16mb" }),
  async (request, response) => {
    const expected = config.llmGateway.apiKey;
    const authorization = request.header("authorization");
    if (!hasBearerSecret(expected, authorization)) {
      response.status(expected ? 401 : 503).json({
        error: expected
          ? "llm_gateway_unauthorized"
          : "llm_gateway_not_configured",
      });
      return;
    }
    const clientAbort = new AbortController();
    const abortUpstream = () => clientAbort.abort();
    request.once("aborted", abortUpstream);
    response.once("close", abortUpstream);
    try {
      await llmGateway.chatCompletions(
        request.body,
        response,
        clientAbort.signal,
      );
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      response.status(502).json({
        error: error instanceof Error ? error.message : "llm_gateway_failed",
      });
    } finally {
      request.off("aborted", abortUpstream);
      response.off("close", abortUpstream);
    }
  },
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

app.get("/api/voice", (_request, response) => {
  response.json(voice.describe());
});

app.get("/api/image-generation", async (_request, response) => {
  response.json(await image.describe());
});

app.get("/api/youtube", async (_request, response) => {
  try {
    const channel = await youtube.identity();
    response.json({
      connected: true,
      channel_title: channel.title,
      custom_url: channel.custom_url ?? null,
    });
  } catch {
    response.json({
      connected: false,
      channel_title: null,
      custom_url: null,
    });
  }
});

app.get("/api/media-library/capabilities", (_request, response) => {
  response.json(mediaLibrary.describe());
});

app.get("/api/media-library/search", async (request, response) => {
  try {
    const input = searchMediaLibraryInputSchema.parse({
      query: request.query.query,
      use: request.query.use,
      provider: request.query.provider,
      orientation: request.query.orientation,
      limit: request.query.limit ? Number(request.query.limit) : undefined,
    });
    response.json({ results: await mediaLibrary.search(input) });
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      response.status(400).json({ error: "invalid_media_search" });
      return;
    }
    const code = error instanceof Error ? error.message : "media_search_failed";
    response
      .status(code === "pexels_not_configured" ? 503 : 502)
      .json({ error: code });
  }
});

app.post(
  "/api/projects/:id/media-library/import",
  async (request, response) => {
    try {
      const input = importMediaLibraryAssetInputSchema.parse({
        ...request.body,
        project_id: request.params.id,
      });
      response.status(201).json(
        await importLibraryAsset({
          artifacts,
          library: mediaLibrary,
          projectId: input.project_id,
          provider: input.provider,
          providerAssetId: input.provider_asset_id,
          store,
          use: input.use,
        }),
      );
    } catch (error) {
      if (error && typeof error === "object" && "issues" in error) {
        response.status(400).json({ error: "invalid_media_import" });
        return;
      }
      const code =
        error instanceof Error ? error.message : "media_import_failed";
      response
        .status(code === "project_not_found" ? 404 : 502)
        .json({ error: code });
    }
  },
);

app.post("/api/projects/:id/sound-effects", async (request, response) => {
  try {
    const input = generateSoundEffectInputSchema.parse({
      ...request.body,
      project_id: request.params.id,
    });
    response
      .status(201)
      .json(await generateSoundEffectArtifact({ artifacts, input, store }));
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      response.status(400).json({ error: "invalid_sound_effect" });
      return;
    }
    const code = error instanceof Error ? error.message : "sound_effect_failed";
    response
      .status(code === "project_not_found" ? 404 : 500)
      .json({ error: code });
  }
});

const studioProject = (project: Project, artifactCount: number) => ({
  ...project,
  artifact_count: artifactCount,
  current_content_package_artifact_id:
    store.getCurrentContentArtifact(project.id)?.id ?? null,
  workspace_path: `artifacts/${project.id}`,
});

app.get("/api/projects", (_request, response) => {
  response.json({
    projects: store
      .listProjectsWithArtifactCounts()
      .map(({ project, artifactCount }) =>
        studioProject(project, artifactCount),
      ),
  });
});

app.post("/api/projects", (request, response) => {
  try {
    const project = store.createProject(projectBriefSchema.parse(request.body));
    mkdirSync(resolve(config.artifactDir, project.id), { recursive: true });
    response.status(201).json({ project: studioProject(project, 0) });
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      response.status(400).json({ error: "invalid_project_brief" });
      return;
    }
    throw error;
  }
});

app.get("/api/projects/:id", (request, response) => {
  const project = store.getProject(request.params.id);
  if (!project) {
    response.status(404).json({ error: "project_not_found" });
    return;
  }
  response.json({
    project: studioProject(project, store.countArtifacts(project.id)),
    artifacts: store.listArtifacts(project.id),
    release: store.getLatestReleaseForProject(project.id),
  });
});

const voiceSampleRequestSchema = z.object({
  locale: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i)
    .optional(),
  script: z.string().trim().min(1).max(240),
  voice_id: z.string().trim().min(1).max(80),
});

app.post("/api/projects/:id/voice-samples", async (request, response) => {
  try {
    const project = store.getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project_not_found" });
      return;
    }
    const input = voiceSampleRequestSchema.parse(request.body);
    const capabilities = voice.describe();
    if (!capabilities.available) {
      response.status(503).json({ error: "voice_provider_not_configured" });
      return;
    }
    if (!capabilities.voices.some((option) => option.id === input.voice_id)) {
      response.status(400).json({ error: "voice_not_supported" });
      return;
    }

    const scriptHash = sha256(input.script);
    const cached = store.listArtifacts(project.id).find((artifact) => {
      const provenance = artifact.provenance;
      return (
        artifact.kind === "narration" &&
        provenance.purpose === "voice_sample" &&
        provenance.model === capabilities.model &&
        provenance.voice_id === input.voice_id &&
        provenance.locale === (input.locale ?? null) &&
        provenance.script_sha256 === scriptHash
      );
    });
    if (cached) {
      response.json({ artifact: cached, cached: true });
      return;
    }

    const generated = await voice.generate({
      locale: input.locale,
      script: input.script,
      voiceId: input.voice_id,
    });
    const artifact = await artifacts.importBuffer({
      projectId: project.id,
      kind: "narration",
      filename: `voice-sample-${input.voice_id}${generated.extension}`,
      bytes: generated.bytes,
      provenance: {
        ...generated.provenance,
        purpose: "voice_sample",
      },
    });
    response.status(201).json({ artifact, cached: false });
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      response.status(400).json({ error: "invalid_voice_sample" });
      return;
    }
    const code = error instanceof Error ? error.message : "voice_sample_failed";
    response.status(502).json({ error: code });
  }
});

app.post("/api/projects/:id/editor-patches", async (request, response) => {
  try {
    const patch = editorPatchInputSchema.parse(request.body);
    if (
      patch.selection.project_id !== request.params.id ||
      !store.getProject(request.params.id)
    ) {
      response.status(404).json({ error: "project_not_found" });
      return;
    }
    response.status(201).json(
      await saveEditorPatch({
        artifacts,
        producer: "creator",
        request: patch,
        store,
      }),
    );
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      response.status(400).json({ error: "invalid_editor_patch" });
      return;
    }
    const code = error instanceof Error ? error.message : "edit_failed";
    response
      .status(code === "stale_content_package" ? 409 : 400)
      .json({ error: code });
  }
});

const restoreRevisionRequestSchema = z.object({
  base_content_package_artifact_id: z.string().min(1),
});

app.post(
  "/api/projects/:id/content-revisions/:artifactId/restore",
  async (request, response) => {
    try {
      const input = restoreRevisionRequestSchema.parse(request.body);
      response.status(201).json(
        await restoreContentRevision({
          artifacts,
          baseArtifactId: input.base_content_package_artifact_id,
          projectId: request.params.id,
          targetArtifactId: request.params.artifactId,
          store,
        }),
      );
    } catch (error) {
      if (error && typeof error === "object" && "issues" in error) {
        response.status(400).json({ error: "invalid_restore_revision" });
        return;
      }
      const code =
        error instanceof Error ? error.message : "restore_revision_failed";
      response
        .status(code === "stale_content_package" ? 409 : 400)
        .json({ error: code });
    }
  },
);

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
      const source = request.header("x-greenlight-source");
      const sandboxSessionId = request.header("x-greenlight-session-id");
      const sandboxTurnId = request.header("x-greenlight-turn-id");
      const encodedSandboxPath = request.header("x-greenlight-sandbox-path");
      const sandboxPath = encodedSandboxPath
        ? decodeURIComponent(encodedSandboxPath)
        : null;
      const fromSandbox = source === "trueforge_sandbox";
      const fromR2 = source === "cloudflare_r2";
      if (
        fromSandbox &&
        (!sandboxSessionId || !sandboxTurnId || !sandboxPath?.startsWith("/"))
      ) {
        response.status(400).json({ error: "sandbox_origin_required" });
        return;
      }
      const bytes = Buffer.isBuffer(request.body)
        ? request.body
        : Buffer.from(request.body ?? []);
      const media = inspectImportedMedia(filename, bytes);
      const metadata = await probeImportedMedia(media.extension, bytes);
      const artifact = await artifacts.importBuffer({
        projectId: project.id,
        kind: media.kind,
        filename: `creator-media${media.extension}`,
        bytes,
        provenance: {
          producer: fromSandbox ? "trueforge" : "creator",
          source: fromSandbox
            ? "sandbox_output"
            : fromR2
              ? "cloudflare_r2"
              : "local_import",
          original_filename: filename,
          ...(fromSandbox
            ? {
                trueforge_session_id: sandboxSessionId,
                trueforge_turn_id: sandboxTurnId,
              }
            : {}),
          declared_mime_type: request.header("x-greenlight-mime") ?? null,
          inspected_mime_type: media.mimeType,
          media_metadata: metadata,
          media_probe_status: metadata ? "measured" : "unavailable",
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
      mediaLibrary,
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

const rejectStatelessMcpStream = (
  request: express.Request,
  response: express.Response,
) => {
  if (!hasMcpAccess(request.header("authorization"))) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  response.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
};

app.get("/mcp", rejectStatelessMcpStream);
app.delete("/mcp", rejectStatelessMcpStream);

const listener = app.listen(config.port, config.host, () => {
  console.log(`[greenlight-mcp] listening on port ${config.port}`);
});

const shutdown = () => {
  listener.close(() => {
    store.close();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
