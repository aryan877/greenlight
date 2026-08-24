import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  findSpokenPhrase,
  OpenRouterTranscriptionProvider,
  parseWhisperWords,
} from "../src/providers/transcription.js";
import { captionsFromTimedWords } from "../src/mcp/tools.js";

describe("transcription", () => {
  it("uses OpenRouter text with independently measured local word timing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "greenlight-transcript-"));
    const audio = join(directory, "voice.wav");
    const timingModel = join(directory, "ggml-base.bin");
    await writeFile(audio, Uint8Array.from([82, 73, 70, 70]));
    await writeFile(timingModel, Uint8Array.from([0]));
    let body: Record<string, unknown> | null = null;
    const provider = new OpenRouterTranscriptionProvider(
      {
        apiKey: "test",
        transcriptionModel: "openai/gpt-4o-mini-transcribe",
        timingBinaryPath: "whisper-cli",
        timingModelPath: timingModel,
      },
      async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          text: "Cut after this word.",
          usage: { cost: 0.00042 },
        });
      },
      async () => ({
        text: "Cut after this word.",
        words: [
          { index: 0, text: "Cut", start_seconds: 0.1, end_seconds: 0.3 },
          { index: 1, text: "after", start_seconds: 0.31, end_seconds: 0.6 },
          { index: 2, text: "this", start_seconds: 0.61, end_seconds: 0.8 },
          { index: 3, text: "word.", start_seconds: 0.81, end_seconds: 1.1 },
        ],
      }),
    );
    const result = await provider.transcribe({
      absolutePath: audio,
      filename: "voice.wav",
      mimeType: "audio/wav",
      locale: "en-US",
      prompt: null,
    });
    expect(result.referenceText).toBe("Cut after this word.");
    expect(result.words).toHaveLength(4);
    expect(result.provenance.usage_cost_usd).toBe(0.00042);
    expect(body).toMatchObject({
      model: "openai/gpt-4o-mini-transcribe",
      input_audio: { format: "wav" },
      language: "en",
    });
  });

  it("turns whisper.cpp tokens into punctuation-safe words", () => {
    const result = parseWhisperWords({
      transcription: [
        {
          tokens: [
            { text: "[_BEG_]", offsets: { from: 0, to: 0 } },
            { text: " Hello", offsets: { from: 120, to: 420 } },
            { text: ",", offsets: { from: 420, to: 480 } },
            { text: " world", offsets: { from: 500, to: 900 } },
            { text: ".", offsets: { from: 900, to: 940 } },
          ],
        },
      ],
    });
    expect(result.words).toEqual([
      { index: 0, text: "Hello,", start_seconds: 0.12, end_seconds: 0.48 },
      { index: 1, text: "world.", start_seconds: 0.5, end_seconds: 0.94 },
    ]);
  });

  it("fails before provider work when the timing model is missing", async () => {
    const provider = new OpenRouterTranscriptionProvider({
      apiKey: "test",
      transcriptionModel: "openai/gpt-4o-mini-transcribe",
      timingBinaryPath: "whisper-cli",
      timingModelPath: "/missing/greenlight-whisper-model.bin",
    });

    await expect(
      provider.transcribe({
        absolutePath: "/missing/audio.wav",
        filename: "audio.wav",
        mimeType: "audio/wav",
        locale: "en",
        prompt: null,
      }),
    ).rejects.toThrow("transcription_provider_not_configured");
  });

  it("finds a phrase using exact measured word boundaries", () => {
    const match = findSpokenPhrase(
      [
        { index: 0, text: "Cut", start_seconds: 0.1, end_seconds: 0.3 },
        { index: 1, text: "after", start_seconds: 0.31, end_seconds: 0.6 },
        { index: 2, text: "this", start_seconds: 0.61, end_seconds: 0.8 },
      ],
      "after this",
    );
    expect(match).toMatchObject({
      start_seconds: 0.31,
      end_seconds: 0.8,
      start_word_index: 1,
      end_word_index: 2,
    });
  });

  it("keeps sub-millisecond measured words valid as caption cues", () => {
    expect(
      captionsFromTimedWords([
        { text: "A", start_seconds: 1.0001, end_seconds: 1.0002 },
        { text: "cut", start_seconds: 1.1, end_seconds: 1.1 },
      ]),
    ).toEqual([
      {
        text: "A",
        startMs: 1_000,
        endMs: 1_001,
        timestampMs: null,
        confidence: null,
      },
      {
        text: " cut",
        startMs: 1_100,
        endMs: 1_101,
        timestampMs: null,
        confidence: null,
      },
    ]);
  });
});
