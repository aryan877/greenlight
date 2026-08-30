import { execFile } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
] as const;

const safeReturnPath = (value: string) => {
  if (value === "/" || /^\/projects\/[A-Za-z0-9_-]{3,100}$/u.test(value)) {
    return value;
  }
  throw new Error("invalid_youtube_return_path");
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
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
      oauthClientId: string | null;
      oauthClientSecret: string | null;
      oauthRedirectUri: string;
      profile: string;
      stateSecret: string;
      tokenPath: string;
      uploaderPath: string;
    },
    private readonly execute: typeof runFile = runFile,
    private readonly exchangeToken: typeof fetch = fetch,
  ) {}

  canConnect() {
    return Boolean(this.config.oauthClientId && this.config.oauthClientSecret);
  }

  connectionUrl(returnPath = "/") {
    if (!this.config.oauthClientId || !this.config.oauthClientSecret) {
      throw new Error("youtube_oauth_not_configured");
    }
    const payload = Buffer.from(
      JSON.stringify({
        expires_at: Date.now() + 10 * 60_000,
        return_path: safeReturnPath(returnPath),
      }),
    ).toString("base64url");
    const signature = createHmac("sha256", this.config.stateSecret)
      .update(payload)
      .digest("base64url");
    const query = new URLSearchParams({
      access_type: "offline",
      client_id: this.config.oauthClientId,
      include_granted_scopes: "true",
      prompt: "consent select_account",
      redirect_uri: this.config.oauthRedirectUri,
      response_type: "code",
      scope: YOUTUBE_SCOPES.join(" "),
      state: `${payload}.${signature}`,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
  }

  async completeConnection(code: string, state: string): Promise<string> {
    if (!this.config.oauthClientId || !this.config.oauthClientSecret) {
      throw new Error("youtube_oauth_not_configured");
    }
    const [payload, signature, extra] = state.split(".");
    if (!payload || !signature || extra) throw new Error("invalid_oauth_state");
    const expected = createHmac("sha256", this.config.stateSecret)
      .update(payload)
      .digest("base64url");
    const receivedBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (
      receivedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(receivedBytes, expectedBytes)
    ) {
      throw new Error("invalid_oauth_state");
    }
    const parsedState = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as { expires_at?: unknown; return_path?: unknown };
    const expiresAt = Number(parsedState.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error("expired_oauth_state");
    }
    const returnPath = safeReturnPath(String(parsedState.return_path ?? "/"));

    const tokenResponse = await this.exchangeToken(
      "https://oauth2.googleapis.com/token",
      {
        body: new URLSearchParams({
          client_id: this.config.oauthClientId,
          client_secret: this.config.oauthClientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: this.config.oauthRedirectUri,
        }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      },
    );
    if (!tokenResponse.ok) {
      throw new Error(`youtube_oauth_exchange_failed:${tokenResponse.status}`);
    }
    const token = (await tokenResponse.json()) as GoogleTokenResponse;
    if (!token.access_token || !token.refresh_token || !token.expires_in) {
      throw new Error("youtube_oauth_token_incomplete");
    }
    const scopes = token.scope?.split(" ").filter(Boolean) ?? [
      ...YOUTUBE_SCOPES,
    ];
    await mkdir(dirname(this.config.tokenPath), { recursive: true });
    await writeFile(
      this.config.tokenPath,
      JSON.stringify({
        token: token.access_token,
        refresh_token: token.refresh_token,
        token_uri: "https://oauth2.googleapis.com/token",
        client_id: this.config.oauthClientId,
        client_secret: this.config.oauthClientSecret,
        scopes,
        expiry: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      }),
      { encoding: "utf8", mode: 0o600 },
    );
    await chmod(this.config.tokenPath, 0o600);
    return returnPath;
  }

  async identity(): Promise<ChannelIdentity> {
    const result = await this.run<ChannelIdentity>([
      "whoami",
      "--profile",
      this.config.profile,
    ]);
    if (!result.channel_id) throw new Error("youtube_channel_missing");
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
