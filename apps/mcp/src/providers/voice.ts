import { sha256 } from "../lib/canonical.js";

export type VoiceRequest = {
  script: string;
  locale?: string;
  voiceId?: string;
};

export type VoiceResult = {
  bytes: Uint8Array;
  durationSeconds: number;
  extension: ".wav";
  generation: {
    model: string;
    provider: string;
    providerReportedCost: { amount: number; currency: string } | null;
    runtime: string;
    scriptSha256: string;
    voiceId: string;
  };
  provenance: Record<string, unknown>;
};

export type VoiceOption = {
  id: string;
  character: string;
};

export const GEMINI_VOICES = [
  { id: "Zephyr", character: "Bright" },
  { id: "Puck", character: "Upbeat" },
  { id: "Charon", character: "Informative" },
  { id: "Kore", character: "Firm" },
  { id: "Fenrir", character: "Excitable" },
  { id: "Leda", character: "Youthful" },
  { id: "Orus", character: "Firm" },
  { id: "Aoede", character: "Breezy" },
  { id: "Callirrhoe", character: "Easy-going" },
  { id: "Autonoe", character: "Bright" },
  { id: "Enceladus", character: "Breathy" },
  { id: "Iapetus", character: "Clear" },
  { id: "Umbriel", character: "Easy-going" },
  { id: "Algieba", character: "Smooth" },
  { id: "Despina", character: "Smooth" },
  { id: "Erinome", character: "Clear" },
  { id: "Algenib", character: "Gravelly" },
  { id: "Rasalgethi", character: "Informative" },
  { id: "Laomedeia", character: "Upbeat" },
  { id: "Achernar", character: "Soft" },
  { id: "Alnilam", character: "Firm" },
  { id: "Schedar", character: "Even" },
  { id: "Gacrux", character: "Mature" },
  { id: "Pulcherrima", character: "Forward" },
  { id: "Achird", character: "Friendly" },
  { id: "Zubenelgenubi", character: "Casual" },
  { id: "Vindemiatrix", character: "Gentle" },
  { id: "Sadachbia", character: "Lively" },
  { id: "Sadaltager", character: "Knowledgeable" },
  { id: "Sulafat", character: "Warm" },
] as const satisfies readonly VoiceOption[];

export interface VoiceProvider {
  describe(): {
    available: boolean;
    model: string | null;
    provider: string;
    supports_locale_auto_detection: boolean;
    supports_voice_override: boolean;
    voice_id: string | null;
    voices: readonly VoiceOption[];
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
      supports_locale_auto_detection: true,
      supports_voice_override: true,
      voice_id: this.config.voiceId,
      voices: GEMINI_VOICES,
    };
  }

  async generate({
    locale,
    script,
    voiceId,
  }: VoiceRequest): Promise<VoiceResult> {
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
          voice: voiceId ?? this.config.voiceId,
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
      generation: {
        provider: "openrouter",
        model: this.config.model,
        runtime: "openrouter_audio_speech",
        scriptSha256: sha256(script),
        voiceId: voiceId ?? this.config.voiceId,
        providerReportedCost: null,
      },
      provenance: {
        provider: "openrouter",
        model: this.config.model,
        locale: locale ?? null,
        voice_id: voiceId ?? this.config.voiceId,
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
      supports_locale_auto_detection: false,
      supports_voice_override: false,
      voice_id: null,
      voices: [],
    };
  }

  async generate(): Promise<never> {
    throw new Error("voice_provider_disabled");
  }
}

export class TestVoiceProvider implements VoiceProvider {
  describe() {
    return {
      available: true,
      model: "deterministic-pcm",
      provider: "test",
      supports_locale_auto_detection: false,
      supports_voice_override: true,
      voice_id: "fixture",
      voices: [{ id: "fixture", character: "Test" }],
    };
  }

  async generate({
    locale,
    script,
    voiceId,
  }: VoiceRequest): Promise<VoiceResult> {
    const durationSeconds = 0.1;
    const pcm = new Uint8Array(24_000 * 2 * durationSeconds);
    return {
      bytes: pcm16MonoToWav(pcm),
      durationSeconds,
      extension: ".wav",
      generation: {
        provider: "test",
        model: "deterministic-pcm",
        runtime: "deterministic_test_adapter",
        scriptSha256: sha256(script),
        voiceId: voiceId ?? "fixture",
        providerReportedCost: null,
      },
      provenance: {
        provider: "test",
        model: "deterministic-pcm",
        locale: locale ?? null,
        script_sha256: sha256(script),
        voice_id: voiceId ?? "fixture",
      },
    };
  }
}
