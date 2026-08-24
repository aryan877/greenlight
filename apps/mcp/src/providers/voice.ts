import { sha256 } from "../lib/canonical.js";

export type VoiceRequest = {
  script: string;
};

export type VoiceResult = {
  bytes: Uint8Array;
  durationSeconds: number;
  extension: ".wav";
  provenance: Record<string, unknown>;
};

export interface VoiceProvider {
  describe(): {
    available: boolean;
    model: string | null;
    provider: string;
    voice_id: string | null;
  };
  generate(input: VoiceRequest): Promise<VoiceResult>;
}

export const pcm16MonoToWav = (
  pcm: Uint8Array,
  sampleRate = 24_000,
): Uint8Array => {
  if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) {
    throw new Error("invalid_pcm_payload");
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
};

export class OpenRouterVoiceProvider implements VoiceProvider {
  constructor(
    private readonly config: {
      apiKey: string | null;
      model: string;
      voiceId: string;
    },
    private readonly request: typeof fetch = fetch,
  ) {}

  describe() {
    return {
      available: Boolean(this.config.apiKey),
      model: this.config.model,
      provider: "openrouter",
      voice_id: this.config.voiceId,
    };
  }

  async generate({ script }: VoiceRequest): Promise<VoiceResult> {
    if (!this.config.apiKey) throw new Error("voice_provider_not_configured");
    const response = await this.request(
      "https://openrouter.ai/api/v1/audio/speech",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          "x-title": "Greenlight",
        },
        body: JSON.stringify({
          model: this.config.model,
          input: script,
          voice: this.config.voiceId,
          response_format: "pcm",
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `voice_provider_error:${response.status}:${detail.slice(0, 240)}`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("audio/pcm")) {
      throw new Error(`unexpected_voice_content_type:${contentType}`);
    }
    const pcm = new Uint8Array(await response.arrayBuffer());
    const wav = pcm16MonoToWav(pcm);
    return {
      bytes: wav,
      durationSeconds: pcm.byteLength / (24_000 * 2),
      extension: ".wav",
      provenance: {
        provider: "openrouter",
        model: this.config.model,
        voice_id: this.config.voiceId,
        script_sha256: sha256(script),
        source_format: "pcm_s16le_24000_mono",
        output_format: "wav_pcm_s16le_24000_mono",
      },
    };
  }
}

export class DisabledVoiceProvider implements VoiceProvider {
  describe() {
    return {
      available: false,
      model: null,
      provider: "disabled",
      voice_id: null,
    };
  }

  async generate(): Promise<never> {
    throw new Error("voice_provider_disabled");
  }
}
