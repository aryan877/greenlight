import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:4173" } });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("Producer event projection", () => {
  it("restores creator instructions without leaking editor context", async () => {
    const { describeTurnInput } = await import("./use-producer-agent.js");

    expect(
      describeTurnInput(
        {
          type: "turn.created",
          input: [
            {
              type: "user.message",
              content: [
                "PROJECT_ID: project_greenlight",
                "",
                "Tighten the opening hook.",
                "",
                'EDITOR_TIMELINE (complete current cut):\n{"items":[]}',
                "",
                'EDITOR_SELECTION (current emphasis):\n{"item_ids":[]}',
              ].join("\n"),
            },
          ],
        },
        "turn_one",
        "project_greenlight",
      ),
    ).toEqual([
      {
        id: "turn-input-turn_one-0",
        kind: "instruction",
        label: "Tighten the opening hook.",
        detail: "",
        sceneIds: [],
        delivery: "sent",
      },
    ]);
  });

  it("restores creator decisions and hides internal artifact handoffs", async () => {
    const { describeTurnInput } = await import("./use-producer-agent.js");

    expect(
      describeTurnInput(
        {
          type: "turn.created",
          input: [
            {
              type: "user.message",
              content:
                "PROJECT_ID: project_greenlight\n\nGREENLIGHT_ARTIFACT_HANDOFF\ninternal",
            },
            {
              type: "user.tool_response",
              tool_call_id: "question_one",
              content: "Use the shorter version",
            },
          ],
        },
        "turn_two",
        "project_greenlight",
      ),
    ).toEqual([
      {
        id: "turn-input-turn_two-1",
        kind: "instruction",
        label: "Use the shorter version",
        detail: "",
        sceneIds: [],
        delivery: "sent",
      },
    ]);
  });

  it("keeps the full durable history even when messages have the same text", async () => {
    const { appendUniqueStudioEvents } =
      await import("./use-producer-agent.js");
    const history = Array.from({ length: 64 }, (_, index) => ({
      id: `event_${index}`,
      kind: "message" as const,
      label: "Still working",
      detail: "",
      sceneIds: [],
    }));

    expect(appendUniqueStudioEvents([], history)).toHaveLength(64);
    expect(
      appendUniqueStudioEvents(history, [
        history[0]!,
        {
          ...history[0]!,
          id: "event_64",
        },
      ]),
    ).toHaveLength(65);
  });

  it("projects a child thread into one durable subagent card", async () => {
    const { appendUniqueStudioEvents, describeEvent } =
      await import("./use-producer-agent.js");
    const started = describeEvent({
      id: "thread_created",
      type: "thread.created",
      thread_id: "research_sources",
      title: "Research · Primary sources",
      agent_info: {
        type: "dynamic",
        name: "Research · Primary sources",
        input: "Find primary sources for the opening claim.",
      },
    });
    const searching = describeEvent({
      id: "searching",
      type: "model.message",
      thread_id: "research_sources",
      tool_calls: [
        {
          id: "search_call",
          function: { name: "web_search_exa", arguments: "{}" },
        },
      ],
    });
    const searched = describeEvent({
      id: "searched",
      type: "tool.response",
      thread_id: "research_sources",
      tool_call_id: "search_call",
    });
    const finished = describeEvent({
      id: "thread_done",
      type: "thread.done",
      thread_id: "research_sources",
      title: "Research · Primary sources",
      state: {
        status: "done",
        output: {
          type: "model.message",
          content: "Two primary sources support the opening claim.",
        },
      },
    });

    const projected = [searching, searched, finished].reduce(
      appendUniqueStudioEvents,
      started,
    );

    expect(projected).toEqual([
      {
        id: "subagent-research_sources",
        kind: "subagent",
        label: "Research · Primary sources",
        detail: "Done",
        sceneIds: [],
        status: "done",
        subagent: {
          threadId: "research_sources",
          brief: "Find primary sources for the opening claim.",
          steps: [
            {
              id: "search_call",
              label: "Searching the web",
              status: "done",
            },
          ],
          result: "Two primary sources support the opening claim.",
        },
      },
    ]);
  });

  it("turns a completed script thread into a review document", async () => {
    const { appendUniqueStudioEvents, describeEvent } =
      await import("./use-producer-agent.js");
    const started = describeEvent({
      type: "thread.created",
      thread_id: "script_draft",
      title: "Script · Chapters and draft",
      agent_info: { input: "Write the chapter plan and spoken script." },
    });
    const finished = describeEvent({
      type: "thread.done",
      thread_id: "script_draft",
      title: "Script · Chapters and draft",
      state: {
        status: "done",
        output: {
          content:
            "Chapter 1: Hook\n\nOpen with the creator's central tension.",
        },
      },
    });

    const [event] = appendUniqueStudioEvents(started, finished);
    expect(event?.document).toEqual({
      title: "Script draft",
      subtitle: "Review the chapters and wording before production starts",
      sections: [
        {
          title: "Script · Chapters and draft",
          lines: [
            "Chapter 1: Hook",
            "Open with the creator's central tension.",
          ],
        },
      ],
    });
  });

  it("shows a compaction milestone only when TrueForge emits one", async () => {
    const { describeEvent } = await import("./use-producer-agent.js");

    expect(
      describeEvent({
        id: "context_compacted",
        type: "agent.context.overwrite",
        reason: "compaction",
      }),
    ).toEqual([
      {
        id: "context_compacted",
        kind: "system",
        label: "Context compacted",
        detail: "Earlier messages remain available in this history.",
        sceneIds: [],
      },
    ]);
    expect(
      describeEvent({
        id: "context_replaced",
        type: "agent.context.overwrite",
        reason: "manual",
      }),
    ).toEqual([]);
  });

  it("sends the whole cut and keeps the current selection as emphasis", async () => {
    const { createProducerUserMessage } =
      await import("./use-producer-agent.js");
    const message = createProducerUserMessage("project_greenlight", {
      instruction: "Move the next clip before the selected one.",
      timeline: {
        project_id: "project_greenlight",
        content_package_artifact_id: "artifact_content",
        headline: "One cut",
        duration_seconds: 4,
        playhead_seconds: 1,
        tracks: [],
        items: [],
        gaps: [],
        scenes: [
          {
            id: "scene_one",
            title: "First",
            start_seconds: 0,
            end_seconds: 2,
            gap_after_seconds: 0,
            playback_rate: 1,
          },
          {
            id: "scene_two",
            title: "Second",
            start_seconds: 2,
            end_seconds: 4,
            gap_after_seconds: 0,
            playback_rate: 1,
          },
        ],
      },
      selection: {
        project_id: "project_greenlight",
        base_content_package_artifact_id: "artifact_content",
        item_ids: [],
        scene_ids: ["scene_one"],
        track_ids: ["visual", "voice", "caption", "transcript"],
        gap_ids: [],
        artifact_ids: [],
        playhead_seconds: 1,
        time_range_seconds: { start: 0, end: 2 },
      },
      references: {
        project_id: "project_greenlight",
        base_content_package_artifact_id: "artifact_content",
        item_ids: ["caption_scene_two"],
        scene_ids: ["scene_two"],
        track_ids: ["track_captions", "caption"],
        gap_ids: [],
        artifact_ids: [],
        playhead_seconds: 1,
        time_range_seconds: { start: 2, end: 4 },
      },
    });

    expect(message.indexOf("EDITOR_TIMELINE")).toBeLessThan(
      message.indexOf("EDITOR_SELECTION"),
    );
    expect(message).toContain('"id":"scene_two"');
    expect(message).toContain("EDITOR_SELECTION (current emphasis)");
    expect(message).toContain(
      "EDITOR_REFERENCES (explicit creator attachments)",
    );
    expect(message).toContain('"item_ids":["caption_scene_two"]');
  });

  it("keeps creator cancellation explicit when resuming a paused question", async () => {
    const { CREATOR_CANCELLED_QUESTION } =
      await import("./use-producer-agent.js");

    expect(CREATOR_CANCELLED_QUESTION).toBe(
      "The creator cancelled this request. Stop here and make no changes.",
    );
  });

  it("restores the latest response turn from the project's session chain", async () => {
    const { latestProjectSessionTurn } =
      await import("./use-producer-agent.js");
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
      await import("./use-producer-agent.js");
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
    const { parseSandboxArtifactReferences } =
      await import("./use-producer-agent.js");

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
    const { describeEvent } = await import("./use-producer-agent.js");
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

  it("reads the authoritative TrueForge terminal status", async () => {
    const { terminalFailureMessage } = await import("./use-producer-agent.js");

    expect(
      terminalFailureMessage({
        type: "turn.done",
        state: { status: "done", output: { type: "model.message" } },
      }),
    ).toBeNull();
    expect(
      terminalFailureMessage({
        type: "turn.done",
        state: { status: "error", error: "provider_unavailable" },
      }),
    ).toBe("The model stopped before replying. Retry this message.");
    expect(
      terminalFailureMessage({
        type: "turn.done",
        state: { status: "cancelled" },
      }),
    ).toContain("stopped");
  });

  it("derives durable reply duration from the TrueForge turn lifecycle", async () => {
    const { describeEvent, turnDurationMs } =
      await import("./use-producer-agent.js");
    const created = {
      id: "turn_created",
      type: "turn.created",
      createdAt: "2026-08-26T04:04:30.670Z",
    };
    const done = {
      id: "turn_done",
      type: "turn.done",
      state: {
        status: "done",
        completedAt: "2026-08-26T04:04:34.905Z",
      },
    };

    expect(turnDurationMs(created, done)).toBe(4_235);
    expect(
      describeEvent(
        {
          id: "reply",
          type: "model.message",
          content: "The opening is ready.",
        },
        { durationMs: 4_235 },
      ),
    ).toEqual([
      {
        id: "reply",
        kind: "message",
        label: "The opening is ready.",
        detail: "",
        sceneIds: [],
        durationMs: 4_235,
      },
    ]);
    expect(
      turnDurationMs(created, {
        ...done,
        state: {
          ...done.state,
          completedAt: "2026-08-26T04:04:29.000Z",
        },
      }),
    ).toBeNull();
  });

  it("deduplicates provider-reported cost by durable turn", async () => {
    const { totalSessionCostInUsd, turnCostInUsd } =
      await import("./use-producer-agent.js");
    const camelCost = turnCostInUsd({
      type: "turn.done",
      state: { metrics: { totalCostInUsd: 0.0042 } },
    });
    const snakeCost = turnCostInUsd({
      type: "turn.done",
      state: { metrics: { total_cost_in_usd: 0.0018 } },
    });

    expect(camelCost).toBe(0.0042);
    expect(snakeCost).toBe(0.0018);
    expect(
      totalSessionCostInUsd(
        new Map([
          ["turn_one", camelCost!],
          ["turn_two", snakeCost!],
        ]),
      ),
    ).toBeCloseTo(0.006);
    expect(totalSessionCostInUsd(new Map())).toBeNull();
    expect(
      turnCostInUsd({
        type: "turn.done",
        state: { metrics: { totalCostInUsd: -1 } },
      }),
    ).toBeNull();
  });

  it("keeps runtime identifiers out without swallowing a valid reply", async () => {
    const { describeEvent } = await import("./use-producer-agent.js");
    const message = (content: string) => ({
      id: crypto.randomUUID(),
      type: "model.message",
      content,
    });

    expect(
      describeEvent(
        message(
          "Got it — scene_open_hook uses artifact_123 from the current revision. The selected clip is ready to review.",
        ),
      )[0]?.label,
    ).toBe("The selected clip is ready to review.");
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
        message(
          "Yes — I can see the current cut: scene_open_hook at 4.000s (frames 0–120).",
        ),
      )[0]?.label,
    ).toBe("Yes. I can see the current cut.");
    expect(
      describeEvent(message("The patch was cancelled. No changes were made.")),
    ).toEqual([]);
    expect(describeEvent(message("Stopped, no changes."))).toEqual([]);
    expect(
      describeEvent(message("Cancelled again, no change was made.")),
    ).toEqual([]);
  });

  it("ignores malformed tool references instead of breaking the feed", async () => {
    const { pendingQuestionsFromEvent } =
      await import("./use-producer-agent.js");

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
