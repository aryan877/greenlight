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
  image: {
    apiKey: string | null;
    model: string;
    upstreamBaseUrl: string;
  };
  llmGateway: {
    apiKey: string | null;
    upstreamBaseUrl: string;
  };
  voice: {
    apiKey: string | null;
    model: string;
    voiceId: string;
  };
  transcription: {
    apiKey: string | null;
    transcriptionModel: string;
    timingBinaryPath: string;
    timingModelPath: string;
  };
  mediaLibrary: {
    pexelsApiKey: string | null;
    providers: typeof MEDIA_LIBRARY_PROVIDERS;
  };
  r2Cache: {
    readerToken: string | null;
    readerUrl: string | null;
  };
  youtube: {
    oauthClientId: string | null;
    oauthClientSecret: string | null;
    oauthRedirectUri: string;
    profile: string;
    stateSecret: string;
    tokenPath: string;
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
  const studioOrigin = new URL(
    process.env.GREENLIGHT_STUDIO_ORIGIN ?? "http://127.0.0.1:4173",
  ).origin;
  const youtubeProfile = process.env.GREENLIGHT_YOUTUBE_PROFILE ?? "main";
  const r2ReaderUrl = process.env.GREENLIGHT_R2_READER_URL?.trim() || null;
  const r2ReaderToken = process.env.GREENLIGHT_ORIGIN_TOKEN?.trim() || null;
  if (Boolean(r2ReaderUrl) !== Boolean(r2ReaderToken)) {
    throw new Error(
      "GREENLIGHT_R2_READER_URL and GREENLIGHT_ORIGIN_TOKEN must be configured together",
    );
  }

  return {
    artifactDir,
    dataDir,
    host: process.env.GREENLIGHT_MCP_HOST?.trim() || "127.0.0.1",
    mcpAuthToken,
    port: parseMcpPort(process.env.GREENLIGHT_MCP_PORT),
    studioOrigin,
    workspaceRoot,
    openMojiRoot: workspacePath(
      process.env.GREENLIGHT_OPENMOJI_ROOT ??
        resolve(homedir(), "trueforge-hackathon/openmoji"),
    ),
    image: {
      apiKey: process.env.OPENROUTER_API_KEY?.trim() || null,
      model: "openai/gpt-image-2",
      upstreamBaseUrl: "https://openrouter.ai/api/v1",
    },
    llmGateway: {
      apiKey: process.env.OPENROUTER_API_KEY?.trim() || null,
      upstreamBaseUrl: "https://openrouter.ai/api/v1",
    },
    voice: {
      apiKey: process.env.OPENROUTER_API_KEY || null,
      model: "google/gemini-3.1-flash-tts-preview",
      voiceId: process.env.GREENLIGHT_VOICE_ID ?? "Kore",
    },
    transcription: {
      apiKey: process.env.OPENROUTER_API_KEY || null,
      transcriptionModel: "openai/gpt-4o-mini-transcribe",
      timingBinaryPath: process.env.GREENLIGHT_WHISPER_BINARY ?? "whisper-cli",
      timingModelPath:
        process.env.GREENLIGHT_WHISPER_MODEL ||
        resolve(homedir(), ".cache/greenlight/models/ggml-base.bin"),
    },
    mediaLibrary: {
      pexelsApiKey: process.env.PEXELS_API_KEY || null,
      providers: MEDIA_LIBRARY_PROVIDERS,
    },
    r2Cache: {
      readerToken: r2ReaderToken,
      readerUrl: r2ReaderUrl,
    },
    youtube: {
      oauthClientId: process.env.GREENLIGHT_YOUTUBE_CLIENT_ID?.trim() || null,
      oauthClientSecret:
        process.env.GREENLIGHT_YOUTUBE_CLIENT_SECRET?.trim() || null,
      oauthRedirectUri:
        process.env.GREENLIGHT_YOUTUBE_REDIRECT_URI?.trim() ||
        `${studioOrigin}/greenlight-api/youtube/callback`,
      profile: youtubeProfile,
      stateSecret: mcpAuthToken,
      tokenPath:
        process.env.GREENLIGHT_YOUTUBE_TOKEN_PATH ||
        resolve(
          homedir(),
          `.config/youtube-uploader/tokens/${youtubeProfile}.json`,
        ),
      uploaderPath:
        process.env.GREENLIGHT_YOUTUBE_UPLOADER || "youtube-uploader",
    },
  };
};
