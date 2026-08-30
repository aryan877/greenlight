import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";

import type { TranscriptWord } from "@greenlight/contracts";

const execFileAsync = promisify(execFile);

type WhisperToken = {
  text?: unknown;
  offsets?: { from?: unknown; to?: unknown };
};

type WhisperOutput = {
  transcription?: Array<{
    text?: unknown;
    tokens?: WhisperToken[];
  }>;
};

type TimingResult = {
  text: string;
  words: TranscriptWord[];
};

type TimingRunner = (input: {
  absolutePath: string;
  binaryPath: string;
  locale: string;
  modelPath: string;
}) => Promise<TimingResult>;

export type TranscriptionResult = {
  referenceText: string;
  timedText: string;
  words: TranscriptWord[];
  provenance: {
    name: "openrouter+whisper.cpp";
    transcription_model: string;
    timing_model: string;
    usage_cost_usd: number | null;
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

const audioFormat = (filename: string, mimeType: string) => {
  const extension = extname(filename).slice(1).toLowerCase();
  if (extension) return extension === "mp4" ? "m4a" : extension;
  const subtype = mimeType.split("/")[1]?.split(";")[0];
  if (!subtype) throw new Error("transcription_audio_format_missing");
  return subtype === "mpeg" ? "mp3" : subtype;
};

const languageCode = (locale: string) =>
  locale.trim().split(/[-_]/)[0]?.toLowerCase() || "auto";

const isSpecialToken = (text: string) => /^\[_.*_\]$/.test(text);
const isWord = (text: string) => /[\p{L}\p{N}]/u.test(text);

export const parseWhisperWords = (output: WhisperOutput): TimingResult => {
  const words: TranscriptWord[] = [];
  for (const segment of output.transcription ?? []) {
    for (const token of segment.tokens ?? []) {
      const text = String(token.text ?? "").trim();
      const startMs = Number(token.offsets?.from);
      const endMs = Number(token.offsets?.to);
      if (
        !text ||
        isSpecialToken(text) ||
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        endMs <= startMs
      ) {
        continue;
      }
      if (!isWord(text)) {
        const previous = words.at(-1);
        if (previous) {
          previous.text += text;
          previous.end_seconds = endMs / 1_000;
        }
        continue;
      }
      words.push({
        index: words.length,
        text,
        start_seconds: startMs / 1_000,
        end_seconds: endMs / 1_000,
      });
    }
  }
  if (words.length === 0) throw new Error("transcript_word_timing_missing");
  return {
    text: words.map((word) => word.text).join(" "),
    words,
  };
};

const runWhisperCpp: TimingRunner = async (input) => {
  const directory = await mkdtemp(join(tmpdir(), "greenlight-whisper-"));
  const wavPath = join(directory, "audio.wav");
  const outputPath = join(directory, "timing");
  try {
    await execFileAsync("ffmpeg", [
      "-loglevel",
      "error",
      "-y",
      "-i",
      input.absolutePath,
      "-ar",
      "16000",
      "-ac",
      "1",
      wavPath,
    ]);
    await execFileAsync(input.binaryPath, [
      "-m",
      input.modelPath,
      "-f",
      wavPath,
      "-l",
      input.locale,
      "-ojf",
      "-np",
      "-of",
      outputPath,
    ]);
    const value = JSON.parse(
      await readFile(`${outputPath}.json`, "utf8"),
    ) as WhisperOutput;
    return parseWhisperWords(value);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
};

export class OpenRouterTranscriptionProvider implements TranscriptionProvider {
  constructor(
    private readonly config: {
      apiKey: string | null;
      transcriptionModel: string;
      timingBinaryPath: string;
      timingModelPath: string;
    },
    private readonly request: typeof fetch = fetch,
    private readonly timing: TimingRunner = runWhisperCpp,
  ) {}

  describe() {
    return {
      available: Boolean(
        this.config.apiKey && existsSync(this.config.timingModelPath),
      ),
      provider: "openrouter+whisper.cpp",
      transcription_model: this.config.transcriptionModel,
      timing_model: this.config.timingModelPath,
    };
  }

  async transcribe(input: {
    absolutePath: string;
    filename: string;
    mimeType: string;
    locale: string;
    prompt: string | null;
  }): Promise<TranscriptionResult> {
    if (
      !this.config.apiKey ||
      !this.config.timingModelPath ||
      !existsSync(this.config.timingModelPath)
    ) {
      throw new Error("transcription_provider_not_configured");
    }
    const bytes = await readFile(input.absolutePath);
    const [referenceResponse, timing] = await Promise.all([
      this.request("https://openrouter.ai/api/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          "x-title": "Greenlight Studio",
        },
        body: JSON.stringify({
          model: this.config.transcriptionModel,
          input_audio: {
            data: bytes.toString("base64"),
            format: audioFormat(input.filename, input.mimeType),
          },
          language: languageCode(input.locale),
          ...(input.prompt
            ? { provider: { options: { openai: { prompt: input.prompt } } } }
            : {}),
        }),
      }),
      this.timing({
        absolutePath: input.absolutePath,
        binaryPath: this.config.timingBinaryPath,
        locale: languageCode(input.locale),
        modelPath: this.config.timingModelPath,
      }),
    ]);
    const reference = await parseJson(referenceResponse, "transcription");
    const referenceText = String(reference.text ?? "").trim();
    if (!referenceText) throw new Error("transcription_text_missing");
    const usage =
      reference.usage && typeof reference.usage === "object"
        ? (reference.usage as Record<string, unknown>)
        : {};
    const reportedCost = Number(usage.cost);
    return {
      referenceText,
      timedText: timing.text,
      words: timing.words,
      provenance: {
        name: "openrouter+whisper.cpp",
        transcription_model: this.config.transcriptionModel,
        timing_model: this.config.timingModelPath,
        usage_cost_usd: Number.isFinite(reportedCost) ? reportedCost : null,
      },
    };
  }
}
