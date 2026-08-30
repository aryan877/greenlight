import type { ArtifactKind } from "@greenlight/contracts";

import { now, sha256 } from "../lib/canonical.js";
import type { ArtifactStore } from "../storage/artifacts.js";
import { probeImportedMedia } from "./media-metadata.js";

type OpenRouterImageResponse = {
  data?: Array<{
    b64_json?: string;
    media_type?: string;
    revised_prompt?: string | null;
  }>;
  model?: string;
  usage?: { cost?: number | string | null };
};

export type OpenRouterImageCapabilities = {
  available: boolean;
  connected: boolean;
  connection: "api_key" | null;
  model: string;
  provider: "openrouter";
  quality: "low";
  reason: "openrouter_api_key_missing" | null;
  runtime: "openrouter_images_api";
};

const imageExtension = (mediaType: string | undefined) => {
  if (mediaType === "image/webp") return ".webp";
  if (mediaType === "image/jpeg") return ".jpg";
  return ".png";
};

const reportedCost = (value: number | string | null | undefined) => {
  const cost = Number(value);
  return Number.isFinite(cost) && cost >= 0
    ? { amount: cost, currency: "USD" }
    : null;
};

export class OpenRouterImageProvider {
  constructor(
    private readonly config: {
      apiKey: string | null;
      model: string;
      upstreamBaseUrl: string;
    },
    private readonly artifacts: ArtifactStore,
    private readonly fetchImage: typeof fetch = fetch,
  ) {}

  describe(): OpenRouterImageCapabilities {
    const connected = Boolean(this.config.apiKey);
    return {
      available: connected,
      connected,
      connection: connected ? "api_key" : null,
      model: this.config.model,
      provider: "openrouter",
      quality: "low",
      reason: connected ? null : "openrouter_api_key_missing",
      runtime: "openrouter_images_api",
    };
  }

  async generate(input: {
    aspectRatio: "16:9" | "1:1" | "9:16";
    kind: ArtifactKind;
    projectId: string;
    prompt: string;
    sceneId: string | null;
  }) {
    if (!this.config.apiKey) throw new Error("openrouter_api_key_missing");

    const response = await this.fetchImage(
      `${this.config.upstreamBaseUrl}/images`,
      {
        body: JSON.stringify({
          aspect_ratio: input.aspectRatio,
          background: "opaque",
          model: this.config.model,
          n: 1,
          prompt: input.prompt,
          quality: "low",
        }),
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          "x-title": "Greenlight",
        },
        method: "POST",
      },
    );
    if (!response.ok) {
      throw new Error(`openrouter_image_request_failed:${response.status}`);
    }

    const result = (await response.json()) as OpenRouterImageResponse;
    const generated = result.data?.[0];
    if (!generated?.b64_json) {
      throw new Error("openrouter_image_missing_data");
    }

    const extension = imageExtension(generated.media_type);
    const bytes = Buffer.from(generated.b64_json, "base64");
    const measured = await probeImportedMedia(extension, bytes);
    if (!measured?.width || !measured.height) {
      throw new Error("generated_image_dimensions_unavailable");
    }

    const promptHash = sha256(input.prompt);
    const model = result.model?.trim() || this.config.model;
    return this.artifacts.importBuffer({
      projectId: input.projectId,
      kind: input.kind,
      filename: `openrouter-image${extension}`,
      bytes,
      generation: {
        media_type: "image",
        provider: "openrouter",
        model,
        runtime: "openrouter_images_api",
        input_hashes: [promptHash],
        prompt_sha256: promptHash,
        width: measured.width,
        height: measured.height,
        generated_at: now(),
        provider_reported_cost: reportedCost(result.usage?.cost),
        disclosure: {
          contains_synthetic_media: true,
          method: "generated",
        },
      },
      provenance: {
        provider: "openrouter",
        runtime: "openrouter_images_api",
        model,
        quality: "low",
        prompt_sha256: promptHash,
        revised_prompt: generated.revised_prompt ?? null,
        aspect_ratio: input.aspectRatio,
        scene_id: input.sceneId,
      },
    });
  }
}
