import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  findSpokenPhrase,
  OpenAITranscriptionProvider,
} from "../src/providers/transcription.js";

describe("transcription", () => {
  it("keeps accurate text and measured word timing as separate signals", async () => {
    const directory = await mkdtemp(join(tmpdir(), "greenlight-transcript-"));
    const audio = join(directory, "voice.wav");
    await writeFile(audio, Uint8Array.from([82, 73, 70, 70]));
    const requests: FormData[] = [];
    const provider = new OpenAITranscriptionProvider(
      {
        apiKey: "test",
        transcriptionModel: "gpt-4o-mini-transcribe",
        timingModel: "whisper-1",
      },
      async (_url, init) => {
        const form = init?.body as FormData;
        requests.push(form);
        const timed = form.get("response_format") === "verbose_json";
        return Response.json(
          timed
            ? {
                text: "Cut after this word",
                words: [
                  { word: "Cut", start: 0.1, end: 0.3 },
                  { word: "after", start: 0.31, end: 0.6 },
                  { word: "this", start: 0.61, end: 0.8 },
                  { word: "word", start: 0.81, end: 1.1 },
                ],
              }
            : { text: "Cut after this word." },
        );
      },
    );
    const result = await provider.transcribe({
      absolutePath: audio,
      filename: "voice.wav",
      mimeType: "audio/wav",
      locale: "en",
      prompt: null,
    });
    expect(result.referenceText).toBe("Cut after this word.");
    expect(result.words).toHaveLength(4);
    expect(requests.map((form) => form.get("model"))).toEqual([
      "gpt-4o-mini-transcribe",
      "whisper-1",
    ]);
    expect(requests[1]?.getAll("timestamp_granularities[]")).toEqual(["word"]);
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
});
