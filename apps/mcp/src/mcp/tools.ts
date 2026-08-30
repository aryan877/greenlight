import {
  artifactChunkSchema,
  captionTrackSchema,
  attachOpenMojiInputSchema,
  contentPackageSchema,
  correctTranscriptInputSchema,
  editorFocusInputSchema,
  editorPatchInputSchema,
  evidenceLedgerSchema,
  generateImageInputSchema,
  generateSoundEffectInputSchema,
  generateVoiceInputSchema,
  getArtifactInputSchema,
  idSchema,
  importMediaLibraryAssetInputSchema,
  projectBriefSchema,
  publishVideoInputSchema,
  qualityCheckInputSchema,
  qualityReportSchema,
  readArtifactChunkInputSchema,
  renderVideoInputSchema,
  scheduleVideoInputSchema,
  searchMediaLibraryInputSchema,
  searchOpenMojiInputSchema,
  stageVideoInputSchema,
  transcribeAudioInputSchema,
  transcriptSchema,
} from "@greenlight/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { extname } from "node:path";
import { z } from "zod";

import { createId, hashJson, now } from "../lib/canonical.js";
import type { CodexImageProvider } from "../providers/codex-image.js";
import type { QualityInspector } from "../providers/quality.js";
import type { OpenMojiToolkit } from "../providers/openmoji.js";
import type { MediaLibraryProvider } from "../providers/media-library.js";
import type { RemotionRenderer } from "../providers/render.js";
import type { TranscriptionProvider } from "../providers/transcription.js";
import type { VoiceProvider } from "../providers/voice.js";
import type { YouTubeUploader } from "../providers/youtube.js";
import type { ArtifactStore } from "../storage/artifacts.js";
import type { GreenlightStore } from "../storage/store.js";
import { saveEditorPatch } from "../services/editor-patches.js";
import { importLibraryAsset } from "../services/media-library.js";
import { generateSoundEffectArtifact } from "../services/sound-design.js";

type ToolDependencies = {
  artifacts: ArtifactStore;
  image: CodexImageProvider;
  mediaLibrary: MediaLibraryProvider;
  openmoji: OpenMojiToolkit;
  quality: QualityInspector;
  renderer: RemotionRenderer;
  store: GreenlightStore;
  transcription: TranscriptionProvider;
  voice: VoiceProvider;
  youtube: YouTubeUploader;
};

const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
});

export const captionsFromTimedWords = (
  words: Array<{
    text: string;
    start_seconds: number;
    end_seconds: number;
  }>,
) =>
  words.map((word, index) => {
    const startMs = Math.floor(word.start_seconds * 1_000);
    const measuredEndMs = Math.ceil(word.end_seconds * 1_000);
    return {
      text: `${index === 0 ? "" : " "}${word.text}`,
      startMs,
      endMs: Math.max(measuredEndMs, startMs + 1),
      timestampMs: null,
      confidence: null,
    };
  });

export const buildMcpServer = ({
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
}: ToolDependencies): McpServer => {
  const server = new McpServer(
    { name: "greenlight", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "get_media_capabilities",
    {
      title: "Inspect configured media capabilities",
      description:
        "Report which image, voice, render, and YouTube capabilities are configured. Does not call a provider.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      result({
        image: await image.describe(),
        openmoji: openmoji.describe(),
        media_library: mediaLibrary.describe(),
        voice: voice.describe(),
        transcription: transcription.describe(),
        render: { available: true, provider: "remotion" },
        youtube: { available: true, mode: "local_oauth_profile" },
      }),
  );

  server.registerTool(
    "search_media_library",
    {
      title: "Search licensed B-roll or audio",
      description:
        "Search the configured stock-media adapters by meaning. Returns provider asset IDs, previews, source pages, creator names, and license metadata. Search only; it does not download or place media.",
      inputSchema: searchMediaLibraryInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const request = searchMediaLibraryInputSchema.parse(input);
      return result({ results: await mediaLibrary.search(request) });
    },
  );

  server.registerTool(
    "import_media_library_asset",
    {
      title: "Import one licensed media result",
      description:
        "Resolve one selected provider asset ID server-side, verify its current license metadata, and save immutable media plus a license receipt. Use the returned artifact ID in an editor patch; never pass a provider download URL to the timeline.",
      inputSchema: importMediaLibraryAssetInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const request = importMediaLibraryAssetInputSchema.parse(input);
      return result(
        await importLibraryAsset({
          artifacts,
          library: mediaLibrary,
          projectId: request.project_id,
          provider: request.provider,
          providerAssetId: request.provider_asset_id,
          store,
          use: request.use,
        }),
      );
    },
  );

  server.registerTool(
    "search_openmoji",
    {
      title: "Search the local OpenMoji toolkit",
      description:
        "Find license-compatible OpenMoji SVG assets by meaning. Returns stable hexcodes and labels from the local catalog; it does not attach or render anything.",
      inputSchema: searchOpenMojiInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const request = searchOpenMojiInputSchema.parse(input);
      return result({
        matches: await openmoji.search(request.query, request.limit),
        attribution: "All emojis designed by OpenMoji, licensed CC BY-SA 4.0.",
      });
    },
  );

  server.registerTool(
    "generate_sound_effect",
    {
      title: "Generate one sound-effect preview",
      description:
        "Synthesize a deterministic local WAV from a Greenlight sound preset. Saves an immutable preview artifact but does not edit the timeline. The creator can audition it before either direct UI placement or an approved editor patch.",
      inputSchema: generateSoundEffectInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const request = generateSoundEffectInputSchema.parse(input);
      return result(
        await generateSoundEffectArtifact({ artifacts, input: request, store }),
      );
    },
  );

  server.registerTool(
    "attach_openmoji",
    {
      title: "Attach one OpenMoji visual",
      description:
        "Copy one selected OpenMoji SVG into the production as an immutable image artifact with source and license provenance.",
      inputSchema: attachOpenMojiInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      const request = attachOpenMojiInputSchema.parse(input);
      if (!store.getProject(request.project_id)) {
        throw new Error("project_not_found");
      }
      return result({
        artifact: await openmoji.attach({
          projectId: request.project_id,
          sceneId: request.scene_id,
          hexcode: request.hexcode,
        }),
      });
    },
  );

  server.registerTool(
    "create_project",
    {
      title: "Create a Greenlight production",
      description:
        "Create a short-form YouTube production from a validated editorial brief. Returns the durable project ID.",
      inputSchema: projectBriefSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) =>
      result(store.createProject(projectBriefSchema.parse(input))),
  );

  server.registerTool(
    "get_project",
    {
      title: "Inspect a Greenlight production",
      description:
        "Read the current production stage, brief, blocker, and immutable artifact inventory.",
      inputSchema: { project_id: idSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id }) => {
      const project = store.getProject(project_id);
      if (!project) throw new Error("project_not_found");
      return result({
        project,
        current_content_package_artifact_id:
          store.getCurrentContentArtifact(project_id)?.id ?? null,
        artifacts: store.listArtifacts(project_id),
      });
    },
  );

  server.registerTool(
    "get_artifact",
    {
      title: "Read one Greenlight artifact",
      description:
        "Read a selected artifact by ID. JSON returns its value; binary media returns its kind, MIME type, provenance, and stable project-workspace reference. Never use or request a host path.",
      inputSchema: getArtifactInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const request = getArtifactInputSchema.parse(input);
      const resolved = artifacts.resolveArtifact(request.artifact_id);
      if (resolved.artifact.project_id !== request.project_id) {
        throw new Error("artifact_project_mismatch");
      }
      const value =
        resolved.artifact.mime_type === "application/json"
          ? await artifacts.readJson(request.artifact_id)
          : null;
      return result({ artifact: resolved.artifact, value });
    },
  );

  server.registerTool(
    "read_artifact_chunk",
    {
      title: "Stream managed media into Code Mode",
      description:
        "Read one bounded chunk of an immutable Greenlight artifact. Use this only from TrueForge Code Mode to assemble an authorized sandbox copy for media inspection or FFmpeg. Loop until eof, verify sha256, and never print base64 or expose a host path.",
      inputSchema: readArtifactChunkInputSchema.shape,
      outputSchema: artifactChunkSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const request = readArtifactChunkInputSchema.parse(input);
      const resolved = artifacts.resolveArtifact(request.artifact_id);
      if (resolved.artifact.project_id !== request.project_id) {
        throw new Error("artifact_project_mismatch");
      }

      const bytes = await artifacts.readChunk(
        request.artifact_id,
        request.offset_bytes,
        request.length_bytes,
      );
      const nextOffset = request.offset_bytes + bytes.byteLength;
      const payload = artifactChunkSchema.parse({
        artifact_id: resolved.artifact.id,
        suggested_filename: `${resolved.artifact.id}${extname(resolved.artifact.relative_path)}`,
        mime_type: resolved.artifact.mime_type,
        sha256: resolved.artifact.sha256,
        offset_bytes: request.offset_bytes,
        length_bytes: bytes.byteLength,
        total_bytes: resolved.artifact.byte_size,
        next_offset_bytes:
          nextOffset < resolved.artifact.byte_size ? nextOffset : null,
        eof: nextOffset >= resolved.artifact.byte_size,
        data_base64: bytes.toString("base64"),
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Read ${String(payload.length_bytes)} of ${String(payload.total_bytes)} bytes.`,
          },
        ],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    "save_evidence_ledger",
    {
      title: "Save the sourced evidence ledger",
      description:
        "Validate claim-to-source references and save an immutable evidence ledger. Unsupported or conflicted claims remain visible.",
      inputSchema: evidenceLedgerSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      const ledger = evidenceLedgerSchema.parse(input);
      if (!store.getProject(ledger.project_id))
        throw new Error("project_not_found");
      const artifact = await artifacts.importJson({
        projectId: ledger.project_id,
        kind: "evidence_ledger",
        value: ledger,
        provenance: { producer: "trueforge", contract_version: 1 },
      });
      const hasBlocker = ledger.claims.some(
        (claim) => claim.status !== "supported",
      );
      const project = store.setProjectStage(
        ledger.project_id,
        hasBlocker ? "blocked" : "drafted",
        hasBlocker ? "Evidence ledger contains unresolved claims" : null,
      );
      return result({ artifact, project });
    },
  );

  server.registerTool(
    "save_content_package",
    {
      title: "Save a production-ready content package",
      description:
        "Validate and save the complete script, storyboard, timeline, and YouTube metadata as one immutable package.",
      inputSchema: contentPackageSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      const contentPackage = contentPackageSchema.parse(input);
      const project = store.getProject(contentPackage.project_id);
      if (!project) throw new Error("project_not_found");
      const evidence = store
        .listArtifacts(contentPackage.project_id)
        .filter((artifact) => artifact.kind === "evidence_ledger")
        .at(-1);
      if (!evidence) throw new Error("evidence_ledger_required");
      const artifact = await artifacts.importJson({
        projectId: contentPackage.project_id,
        kind: "content_package",
        value: contentPackage,
        provenance: {
          producer: "trueforge",
          evidence_ledger_artifact_id: evidence.id,
          contract_version: 1,
        },
      });
      store.setCurrentContentArtifact(contentPackage.project_id, artifact.id);
      return result({
        artifact,
        project: store.setProjectStage(contentPackage.project_id, "packaged"),
      });
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List Greenlight productions",
      description: "Read the local production index for the studio.",
      inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ limit }) =>
      result({ projects: store.listProjects().slice(0, limit) }),
  );

  server.registerTool(
    "apply_editor_patch",
    {
      title: "Apply a scoped editor revision",
      description:
        "Apply one validated non-destructive edit patch to the exact selected content package. Selection is context: operations may target only the scenes the edit actually changes. Cuts are frame-aligned; shortening records gap_after_seconds; source-backed extension is limited by the recorded source range and existing gap. Creator media is referenced only by artifact ID. Saves immutable patch and content-package revisions; never overwrites the base cut.",
      inputSchema: editorPatchInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      const request = editorPatchInputSchema.parse(input);
      return result(
        await saveEditorPatch({
          artifacts,
          producer: "trueforge",
          request,
          store,
        }),
      );
    },
  );

  server.registerTool(
    "focus_editor_selection",
    {
      title: "Focus an exact editor selection",
      description:
        "Ask Greenlight Studio to focus the exact scene, track, artifacts, and time range that the producer is discussing. This changes only local editor focus and never mutates production data.",
      inputSchema: editorFocusInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => result(editorFocusInputSchema.parse(input)),
  );

  server.registerTool(
    "generate_image",
    {
      title: "Generate one editorial image",
      description:
        "Use the owner's authenticated Codex subscription and built-in imagegen skill to create one bounded visual or thumbnail artifact.",
      inputSchema: generateImageInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const request = generateImageInputSchema.parse(input);
      if (!store.getProject(request.project_id))
        throw new Error("project_not_found");
      const artifact = await image.generate({
        projectId: request.project_id,
        sceneId: request.scene_id,
        kind: request.kind,
        prompt: request.prompt,
        aspectRatio: request.aspect_ratio,
      });
      return result({ artifact });
    },
  );

  server.registerTool(
    "generate_voice",
    {
      title: "Generate one narration artifact",
      description:
        "Generate one immutable scene-sized narration or dub WAV using the configured voice provider, optional BCP-47 locale, and optional provider voice ID. Word timing and captions are created separately by transcribe_audio, never estimated.",
      inputSchema: generateVoiceInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const request = generateVoiceInputSchema.parse(input);
      if (!store.getProject(request.project_id))
        throw new Error("project_not_found");
      const generated = await voice.generate({
        locale: request.locale,
        script: request.script,
        voiceId: request.voice_id,
      });
      const artifact = await artifacts.importBuffer({
        projectId: request.project_id,
        kind: "narration",
        filename: `${request.scene_id}${generated.extension}`,
        bytes: generated.bytes,
        generation: {
          media_type: "audio",
          provider: generated.generation.provider,
          model: generated.generation.model,
          runtime: generated.generation.runtime,
          input_hashes: [generated.generation.scriptSha256],
          script_sha256: generated.generation.scriptSha256,
          voice_id: generated.generation.voiceId,
          duration_seconds: generated.durationSeconds,
          generated_at: now(),
          provider_reported_cost: generated.generation.providerReportedCost,
          disclosure: {
            contains_synthetic_media: true,
            method: "generated",
          },
        },
        provenance: {
          ...generated.provenance,
          scene_id: request.scene_id,
          track_id: request.track_id ?? null,
        },
      });
      return result({
        narration_artifact: artifact,
        duration_seconds: generated.durationSeconds,
      });
    },
  );

  server.registerTool(
    "transcribe_audio",
    {
      title: "Transcribe media with word timing",
      description:
        "Create an immutable transcript for one narration artifact or rendered video. Uses OpenRouter gpt-4o-mini-transcribe for the reference text and local whisper.cpp word timestamps for precise captioning and phrase cuts. Ask the creator before calling this paid provider.",
      inputSchema: transcribeAudioInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const request = transcribeAudioInputSchema.parse(input);
      if (!store.getProject(request.project_id)) {
        throw new Error("project_not_found");
      }
      const audio = artifacts.resolveArtifact(request.audio_artifact_id);
      if (
        audio.artifact.project_id !== request.project_id ||
        !["narration", "video"].includes(audio.artifact.kind)
      ) {
        throw new Error("invalid_transcribable_artifact");
      }
      const generated = await transcription.transcribe({
        absolutePath: audio.absolutePath,
        filename: audio.artifact.relative_path.split("/").at(-1) ?? "media.wav",
        mimeType: audio.artifact.mime_type,
        locale: request.locale,
        prompt: request.prompt,
      });
      const transcript = transcriptSchema.parse({
        version: 1,
        project_id: request.project_id,
        scene_id: request.scene_id,
        audio_artifact_id: request.audio_artifact_id,
        locale: request.locale,
        text: generated.timedText,
        reference_text: generated.referenceText,
        words: generated.words,
        provider: generated.provenance,
      });
      const artifact = await artifacts.importJson({
        projectId: request.project_id,
        kind: "transcript",
        value: transcript,
        provenance: {
          ...generated.provenance,
          scene_id: request.scene_id,
          audio_artifact_id: request.audio_artifact_id,
        },
      });
      const captionTrack = captionTrackSchema.parse({
        version: 1,
        project_id: request.project_id,
        scene_id: request.scene_id,
        locale: request.locale,
        transcript_artifact_id: artifact.id,
        cues: captionsFromTimedWords(transcript.words),
      });
      const captions = await artifacts.importJson({
        projectId: request.project_id,
        kind: "caption",
        value: captionTrack,
        provenance: {
          producer: "greenlight_timed_transcript",
          scene_id: request.scene_id,
          narration_artifact_id: request.audio_artifact_id,
          transcript_artifact_id: artifact.id,
        },
      });
      return result({
        transcript_artifact: artifact,
        captions_artifact: captions,
        transcript,
      });
    },
  );

  server.registerTool(
    "correct_transcript",
    {
      title: "Correct transcript words",
      description:
        "Save text corrections against existing measured word timestamps. Timing never changes silently; the result is a new immutable transcript revision.",
      inputSchema: correctTranscriptInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      const request = correctTranscriptInputSchema.parse(input);
      const resolved = artifacts.resolveArtifact(
        request.transcript_artifact_id,
      );
      if (
        resolved.artifact.project_id !== request.project_id ||
        resolved.artifact.kind !== "transcript"
      ) {
        throw new Error("invalid_transcript_artifact");
      }
      const current = transcriptSchema.parse(
        await artifacts.readJson(request.transcript_artifact_id),
      );
      const words = current.words.map((word) => ({ ...word }));
      for (const replacement of request.replacements) {
        const word = words.find(
          (candidate) => candidate.index === replacement.word_index,
        );
        if (!word)
          throw new Error(
            `transcript_word_not_found:${replacement.word_index}`,
          );
        word.text = replacement.text;
      }
      const transcript = transcriptSchema.parse({
        ...current,
        text: words.map((word) => word.text).join(" "),
        words,
      });
      const artifact = await artifacts.importJson({
        projectId: request.project_id,
        kind: "transcript",
        value: transcript,
        provenance: {
          ...current.provider,
          parent_transcript_artifact_id: request.transcript_artifact_id,
          correction_note: request.note,
        },
      });
      const captionTrack = captionTrackSchema.parse({
        version: 1,
        project_id: current.project_id,
        scene_id: current.scene_id,
        locale: current.locale,
        transcript_artifact_id: artifact.id,
        cues: captionsFromTimedWords(words),
      });
      const captions = await artifacts.importJson({
        projectId: request.project_id,
        kind: "caption",
        value: captionTrack,
        provenance: {
          producer: "greenlight_timed_transcript",
          scene_id: current.scene_id,
          narration_artifact_id: current.audio_artifact_id,
          transcript_artifact_id: artifact.id,
          parent_transcript_artifact_id: request.transcript_artifact_id,
        },
      });
      return result({
        transcript_artifact: artifact,
        captions_artifact: captions,
        transcript,
      });
    },
  );

  server.registerTool(
    "render_video",
    {
      title: "Render the current content package",
      description:
        "Render an immutable content package with Remotion into video and thumbnail artifacts.",
      inputSchema: renderVideoInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const request = renderVideoInputSchema.parse(input);
      if (!store.getProject(request.project_id))
        throw new Error("project_not_found");
      const operation = store.beginOperation({
        projectId: request.project_id,
        type: "render",
        idempotencyKey: request.idempotency_key,
        payload: request,
      });
      if (operation.existing) {
        if (!operation.result) throw new Error("operation_already_started");
        return result(operation.result);
      }
      store.setProjectStage(request.project_id, "rendering");
      try {
        const rendered = await renderer.render({
          projectId: request.project_id,
          contentPackageArtifactId: request.content_package_artifact_id,
        });
        const output = {
          ...rendered,
          project: store.setProjectStage(request.project_id, "rendered"),
        };
        store.finishOperation(operation.id, output);
        return result(output);
      } catch (error) {
        store.failOperation(operation.id, "render_failed");
        store.setProjectStage(
          request.project_id,
          "render_failed",
          error instanceof Error
            ? error.message.slice(0, 300)
            : "render_failed",
        );
        throw error;
      }
    },
  );

  server.registerTool(
    "run_quality_checks",
    {
      title: "Inspect a rendered production",
      description:
        "Run deterministic evidence, duration, frame, audio, and YouTube metadata checks and save the report.",
      inputSchema: qualityCheckInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      const request = qualityCheckInputSchema.parse(input);
      const report = await quality.inspect({
        projectId: request.project_id,
        videoArtifactId: request.video_artifact_id,
        contentPackageArtifactId: request.content_package_artifact_id,
        evidenceLedgerArtifactId: request.evidence_ledger_artifact_id,
      });
      const artifact = await artifacts.importJson({
        projectId: request.project_id,
        kind: "quality_report",
        value: report,
        provenance: {
          producer: "greenlight_quality_inspector",
          video_artifact_id: request.video_artifact_id,
          content_package_artifact_id: request.content_package_artifact_id,
          evidence_ledger_artifact_id: request.evidence_ledger_artifact_id,
          contract_version: 1,
        },
      });
      const project = store.setProjectStage(
        request.project_id,
        report.passed ? "verified" : "blocked",
        report.passed ? null : "Quality report contains failed checks",
      );
      return result({ artifact, project, report });
    },
  );

  server.registerTool(
    "stage_video_unlisted",
    {
      title: "Stage a verified video on YouTube",
      description:
        "Upload a verified video to the configured YouTube channel as unlisted, attach metadata and thumbnail, and lock an immutable release snapshot.",
      inputSchema: stageVideoInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const request = stageVideoInputSchema.parse(input);
      const project = store.getProject(request.project_id);
      if (!project) throw new Error("project_not_found");
      const video = artifacts.resolveArtifact(request.video_artifact_id);
      const content = artifacts.resolveArtifact(
        request.content_package_artifact_id,
      );
      const evidence = artifacts.resolveArtifact(
        request.evidence_ledger_artifact_id,
      );
      const qualityArtifact = artifacts.resolveArtifact(
        request.quality_report_artifact_id,
      );
      const requiredArtifacts = [
        [video.artifact, "video"],
        [content.artifact, "content_package"],
        [evidence.artifact, "evidence_ledger"],
        [qualityArtifact.artifact, "quality_report"],
      ] as const;
      for (const [artifact, kind] of requiredArtifacts) {
        if (
          artifact.project_id !== request.project_id ||
          artifact.kind !== kind
        ) {
          throw new Error(`invalid_${kind}_artifact`);
        }
      }
      const qualityReport = qualityReportSchema.parse(
        await artifacts.readJson(request.quality_report_artifact_id),
      );
      if (!qualityReport.passed) throw new Error("quality_report_failed");
      if (
        qualityReport.project_id !== request.project_id ||
        qualityReport.video_artifact_id !== request.video_artifact_id ||
        qualityReport.content_package_artifact_id !==
          request.content_package_artifact_id ||
        qualityReport.evidence_ledger_artifact_id !==
          request.evidence_ledger_artifact_id
      ) {
        throw new Error("quality_report_input_mismatch");
      }
      const contentPackage = contentPackageSchema.parse(
        await artifacts.readJson(request.content_package_artifact_id),
      );
      if (!contentPackage.release.thumbnail_artifact_id) {
        throw new Error("release_thumbnail_required");
      }
      const thumbnail = artifacts.resolveArtifact(
        contentPackage.release.thumbnail_artifact_id,
      );
      if (
        thumbnail.artifact.project_id !== request.project_id ||
        thumbnail.artifact.kind !== "thumbnail"
      ) {
        throw new Error("invalid_thumbnail_artifact");
      }
      const operation = store.beginOperation({
        projectId: request.project_id,
        type: "youtube_unlisted_upload",
        idempotencyKey: request.idempotency_key,
        payload: request,
      });
      if (operation.existing) {
        if (!operation.result) throw new Error("operation_already_started");
        return result(operation.result);
      }
      store.setProjectStage(request.project_id, "uploading");
      try {
        const uploaded = await youtube.uploadUnlisted({
          videoPath: video.absolutePath,
          thumbnailPath: thumbnail.absolutePath,
          metadata: contentPackage.metadata,
        });
        const releaseId = createId("release");
        const savedRelease = store.createRelease({
          id: releaseId,
          project_id: request.project_id,
          youtube_video_id: uploaded.video_id,
          channel_id: uploaded.channel.channel_id,
          video_sha256: video.artifact.sha256,
          content_package_sha256: content.artifact.sha256,
          metadata_sha256: hashJson(contentPackage.metadata),
          quality_report_sha256: qualityArtifact.artifact.sha256,
          evidence_ledger_sha256: evidence.artifact.sha256,
          privacy: "unlisted",
          created_at: new Date().toISOString(),
        });
        const output = {
          release: savedRelease,
          youtube: uploaded,
          project: store.setProjectStage(
            request.project_id,
            "awaiting_approval",
          ),
        };
        store.finishOperation(operation.id, output);
        return result(output);
      } catch (error) {
        store.failOperation(operation.id, "upload_failed");
        store.setProjectStage(
          request.project_id,
          "upload_failed",
          error instanceof Error
            ? error.message.slice(0, 300)
            : "upload_failed",
        );
        throw error;
      }
    },
  );

  server.registerTool(
    "publish_video",
    {
      title: "Publish the approved YouTube release",
      description:
        "Make the exact unlisted release snapshot public. This is externally consequential and must be approved in TrueForge.",
      inputSchema: publishVideoInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const request = publishVideoInputSchema.parse(input);
      const release = store.getRelease(request.youtube_release_id);
      if (!release || release.snapshot.project_id !== request.project_id) {
        throw new Error("release_not_found");
      }
      if (release.snapshotSha256 !== request.release_snapshot_sha256) {
        throw new Error("release_snapshot_changed");
      }
      const operation = store.beginOperation({
        projectId: request.project_id,
        type: "youtube_publish",
        idempotencyKey: request.idempotency_key,
        payload: request,
      });
      if (operation.existing) {
        if (!operation.result) throw new Error("operation_already_started");
        return result(operation.result);
      }
      if (release.privacy !== "unlisted") {
        store.failOperation(operation.id, "release_not_unlisted");
        throw new Error("release_not_unlisted");
      }
      let claimed = false;
      try {
        store.claimRelease(request.youtube_release_id, "publishing");
        claimed = true;
        const youtubeResult = await youtube.publish(
          release.snapshot.youtube_video_id,
        );
        store.completeRelease(
          request.youtube_release_id,
          "publishing",
          "public",
        );
        const output = {
          youtube: youtubeResult,
          project: store.setProjectStage(request.project_id, "released"),
        };
        store.finishOperation(operation.id, output);
        return result(output);
      } catch (error) {
        if (claimed) {
          try {
            store.rollbackReleaseClaim(
              request.youtube_release_id,
              "publishing",
            );
          } catch (rollbackError) {
            store.failOperation(operation.id, "release_rollback_failed");
            throw new AggregateError(
              [error, rollbackError],
              "publish_failed_and_release_rollback_failed",
            );
          }
        }
        store.failOperation(operation.id, "publish_failed");
        throw error;
      }
    },
  );

  server.registerTool(
    "schedule_video",
    {
      title: "Schedule the approved YouTube release",
      description:
        "Schedule the exact unlisted release snapshot for public release. This is externally consequential and must be approved in TrueForge.",
      inputSchema: scheduleVideoInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const request = scheduleVideoInputSchema.parse(input);
      if (new Date(request.publish_at).getTime() <= Date.now()) {
        throw new Error("schedule_time_must_be_future");
      }
      const release = store.getRelease(request.youtube_release_id);
      if (!release || release.snapshot.project_id !== request.project_id) {
        throw new Error("release_not_found");
      }
      if (release.snapshotSha256 !== request.release_snapshot_sha256) {
        throw new Error("release_snapshot_changed");
      }
      const operation = store.beginOperation({
        projectId: request.project_id,
        type: "youtube_schedule",
        idempotencyKey: request.idempotency_key,
        payload: request,
      });
      if (operation.existing) {
        if (!operation.result) throw new Error("operation_already_started");
        return result(operation.result);
      }
      if (release.privacy !== "unlisted") {
        store.failOperation(operation.id, "release_not_unlisted");
        throw new Error("release_not_unlisted");
      }
      let claimed = false;
      try {
        store.claimRelease(request.youtube_release_id, "scheduling");
        claimed = true;
        const youtubeResult = await youtube.schedule(
          release.snapshot.youtube_video_id,
          request.publish_at,
        );
        store.completeRelease(
          request.youtube_release_id,
          "scheduling",
          "scheduled",
        );
        const output = {
          youtube: youtubeResult,
          project: store.setProjectStage(request.project_id, "released"),
        };
        store.finishOperation(operation.id, output);
        return result(output);
      } catch (error) {
        if (claimed) {
          try {
            store.rollbackReleaseClaim(
              request.youtube_release_id,
              "scheduling",
            );
          } catch (rollbackError) {
            store.failOperation(operation.id, "release_rollback_failed");
            throw new AggregateError(
              [error, rollbackError],
              "schedule_failed_and_release_rollback_failed",
            );
          }
        }
        store.failOperation(operation.id, "schedule_failed");
        throw error;
      }
    },
  );

  return server;
};
