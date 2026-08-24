import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { YoutubeMetadata } from "@greenlight/contracts";

const runFile = promisify(execFile);

type ChannelIdentity = {
  channel_id: string;
  custom_url?: string | null;
  profile: string;
  title: string;
};

type UploadResult = {
  studio_url: string;
  url: string;
  video_id: string;
};

type UpdateResult = UploadResult & {
  privacy: string;
  title?: string | null;
};

export const parseTrailingJson = <T>(stdout: string): T => {
  const trimmed = stdout.trim();
  const start = trimmed.startsWith("{") ? 0 : trimmed.lastIndexOf("\n{") + 1;
  if (start < 0 || !trimmed.slice(start).startsWith("{")) {
    throw new Error("youtube_uploader_missing_json");
  }
  return JSON.parse(trimmed.slice(start)) as T;
};

export class YouTubeUploader {
  constructor(
    private readonly config: {
      allowedChannelId: string | null;
      profile: string;
      uploaderPath: string;
    },
    private readonly execute: typeof runFile = runFile,
  ) {}

  async identity(): Promise<ChannelIdentity> {
    const result = await this.run<ChannelIdentity>([
      "whoami",
      "--profile",
      this.config.profile,
    ]);
    if (!result.channel_id) throw new Error("youtube_channel_missing");
    if (
      this.config.allowedChannelId &&
      result.channel_id !== this.config.allowedChannelId
    ) {
      throw new Error("youtube_channel_not_allowed");
    }
    return result;
  }

  async uploadUnlisted(input: {
    metadata: YoutubeMetadata;
    thumbnailPath: string | null;
    videoPath: string;
  }): Promise<UploadResult & { channel: ChannelIdentity }> {
    const channel = await this.identity();
    const args = [
      "upload",
      input.videoPath,
      "--profile",
      this.config.profile,
      "--title",
      input.metadata.title,
      "--description",
      input.metadata.description,
      "--privacy",
      "unlisted",
      "--tags",
      input.metadata.tags.join(","),
      "--category",
      input.metadata.category_id,
      "--made-for-kids",
      String(input.metadata.made_for_kids),
      "--synthetic-media",
      String(input.metadata.contains_synthetic_media),
      "--no-notify-subscribers",
    ];
    if (input.thumbnailPath) args.push("--thumbnail", input.thumbnailPath);
    const upload = await this.run<UploadResult>(args, 30 * 60_000);
    return { ...upload, channel };
  }

  async publish(videoId: string): Promise<UpdateResult> {
    await this.identity();
    return this.run<UpdateResult>([
      "update",
      videoId,
      "--profile",
      this.config.profile,
      "--privacy",
      "public",
    ]);
  }

  async schedule(videoId: string, publishAt: string): Promise<UpdateResult> {
    await this.identity();
    return this.run<UpdateResult>([
      "update",
      videoId,
      "--profile",
      this.config.profile,
      "--privacy",
      "private",
      "--publish-at",
      publishAt,
    ]);
  }

  private async run<T>(args: string[], timeout = 120_000): Promise<T> {
    try {
      const { stdout } = await this.execute(this.config.uploaderPath, args, {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout,
      });
      return parseTrailingJson<T>(stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      throw new Error(`youtube_uploader_failed:${message.slice(0, 300)}`);
    }
  }
}
