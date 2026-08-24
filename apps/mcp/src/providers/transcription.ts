import { readFile } from "node:fs/promises";

import type { TranscriptWord } from "@greenlight/contracts";

type TimedWord = {
  word?: unknown;
  start?: unknown;
  end?: unknown;
};

export type TranscriptionResult = {
  referenceText: string;
  timedText: string;
  words: TranscriptWord[];
  provenance: {
    name: "openai";
    transcription_model: string;
    timing_model: string;
  };
};

export interface TranscriptionProvider {
  describe(): {
    available: boolean;
    provider: string;
    transcription_model: string | null;
    timing_model: string | null;
  };
  transcribe(input: {
    absolutePath: string;
    filename: string;
    mimeType: string;
    locale: string;
    prompt: string | null;
  }): Promise<TranscriptionResult>;
}

const parseJson = async (response: Response, label: string) => {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = JSON.stringify(body ?? {}).slice(0, 240);
    throw new Error(`${label}_error:${response.status}:${detail}`);
  }
  return body as Record<string, unknown>;
};

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  constructor(
    private readonly config: {
      apiKey: string | null;
      transcriptionModel: string;
      timingModel: string;
    },
    private readonly request: typeof fetch = fetch,
  ) {}

  describe() {
    return {
      available: Boolean(this.config.apiKey),
      provider: "openai",
      transcription_model: this.config.transcriptionModel,
      timing_model: this.config.timingModel,
    };
  }

  private form(input: {
    bytes: Uint8Array;
    filename: string;
    mimeType: string;
    locale: string;
    prompt: string | null;
    model: string;
    timed: boolean;
  }) {
    const form = new FormData();
    form.set(
      "file",
      new Blob([Uint8Array.from(input.bytes).buffer], { type: input.mimeType }),
      input.filename,
    );
    form.set("model", input.model);
    form.set("language", input.locale);
    if (input.prompt) form.set("prompt", input.prompt);
    form.set("response_format", input.timed ? "verbose_json" : "json");
    if (input.timed) form.append("timestamp_granularities[]", "word");
    return form;
  }

  async transcribe(input: {
    absolutePath: string;
    filename: string;
    mimeType: string;
    locale: string;
    prompt: string | null;
  }): Promise<TranscriptionResult> {
    if (!this.config.apiKey) {
      throw new Error("transcription_provider_not_configured");
    }
    const bytes = await readFile(input.absolutePath);
    const headers = { authorization: `Bearer ${this.config.apiKey}` };
    const endpoint = "https://api.openai.com/v1/audio/transcriptions";
    const [referenceResponse, timingResponse] = await Promise.all([
      this.request(endpoint, {
        method: "POST",
        headers,
        body: this.form({
          ...input,
          bytes,
          model: this.config.transcriptionModel,
          timed: false,
        }),
      }),
      this.request(endpoint, {
        method: "POST",
        headers,
        body: this.form({
          ...input,
          bytes,
          model: this.config.timingModel,
          timed: true,
        }),
      }),
    ]);
    const [reference, timing] = await Promise.all([
      parseJson(referenceResponse, "transcription"),
      parseJson(timingResponse, "transcript_timing"),
    ]);
    const referenceText = String(reference.text ?? "").trim();
    const rawWords = Array.isArray(timing.words)
      ? (timing.words as TimedWord[])
      : [];
    const words = rawWords.flatMap((word, index) => {
      const text = String(word.word ?? "").trim();
      const start = Number(word.start);
      const end = Number(word.end);
      return text &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start
        ? [{ index, text, start_seconds: start, end_seconds: end }]
        : [];
    });
    if (!referenceText) throw new Error("transcription_text_missing");
    if (words.length === 0) throw new Error("transcript_word_timing_missing");
    return {
      referenceText,
      timedText: words.map((word) => word.text).join(" "),
      words,
      provenance: {
        name: "openai",
        transcription_model: this.config.transcriptionModel,
        timing_model: this.config.timingModel,
      },
    };
  }
}

export class DisabledTranscriptionProvider implements TranscriptionProvider {
  describe() {
    return {
      available: false,
      provider: "disabled",
      transcription_model: null,
      timing_model: null,
    };
  }

  async transcribe(): Promise<never> {
    throw new Error("transcription_provider_disabled");
  }
}

const comparable = (value: string) =>
  value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export const findSpokenPhrase = (words: TranscriptWord[], phrase: string) => {
  const target = phrase.split(/\s+/).map(comparable).filter(Boolean);
  if (target.length === 0) throw new Error("empty_spoken_phrase");
  const source = words.map((word) => comparable(word.text));
  for (let start = 0; start <= source.length - target.length; start += 1) {
    if (target.every((word, offset) => source[start + offset] === word)) {
      const first = words[start]!;
      const last = words[start + target.length - 1]!;
      return {
        start_seconds: first.start_seconds,
        end_seconds: last.end_seconds,
        start_word_index: first.index,
        end_word_index: last.index,
        matched_text: words
          .slice(start, start + target.length)
          .map((word) => word.text)
          .join(" "),
      };
    }
  }
  throw new Error("spoken_phrase_not_found");
};
