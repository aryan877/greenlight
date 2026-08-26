import { extname } from "node:path";

import {
  mediaLibraryResultSchema,
  mediaLicenseReceiptSchema,
  type MediaLibraryResult,
  type MediaLicenseReceipt,
} from "@greenlight/contracts";
import { z } from "zod";

import type { GreenlightConfig } from "../config.js";

const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;

type SearchInput = {
  query: string;
  use: "broll" | "music" | "sound_effect";
  provider?: "pexels" | "openverse";
  orientation?: "landscape" | "portrait" | "square";
  limit: number;
};

type ImportInput = {
  provider: "pexels" | "openverse";
  providerAssetId: string;
  use: "broll" | "music" | "sound_effect";
};

export type ResolvedLibraryAsset = {
  bytes: Uint8Array;
  filename: string;
  kind: "video" | "audio";
  receipt: MediaLicenseReceipt;
  result: MediaLibraryResult;
};

const pexelsVideoFileSchema = z.object({
  id: z.number(),
  file_type: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  link: z.string().url(),
});

const pexelsVideoSchema = z.object({
  id: z.number(),
  duration: z.number().positive(),
  image: z.string().url(),
  url: z.string().url(),
  width: z.number().positive(),
  height: z.number().positive(),
  user: z.object({ name: z.string().min(1) }),
  video_files: z.array(pexelsVideoFileSchema).min(1),
});

const pexelsSearchSchema = z.object({
  videos: z.array(pexelsVideoSchema),
});

const openverseAudioSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable().optional(),
  creator: z.string().nullable().optional(),
  duration: z.number().positive().nullable().optional(),
  foreign_landing_url: z.string().url(),
  frontend_url: z.string().url().nullable().optional(),
  license: z.string().min(1),
  license_url: z.string().url().nullable().optional(),
  thumbnail: z.string().url().nullable().optional(),
  url: z.string().url(),
});

const openverseSearchSchema = z.object({
  results: z.array(openverseAudioSchema),
});

const jsonRequest = async (url: URL, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`media_provider_${String(response.status)}`);
  return response.json();
};

const extensionFor = (
  url: URL,
  contentType: string | null,
  kind: "video" | "audio",
) => {
  const extension = extname(url.pathname).toLowerCase();
  if (
    [
      ".mp4",
      ".mov",
      ".webm",
      ".mp3",
      ".m4a",
      ".aac",
      ".wav",
      ".ogg",
      ".flac",
    ].includes(extension)
  ) {
    return extension;
  }
  const byMime: Record<string, string> = {
    "audio/aac": ".aac",
    "audio/flac": ".flac",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
  };
  return (
    byMime[contentType?.split(";")[0]?.trim() ?? ""] ??
    (kind === "video" ? ".mp4" : ".mp3")
  );
};

const assertRemoteMediaUrl = (value: string): URL => {
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error("media_download_requires_https");
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname === "::1"
  ) {
    throw new Error("media_download_host_not_allowed");
  }
  return url;
};

const download = async (value: string, kind: "video" | "audio") => {
  const url = assertRemoteMediaUrl(value);
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`media_download_${String(response.status)}`);
  assertRemoteMediaUrl(response.url);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error("media_download_too_large");
  }
  if (!response.body) throw new Error("empty_media_file");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    byteLength += chunk.byteLength;
    if (byteLength > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new Error("media_download_too_large");
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes.byteLength === 0) throw new Error("empty_media_file");
  return {
    bytes,
    extension: extensionFor(url, response.headers.get("content-type"), kind),
  };
};

const pexelsResult = (
  video: z.infer<typeof pexelsVideoSchema>,
): MediaLibraryResult =>
  mediaLibraryResultSchema.parse({
    provider: "pexels",
    provider_asset_id: String(video.id),
    kind: "video",
    use: "broll",
    title: `Video by ${video.user.name}`,
    preview_url: video.image,
    source_url: video.url,
    duration_seconds: video.duration,
    width: video.width,
    height: video.height,
    creator: video.user.name,
    license: "Pexels License",
    license_url: "https://www.pexels.com/license/",
    attribution: `Video by ${video.user.name} on Pexels`,
  });

const commercialOpenverseLicenses = new Set(["by", "by-sa", "cc0", "pdm"]);

const openverseResult = (
  audio: z.infer<typeof openverseAudioSchema>,
  use: "music" | "sound_effect",
): MediaLibraryResult | null => {
  const license = audio.license.toLowerCase();
  if (!commercialOpenverseLicenses.has(license)) return null;
  return mediaLibraryResultSchema.parse({
    provider: "openverse",
    provider_asset_id: audio.id,
    kind: "audio",
    use,
    title: audio.title?.trim() || "Untitled audio",
    preview_url: audio.url,
    source_url: audio.foreign_landing_url,
    // Openverse returns audio duration in milliseconds. Normalize once at the
    // provider boundary so contracts, Studio, and timeline math use seconds.
    duration_seconds:
      audio.duration === null || audio.duration === undefined
        ? null
        : audio.duration / 1_000,
    width: null,
    height: null,
    creator: audio.creator?.trim() || null,
    license: license.toUpperCase(),
    license_url: audio.license_url ?? null,
    attribution: audio.creator
      ? `${audio.title?.trim() || "Audio"} by ${audio.creator}`
      : null,
  });
};

export class MediaLibraryProvider {
  constructor(private readonly config: GreenlightConfig["mediaLibrary"]) {}

  describe() {
    return {
      pexels: { available: Boolean(this.config.pexelsApiKey), use: "broll" },
      openverse: { available: true, use: "music_and_sound_effects" },
    } as const;
  }

  async search(input: SearchInput): Promise<MediaLibraryResult[]> {
    const provider =
      input.provider ?? (input.use === "broll" ? "pexels" : "openverse");
    if (provider === "pexels") {
      if (input.use !== "broll") throw new Error("pexels_video_only");
      if (!this.config.pexelsApiKey) throw new Error("pexels_not_configured");
      const url = new URL("https://api.pexels.com/videos/search");
      url.searchParams.set("query", input.query);
      url.searchParams.set("per_page", String(input.limit));
      if (input.orientation)
        url.searchParams.set("orientation", input.orientation);
      const body = pexelsSearchSchema.parse(
        await jsonRequest(url, {
          headers: { Authorization: this.config.pexelsApiKey },
        }),
      );
      return body.videos.map(pexelsResult);
    }

    if (input.use === "broll") throw new Error("openverse_audio_only");
    const audioUse = input.use;
    const url = new URL("https://api.openverse.org/v1/audio/");
    url.searchParams.set("q", input.query);
    url.searchParams.set("page_size", String(input.limit));
    url.searchParams.set("license_type", "commercial");
    url.searchParams.set("mature", "false");
    const body = openverseSearchSchema.parse(await jsonRequest(url));
    return body.results
      .map((audio) => openverseResult(audio, audioUse))
      .filter((result): result is MediaLibraryResult => result !== null)
      .slice(0, input.limit);
  }

  async resolve(input: ImportInput): Promise<ResolvedLibraryAsset> {
    if (input.provider === "pexels") {
      if (input.use !== "broll") throw new Error("pexels_video_only");
      if (!this.config.pexelsApiKey) throw new Error("pexels_not_configured");
      const body = pexelsVideoSchema.parse(
        await jsonRequest(
          new URL(
            `https://api.pexels.com/videos/videos/${encodeURIComponent(input.providerAssetId)}`,
          ),
          { headers: { Authorization: this.config.pexelsApiKey } },
        ),
      );
      const result = pexelsResult(body);
      const candidates = body.video_files
        .filter((file) => file.file_type === "video/mp4")
        .sort((left, right) => (right.width ?? 0) - (left.width ?? 0));
      const selected =
        candidates.find((file) => (file.width ?? 0) <= 1920) ??
        candidates.at(-1);
      if (!selected) throw new Error("pexels_video_file_unavailable");
      const media = await download(selected.link, "video");
      const receipt = mediaLicenseReceiptSchema.parse({
        provider: "pexels",
        provider_asset_id: result.provider_asset_id,
        source_url: result.source_url,
        creator: result.creator,
        license: result.license,
        license_url: result.license_url,
        attribution: result.attribution,
        commercial_use: true,
        verified_at: new Date().toISOString(),
      });
      return {
        bytes: media.bytes,
        filename: `pexels-${result.provider_asset_id}${media.extension}`,
        kind: "video",
        receipt,
        result,
      };
    }

    if (input.use === "broll") throw new Error("openverse_audio_only");
    const audioUse = input.use;
    const body = openverseAudioSchema.parse(
      await jsonRequest(
        new URL(
          `https://api.openverse.org/v1/audio/${encodeURIComponent(input.providerAssetId)}/`,
        ),
      ),
    );
    const result = openverseResult(body, audioUse);
    if (!result) throw new Error("openverse_license_not_commercial");
    const media = await download(body.url, "audio");
    const receipt = mediaLicenseReceiptSchema.parse({
      provider: "openverse",
      provider_asset_id: result.provider_asset_id,
      source_url: result.source_url,
      creator: result.creator,
      license: result.license,
      license_url: result.license_url,
      attribution: result.attribution,
      commercial_use: true,
      verified_at: new Date().toISOString(),
    });
    return {
      bytes: media.bytes,
      filename: `openverse-${result.provider_asset_id}${media.extension}`,
      kind: "audio",
      receipt,
      result,
    };
  }
}
