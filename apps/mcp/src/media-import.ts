import { extname } from "node:path";

import type { ArtifactKind } from "@greenlight/contracts";

type ImportMedia = {
  extension: string;
  kind: Extract<ArtifactKind, "image" | "narration" | "video" | "caption">;
  mimeType: string;
};

const supported: Record<string, Omit<ImportMedia, "extension">> = {
  ".aac": { kind: "narration", mimeType: "audio/aac" },
  ".jpeg": { kind: "image", mimeType: "image/jpeg" },
  ".jpg": { kind: "image", mimeType: "image/jpeg" },
  ".m4a": { kind: "narration", mimeType: "audio/mp4" },
  ".mov": { kind: "video", mimeType: "video/quicktime" },
  ".mp3": { kind: "narration", mimeType: "audio/mpeg" },
  ".mp4": { kind: "video", mimeType: "video/mp4" },
  ".png": { kind: "image", mimeType: "image/png" },
  ".srt": { kind: "caption", mimeType: "application/x-subrip" },
  ".vtt": { kind: "caption", mimeType: "text/vtt" },
  ".wav": { kind: "narration", mimeType: "audio/wav" },
  ".webm": { kind: "video", mimeType: "video/webm" },
  ".webp": { kind: "image", mimeType: "image/webp" },
};

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((value, index) => bytes[offset + index] === value);

const looksLikeText = (bytes: Uint8Array) => {
  const sample = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 2048))
    .replace(/^\uFEFF/, "");
  return /^(WEBVTT|\d+\s*\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3})/m.test(sample);
};

const matchesContainer = (extension: string, bytes: Uint8Array) => {
  switch (extension) {
    case ".png":
      return startsWith(
        bytes,
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      );
    case ".jpg":
    case ".jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case ".webp":
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case ".wav":
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes, [0x57, 0x41, 0x56, 0x45], 8)
      );
    case ".mp3":
      return (
        startsWith(bytes, [0x49, 0x44, 0x33]) ||
        (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)
      );
    case ".aac":
      return bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0;
    case ".mp4":
    case ".mov":
    case ".m4a":
      return startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4);
    case ".webm":
      return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    case ".vtt":
    case ".srt":
      return looksLikeText(bytes);
    default:
      return false;
  }
};

export const inspectImportedMedia = (
  filename: string,
  bytes: Uint8Array,
): ImportMedia => {
  const extension = extname(filename).toLowerCase();
  const media = supported[extension];
  if (!media) throw new Error("unsupported_media_type");
  if (bytes.byteLength === 0) throw new Error("empty_media_file");
  if (!matchesContainer(extension, bytes)) {
    throw new Error("media_content_mismatch");
  }
  return { ...media, extension };
};

export const importAccept = Object.keys(supported).join(",");
