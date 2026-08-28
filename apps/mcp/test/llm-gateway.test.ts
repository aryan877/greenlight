import { describe, expect, it } from "vitest";

import {
  normalizeProviderCost,
  normalizeProviderSseLine,
} from "../src/providers/llm-gateway.js";

describe("Greenlight LLM gateway", () => {
  it("maps an OpenRouter cost onto the AI Gateway usage field", () => {
    expect(
      normalizeProviderCost({
        id: "generation_1",
        usage: { prompt_tokens: 12, completion_tokens: 4, cost: 0.001234 },
      }),
    ).toEqual({
      id: "generation_1",
      usage: {
        prompt_tokens: 12,
        completion_tokens: 4,
        cost: 0.001234,
        costInUSD: 0.001234,
      },
    });
  });

  it("normalizes streaming usage without changing ordinary SSE events", () => {
    expect(
      normalizeProviderSseLine('data: {"choices":[],"usage":{"cost":0.0042}}'),
    ).toBe('data: {"choices":[],"usage":{"cost":0.0042,"costInUSD":0.0042}}');
    expect(normalizeProviderSseLine("data: [DONE]")).toBe("data: [DONE]");
  });
});
