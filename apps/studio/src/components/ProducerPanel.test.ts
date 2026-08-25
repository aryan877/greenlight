import { describe, expect, it } from "vitest";

import { mergeProducerDraft } from "../editor/producer-draft.js";

describe("Producer composer references", () => {
  it("appends multiple scene mentions without erasing creator text", () => {
    const first = mergeProducerDraft("Make this tighter.", {
      id: "draft_one",
      text: "@“Edit one scene”",
      mode: "append",
    });
    const second = mergeProducerDraft(first, {
      id: "draft_two",
      text: "@“Build it that way”",
      mode: "append",
    });

    expect(second).toBe(
      "Make this tighter. @“Edit one scene” @“Build it that way” ",
    );
    expect(
      mergeProducerDraft(second, {
        id: "draft_three",
        text: "@“Edit one scene”",
        mode: "append",
      }),
    ).toBe(second);
  });
});
