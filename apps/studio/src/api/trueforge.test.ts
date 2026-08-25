import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:4173" } });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("Producer event projection", () => {
  it("keeps creator cancellation explicit when resuming a paused question", async () => {
    const { CREATOR_CANCELLED_QUESTION } = await import("./trueforge.js");

    expect(CREATOR_CANCELLED_QUESTION).toBe(
      "The creator cancelled this request. Stop here and make no changes.",
    );
  });

  it("restores the latest response turn from the project's session chain", async () => {
    const { latestProjectSessionTurn } = await import("./trueforge.js");
    const root = {
      createdAt: "2026-08-24T10:00:00.000Z",
      input: [
        {
          type: "user.message",
          content: "PROJECT_ID: project_greenlight\n\nTrim this scene.",
        },
      ],
    };
    const response = {
      createdAt: "2026-08-24T10:01:00.000Z",
      input: [
        {
          type: "user.tool_response",
          tool_call_id: "question_001",
          content: "Use 4 seconds",
        },
      ],
    };

    expect(
      latestProjectSessionTurn([root, response], "project_greenlight"),
    ).toBe(response);
    expect(latestProjectSessionTurn([root, response], "project_other")).toBe(
      null,
    );
  });

  it("keeps clarification text visible and exposes the exact paused question", async () => {
    const { describeEvent, pendingQuestionsFromEvent } =
      await import("./trueforge.js");
    const source = {
      id: "model_question",
      type: "model.message",
      content: "I found two different trim targets. Which one should I use?",
      tool_calls: [
        {
          id: "question_call",
          function: {
            name: "ask_user_question",
            arguments: JSON.stringify({
              question: "Which duration should I use?",
              options: ["2.2 seconds", "3.4 seconds"],
            }),
          },
        },
      ],
    };
    const required = {
      id: "question_required",
      type: "tool.response_required",
      thread_id: "main",
      tool_calls: [{ id: "question_call", source_event_id: "model_question" }],
    };

    expect(describeEvent(source)[0]?.label).toBe(
      "I found two different trim targets.",
    );
    expect(
      pendingQuestionsFromEvent(
        required,
        new Map([[source.id, source]]),
        "turn_question",
      ),
    ).toEqual([
      {
        eventId: "question_required",
        turnId: "turn_question",
        threadId: "main",
        toolCallId: "question_call",
        question: "Which duration should I use?",
        options: ["2.2 seconds", "3.4 seconds"],
      },
    ]);
  });

  it("extracts only absolute, deduplicated TrueForge sandbox outputs", async () => {
    const { parseSandboxArtifactReferences } = await import("./trueforge.js");

    expect(
      parseSandboxArtifactReferences(
        [
          "The cut is ready.",
          "```sandbox_artifacts",
          "[Tight cut](/workspace/tight-cut.mp4)",
          "[duplicate](/workspace/tight-cut.mp4)",
          "[unsafe](relative.mp4)",
          "```",
        ].join("\n"),
      ),
    ).toEqual([{ name: "tight-cut.mp4", path: "/workspace/tight-cut.mp4" }]);
  });

  it("hides routine context reads from the creator feed", async () => {
    const { describeEvent } = await import("./trueforge.js");
    const read = (name: string) => ({
      id: `event_${name}`,
      type: "model.message",
      content: "",
      tool_calls: [
        {
          id: `call_${name}`,
          function: { name, arguments: "{}" },
        },
      ],
    });

    expect(describeEvent(read("get_project"))).toEqual([]);
    expect(describeEvent(read("get_artifact"))).toEqual([]);
  });

  it("keeps runtime identifiers and frame arithmetic out of creator copy", async () => {
    const { describeEvent } = await import("./trueforge.js");
    const message = (content: string) => ({
      id: crypto.randomUUID(),
      type: "model.message",
      content,
    });

    expect(
      describeEvent(
        message(
          "Got it — scene_open_hook uses artifact_123 from the current revision.",
        ),
      ),
    ).toEqual([]);
    expect(
      describeEvent(
        message("Frame math confirmed: frames 0–78, gapAfter 5.0 seconds."),
      ),
    ).toEqual([]);
    expect(
      describeEvent(message("Patch applied successfully."))[0]?.label,
    ).toBe("Change applied.");
    expect(
      describeEvent(
        message("The patch was cancelled. No changes were made."),
      )[0]?.label,
    ).toBe("Change cancelled.");
  });

  it("ignores malformed tool references instead of breaking the feed", async () => {
    const { pendingQuestionsFromEvent } = await import("./trueforge.js");

    expect(
      pendingQuestionsFromEvent(
        {
          id: "bad_question_event",
          type: "tool.response_required",
          tool_calls: { id: "not-an-array" },
        },
        new Map(),
        "turn_bad_question",
      ),
    ).toEqual([]);
  });
});
