import { dirname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const workspacePath = (value: string): string =>
  isAbsolute(value) ? value : resolve(workspaceRoot, value);

export const MEDIA_LIBRARY_PROVIDERS = {
  pexels: {
    apiBaseUrl: "https://api.pexels.com",
    uses: ["broll"],
    capabilityUse: "broll",
  },
  openverse: {
    apiBaseUrl: "https://api.openverse.org",
    uses: ["music", "sound_effect"],
    capabilityUse: "music_and_sound_effects",
  },
} as const;

export const parseMcpPort = (value: string | undefined): number => {
  const port = Number(value ?? 8941);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("GREENLIGHT_MCP_PORT must be an integer from 1 to 65535");
  }
  return port;
};

export type GreenlightConfig = {
  artifactDir: string;
  dataDir: string;
  host: string;
  mcpAuthToken: string;
  port: number;
  studioOrigin: string;
  workspaceRoot: string;
  openMojiRoot: string;
  codex: {
    binaryPath: string;
    model: string | null;
  };
  llmGateway: {
    apiKey: string | null;
    upstreamBaseUrl: string;
  };
  voice: {
    apiKey: string | null;
    model: string;
    provider: "openrouter" | "disabled";
    voiceId: string;
  };
  transcription: {
    apiKey: string | null;
    provider: "openrouter" | "disabled";
    transcriptionModel: string;
    timingBinaryPath: string;
    timingModelPath: string;
  };
  mediaLibrary: {
    pexelsApiKey: string | null;
    providers: typeof MEDIA_LIBRARY_PROVIDERS;
  };
  youtube: {
    allowedChannelId: string | null;
    profile: string;
    uploaderPath: string;
  };
};

export const loadConfig = (): GreenlightConfig => {
  const mcpAuthToken = process.env.GREENLIGHT_MCP_AUTH_TOKEN?.trim();
  if (!mcpAuthToken || mcpAuthToken.length < 32) {
    throw new Error(
      "GREENLIGHT_MCP_AUTH_TOKEN must contain at least 32 characters",
    );
  }
  const dataDir = workspacePath(process.env.GREENLIGHT_DATA_DIR ?? "data");
  const artifactDir = workspacePath(
    process.env.GREENLIGHT_ARTIFACT_DIR ?? "artifacts",
  );
  const configuredVoiceProvider =
    process.env.GREENLIGHT_VOICE_PROVIDER ?? "openrouter";
  if (!["openrouter", "disabled"].includes(configuredVoiceProvider)) {
    throw new Error("unsupported_voice_provider");
  }
  const configuredTranscriptionProvider =
    process.env.GREENLIGHT_TRANSCRIPTION_PROVIDER ?? "openrouter";
  if (!["openrouter", "disabled"].includes(configuredTranscriptionProvider)) {
    throw new Error("unsupported_transcription_provider");
  }

  return {
    artifactDir,
    dataDir,
    host: process.env.GREENLIGHT_MCP_HOST?.trim() || "127.0.0.1",
    mcpAuthToken,
    port: parseMcpPort(process.env.GREENLIGHT_MCP_PORT),
    studioOrigin: new URL(
      process.env.GREENLIGHT_STUDIO_ORIGIN ?? "http://127.0.0.1:4173",
    ).origin,
    workspaceRoot,
    openMojiRoot: workspacePath(
      process.env.GREENLIGHT_OPENMOJI_ROOT ??
        resolve(homedir(), "trueforge-hackathon/openmoji"),
    ),
    codex: {
      binaryPath: process.env.GREENLIGHT_CODEX_BINARY ?? "codex",
      model: process.env.GREENLIGHT_CODEX_MODEL || null,
    },
    llmGateway: {
      apiKey:
        process.env.GREENLIGHT_ROOT_API_KEY?.trim() ||
        process.env.OPENROUTER_API_KEY?.trim() ||
        null,
      upstreamBaseUrl: (
        process.env.GREENLIGHT_ROOT_BASE_URL ?? "https://openrouter.ai/api/v1"
      ).replace(/\/$/, ""),
    },
    voice: {
      apiKey: process.env.OPENROUTER_API_KEY || null,
      model:
        process.env.GREENLIGHT_VOICE_MODEL ??
        "google/gemini-3.1-flash-tts-preview",
      provider: configuredVoiceProvider as "openrouter" | "disabled",
      voiceId: process.env.GREENLIGHT_VOICE_ID ?? "Kore",
    },
    transcription: {
      apiKey: process.env.OPENROUTER_API_KEY || null,
      provider: configuredTranscriptionProvider as "openrouter" | "disabled",
      transcriptionModel:
        process.env.GREENLIGHT_TRANSCRIPTION_MODEL ??
        "openai/gpt-4o-mini-transcribe",
      timingBinaryPath: process.env.GREENLIGHT_WHISPER_BINARY ?? "whisper-cli",
      timingModelPath:
        process.env.GREENLIGHT_WHISPER_MODEL ||
        resolve(homedir(), ".cache/greenlight/models/ggml-base.bin"),
    },
    mediaLibrary: {
      pexelsApiKey: process.env.PEXELS_API_KEY || null,
      providers: MEDIA_LIBRARY_PROVIDERS,
    },
    youtube: {
      allowedChannelId: process.env.GREENLIGHT_YOUTUBE_CHANNEL_ID || null,
      profile: process.env.GREENLIGHT_YOUTUBE_PROFILE ?? "main",
      uploaderPath:
        process.env.GREENLIGHT_YOUTUBE_UPLOADER || "youtube-uploader",
    },
  };
};
