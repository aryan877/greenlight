import { describe, expect, it } from "vitest";

import {
  GEMINI_VOICES,
  OpenRouterVoiceProvider,
  TestVoiceProvider,
  pcm16MonoToWav,
} from "../src/providers/voice.js";

describe("voice provider", () => {
  it("exposes the official Gemini voice catalog through one provider", () => {
    const provider = new OpenRouterVoiceProvider({
      apiKey: "test",
      model: "google/gemini-3.1-flash-tts-preview",
      voiceId: "Kore",
    });

    expect(provider.describe()).toMatchObject({
      provider: "openrouter",
      voice_id: "Kore",
      voices: expect.arrayContaining([
        { id: "Kore", character: "Firm" },
        { id: "Puck", character: "Upbeat" },
      ]),
    });
    expect(GEMINI_VOICES).toHaveLength(30);
  });

  it("wraps 24 kHz mono PCM in a valid WAV header", () => {
    const wav = pcm16MonoToWav(Uint8Array.from([0, 0, 1, 0]));
    const view = Buffer.from(wav);
    expect(view.subarray(0, 4).toString()).toBe("RIFF");
    expect(view.subarray(8, 12).toString()).toBe("WAVE");
    expect(view.readUInt32LE(24)).toBe(24_000);
    expect(view.readUInt32LE(40)).toBe(4);
  });

  it("uses the configured OpenRouter model without pricing logic", async () => {
    let body: Record<string, unknown> | null = null;
    const provider = new OpenRouterVoiceProvider(
      { apiKey: "test", model: "provider/model", voiceId: "Kore" },
      async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(Uint8Array.from([0, 0]), {
          status: 200,
          headers: { "content-type": "audio/pcm" },
        });
      },
    );
    const result = await provider.generate({
      locale: "hi-IN",
      script: "A short line.",
      voiceId: "Puck",
    });
    expect(body).toMatchObject({
      model: "provider/model",
      voice: "Puck",
      response_format: "pcm",
    });
    expect(result.provenance).toMatchObject({
      provider: "openrouter",
      model: "provider/model",
      locale: "hi-IN",
      voice_id: "Puck",
    });
  });

  it("offers a deterministic offline adapter only for tests", async () => {
    const provider = new TestVoiceProvider();
    const first = await provider.generate({ script: "Same line." });
    const second = await provider.generate({ script: "Same line." });

    expect(first.bytes).toEqual(second.bytes);
    expect(first.provenance).toEqual(second.provenance);
    expect(provider.describe().provider).toBe("test");
  });
});
