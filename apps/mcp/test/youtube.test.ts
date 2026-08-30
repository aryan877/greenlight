import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  parseTrailingJson,
  YouTubeUploader,
} from "../src/providers/youtube.js";

const createUploader = (
  tokenPath: string,
  exchangeToken: typeof fetch = fetch,
  execute?: ConstructorParameters<typeof YouTubeUploader>[1],
) =>
  new YouTubeUploader(
    {
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
      oauthRedirectUri: "https://studio.example/youtube/callback",
      profile: "main",
      stateSecret: "state-secret-with-enough-entropy",
      tokenPath,
      uploaderPath: "youtube-uploader",
    },
    execute,
    exchangeToken,
  );

describe("YouTube uploader output", () => {
  it("parses JSON after resumable upload progress", () => {
    expect(
      parseTrailingJson<{ video_id: string }>(
        'Upload progress: 50%\nUpload progress: 100%\n{\n  "video_id": "abc123"\n}\n',
      ),
    ).toEqual({ video_id: "abc123" });
  });

  it("creates a signed Google consent URL", () => {
    const url = new URL(
      createUploader("unused.json").connectionUrl("/projects/project_demo"),
    );

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://studio.example/youtube/callback",
    );
    expect(url.searchParams.get("state")).toMatch(/^[^.]+\.[^.]+$/);
    expect(url.searchParams.get("scope")).toContain("youtube.upload");
  });

  it("exchanges a valid callback and stores a private refreshable token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "greenlight-youtube-"));
    const tokenPath = join(directory, "tokens", "main.json");
    const exchangeToken = vi.fn(async () =>
      Response.json({
        access_token: "access-token",
        expires_in: 3600,
        refresh_token: "refresh-token",
        scope: "https://www.googleapis.com/auth/youtube.upload",
        token_type: "Bearer",
      }),
    );
    const uploader = createUploader(
      tokenPath,
      exchangeToken as unknown as typeof fetch,
    );
    const state = new URL(
      uploader.connectionUrl("/projects/project_demo"),
    ).searchParams.get("state");

    await expect(
      uploader.completeConnection("authorization-code", state ?? ""),
    ).resolves.toBe("/projects/project_demo");

    expect(exchangeToken).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(tokenPath, "utf8"))).toMatchObject({
      client_id: "client-id",
      refresh_token: "refresh-token",
      token: "access-token",
    });
    expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
  });

  it("reads back the privacy YouTube actually applied", async () => {
    const execute = vi.fn(async (_file: string, args: readonly string[]) => {
      const command = args[0];
      const payload =
        command === "whoami"
          ? {
              channel_id: "channel_demo",
              profile: "main",
              title: "Demo channel",
            }
          : command === "upload"
            ? {
                studio_url: "https://studio.youtube.com/video/video_demo/edit",
                url: "https://youtu.be/video_demo",
                video_id: "video_demo",
              }
            : {
                id: "video_demo",
                status: { privacyStatus: "private" },
              };
      return { stderr: "", stdout: JSON.stringify(payload) };
    });
    const uploader = createUploader(
      "unused.json",
      fetch,
      execute as unknown as ConstructorParameters<typeof YouTubeUploader>[1],
    );

    await expect(
      uploader.uploadUnlisted({
        metadata: {
          title: "A finished video",
          description: "A checked release candidate.",
          tags: ["greenlight"],
          category_id: "28",
          made_for_kids: false,
          contains_synthetic_media: true,
        },
        thumbnailPath: null,
        videoPath: "/managed/video.mp4",
      }),
    ).resolves.toMatchObject({
      privacy: "private",
      video_id: "video_demo",
    });

    expect(execute.mock.calls.map((call) => call[1][0])).toEqual([
      "whoami",
      "upload",
      "show",
    ]);
  });
});
