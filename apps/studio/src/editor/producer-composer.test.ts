import { describe, expect, it } from "vitest";

import { shouldSubmitProducerInstruction } from "./producer-composer.js";

describe("Producer composer keyboard behavior", () => {
  it("submits with Enter", () => {
    expect(
      shouldSubmitProducerInstruction({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true);
  });

  it("keeps Shift+Enter as a line break", () => {
    expect(
      shouldSubmitProducerInstruction({
        key: "Enter",
        shiftKey: true,
        isComposing: false,
      }),
    ).toBe(false);
  });

  it("does not submit while an input method is composing text", () => {
    expect(
      shouldSubmitProducerInstruction({
        key: "Enter",
        shiftKey: false,
        isComposing: true,
      }),
    ).toBe(false);
  });

  it("ignores other keys", () => {
    expect(
      shouldSubmitProducerInstruction({
        key: "a",
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(false);
  });
});
