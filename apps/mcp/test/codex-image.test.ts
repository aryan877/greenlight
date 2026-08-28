import { describe, expect, it } from "vitest";

import { codexConnectionFromStatus } from "../src/providers/codex-image.js";

describe("Codex image capability status", () => {
  it("recognizes a ChatGPT login", () => {
    expect(codexConnectionFromStatus("Logged in using ChatGPT")).toBe(
      "chatgpt",
    );
  });

  it("recognizes an API-key login", () => {
    expect(codexConnectionFromStatus("Logged in using an API key")).toBe(
      "api_key",
    );
  });

  it("does not treat an unauthenticated response as connected", () => {
    expect(codexConnectionFromStatus("Not logged in")).toBeNull();
  });
});
