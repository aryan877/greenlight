import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

type ProbeDocument = {
  format?: { duration?: string };
  streams?: Array<{
    codec_name?: string;
    codec_type?: string;
    height?: number;
    width?: number;
  }>;
};

export type MediaMetadata = {
  audio_codec?: string;
  duration_seconds?: number;
  height?: number;
  video_codec?: string;
  width?: number;
};

export const parseMediaMetadata = (document: ProbeDocument): MediaMetadata => {
  const video = document.streams?.find(
    (stream) => stream.codec_type === "video",
  );
  const audio = document.streams?.find(
    (stream) => stream.codec_type === "audio",
  );
  const duration = Number(document.format?.duration);
  return {
    ...(Number.isFinite(duration) && duration > 0
      ? { duration_seconds: Math.round(duration * 1000) / 1000 }
      : {}),
    ...(video?.width ? { width: video.width } : {}),
    ...(video?.height ? { height: video.height } : {}),
    ...(video?.codec_name ? { video_codec: video.codec_name } : {}),
    ...(audio?.codec_name ? { audio_codec: audio.codec_name } : {}),
  };
};

export const probeImportedMedia = async (
  extension: string,
  bytes: Uint8Array,
): Promise<MediaMetadata | null> => {
  const directory = await mkdtemp(join(tmpdir(), "greenlight-media-"));
  const path = join(directory, `asset${extension}`);
  try {
    await writeFile(path, bytes);
    const { stdout } = await execFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name,width,height",
        "-of",
        "json",
        path,
      ],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    return parseMediaMetadata(JSON.parse(stdout) as ProbeDocument);
  } catch {
    return null;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
