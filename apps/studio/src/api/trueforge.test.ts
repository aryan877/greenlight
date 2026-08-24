import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:4173" } });
});

describe("Producer event projection", () => {
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
      pendingQuestionsFromEvent(required, new Map([[source.id, source]])),
    ).toEqual([
      {
        eventId: "question_required",
        threadId: "main",
        toolCallId: "question_call",
        question: "Which duration should I use?",
        options: ["2.2 seconds", "3.4 seconds"],
      },
    ]);
  });
});
