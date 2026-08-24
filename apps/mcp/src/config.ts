import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const workspacePath = (value: string): string =>
  isAbsolute(value) ? value : resolve(workspaceRoot, value);

export type GreenlightConfig = {
  artifactDir: string;
  dataDir: string;
  port: number;
  workspaceRoot: string;
  openMojiRoot: string;
  codex: {
    binaryPath: string;
    model: string | null;
  };
  voice: {
    apiKey: string | null;
    model: string;
    provider: "openrouter" | "disabled";
    voiceId: string;
  };
  transcription: {
    apiKey: string | null;
    provider: "openai" | "disabled";
    transcriptionModel: string;
    timingModel: string;
  };
  youtube: {
    allowedChannelId: string | null;
    profile: string;
    uploaderPath: string;
  };
};

export const loadConfig = (): GreenlightConfig => {
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
    process.env.GREENLIGHT_TRANSCRIPTION_PROVIDER ?? "openai";
  if (!["openai", "disabled"].includes(configuredTranscriptionProvider)) {
    throw new Error("unsupported_transcription_provider");
  }

  return {
    artifactDir,
    dataDir,
    port: Number(process.env.GREENLIGHT_MCP_PORT ?? 8941),
    workspaceRoot,
    openMojiRoot: workspacePath(
      process.env.GREENLIGHT_OPENMOJI_ROOT ??
        "/Users/aryankumar/trueforge-hackathon/openmoji",
    ),
    codex: {
      binaryPath: process.env.GREENLIGHT_CODEX_BINARY ?? "codex",
      model: process.env.GREENLIGHT_CODEX_MODEL || null,
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
      apiKey: process.env.OPENAI_API_KEY || null,
      provider: configuredTranscriptionProvider as "openai" | "disabled",
      transcriptionModel:
        process.env.GREENLIGHT_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe",
      timingModel:
        process.env.GREENLIGHT_TRANSCRIPTION_TIMING_MODEL ?? "whisper-1",
    },
    youtube: {
      allowedChannelId: process.env.GREENLIGHT_YOUTUBE_CHANNEL_ID || null,
      profile: process.env.GREENLIGHT_YOUTUBE_PROFILE ?? "main",
      uploaderPath:
        process.env.GREENLIGHT_YOUTUBE_UPLOADER ??
        "/Users/aryankumar/youtube-uploader/.venv/bin/youtube-uploader",
    },
  };
};
