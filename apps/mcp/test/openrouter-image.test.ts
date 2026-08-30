import { describe, expect, it, vi } from "vitest";

import type { ArtifactStore } from "../src/storage/artifacts.js";
import { OpenRouterImageProvider } from "../src/providers/openrouter-image.js";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("OpenRouter image provider", () => {
  it("reports the fixed GPT Image 2 low-quality capability", () => {
    const provider = new OpenRouterImageProvider(
      {
        apiKey: "test-key",
        model: "openai/gpt-image-2",
        upstreamBaseUrl: "https://openrouter.test/api/v1",
      },
      {} as ArtifactStore,
    );

    expect(provider.describe()).toMatchObject({
      available: true,
      connected: true,
      model: "openai/gpt-image-2",
      provider: "openrouter",
      quality: "low",
    });
  });

  it("fails without an OpenRouter key", async () => {
    const provider = new OpenRouterImageProvider(
      {
        apiKey: null,
        model: "openai/gpt-image-2",
        upstreamBaseUrl: "https://openrouter.test/api/v1",
      },
      {} as ArtifactStore,
    );

    await expect(
      provider.generate({
        aspectRatio: "16:9",
        kind: "thumbnail",
        projectId: "project_test",
        prompt: "A clear editorial thumbnail with one strong subject",
        sceneId: null,
      }),
    ).rejects.toThrow("openrouter_api_key_missing");
  });

  it("sends the supported low-quality image request", async () => {
    const importBuffer = vi.fn(async (input: unknown) => input);
    const fetchImage = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            data: [{ b64_json: png }],
            model: "openai/gpt-image-2",
            usage: { cost: 0.011 },
          }),
          { status: 200 },
        ),
    );
    const provider = new OpenRouterImageProvider(
      {
        apiKey: "test-key",
        model: "openai/gpt-image-2",
        upstreamBaseUrl: "https://openrouter.test/api/v1",
      },
      { importBuffer } as unknown as ArtifactStore,
      fetchImage as unknown as typeof fetch,
    );

    await provider.generate({
      aspectRatio: "16:9",
      kind: "thumbnail",
      projectId: "project_test",
      prompt: "A clear editorial thumbnail with one strong subject",
      sceneId: null,
    });

    const request = JSON.parse(
      String((fetchImage.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as Record<string, unknown>;
    expect(fetchImage).toHaveBeenCalledWith(
      "https://openrouter.test/api/v1/images",
      expect.any(Object),
    );
    expect(request).toMatchObject({
      aspect_ratio: "16:9",
      model: "openai/gpt-image-2",
      n: 1,
      quality: "low",
    });
    expect(importBuffer).toHaveBeenCalledOnce();
  });
});
