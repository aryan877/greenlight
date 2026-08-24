import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  editorFocusInputSchema,
  type EditorFocusInput,
  type EditorSelection,
} from "@greenlight/contracts";
import {
  mergeEventDelta,
  TrueForge,
  TrueForgeApi,
} from "@truefoundry/trueforge-sdk";
import { useCallback, useEffect, useRef, useState } from "react";

import { greenlightKeys } from "./queries.js";

export type StudioAgentEvent = {
  id: string;
  kind:
    "reasoning" | "tool" | "artifact" | "approval" | "message" | "instruction";
  label: string;
  detail: string;
  sceneIds: string[];
  delivery?: "sending" | "sent" | "failed";
  document?: StudioReviewDocument;
};

export type StudioReviewDocument = {
  title: string;
  subtitle: string;
  sections: Array<{
    title: string;
    lines: string[];
  }>;
};

export type PendingToolApproval = {
  eventId: string;
  threadId: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
};

export type PendingQuestion = {
  eventId: string;
  threadId: string;
  toolCallId: string;
  question: string;
  options: string[];
};

type ProducerSendInput = {
  instruction: string;
  selection: EditorSelection | null;
  clientEventId?: string;
};

type WireEvent = Record<string, unknown> & {
  id?: string;
  type?: string;
};

type ToolCall = {
  id: string;
  function: { arguments: string; name: string };
};

const trueforge = new TrueForge({
  baseUrl: `${window.location.origin}/trueforge`,
  timeoutInSeconds: 600,
});

const textContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .join("\n");
};

const toolCallsOf = (event: WireEvent): ToolCall[] => {
  const value = event.toolCalls ?? event.tool_calls;
  return Array.isArray(value) ? (value as ToolCall[]) : [];
};

const parseArguments = (toolCall: ToolCall): Record<string, unknown> => {
  try {
    return JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export const pendingQuestionsFromEvent = (
  event: WireEvent,
  sources: Map<string, WireEvent>,
): PendingQuestion[] => {
  if (event.type !== "tool.response_required") return [];
  const refs = (event.toolCalls ?? event.tool_calls) as
    | Array<{
        id: string;
        sourceEventId?: string;
        source_event_id?: string;
      }>
    | undefined;
  return (refs ?? []).flatMap((reference) => {
    const sourceId = reference.sourceEventId ?? reference.source_event_id;
    const source = sourceId ? sources.get(sourceId) : undefined;
    const call = source
      ? toolCallsOf(source).find((candidate) => candidate.id === reference.id)
      : undefined;
    if (!call || call.function.name !== "ask_user_question") return [];
    const args = parseArguments(call);
    const question =
      typeof args.question === "string" ? args.question.trim() : "";
    if (!question) return [];
    return [
      {
        eventId: String(event.id ?? crypto.randomUUID()),
        threadId: String(event.threadId ?? event.thread_id ?? "main"),
        toolCallId: call.id,
        question,
        options: Array.isArray(args.options)
          ? args.options.filter(
              (option): option is string => typeof option === "string",
            )
          : [],
      },
    ];
  });
};

const selectionSceneIds = (args: Record<string, unknown>) =>
  args.selection && typeof args.selection === "object"
    ? ((args.selection as { scene_ids?: string[] }).scene_ids ?? [])
    : [];

const toolPresentation = (
  call: ToolCall,
): Omit<StudioAgentEvent, "id"> | null => {
  const args = parseArguments(call);
  const sceneIds = selectionSceneIds(args);
  const presentations: Record<
    string,
    { kind: StudioAgentEvent["kind"]; label: string; detail?: string }
  > = {
    get_project: { kind: "tool", label: "Opened the production" },
    get_artifact: { kind: "tool", label: "Checked the scene context" },
    save_evidence_ledger: {
      kind: "artifact",
      label: "Updated the source record",
      detail: `${Array.isArray(args.claims) ? args.claims.length : 0} supported claims kept`,
    },
    search_openmoji: { kind: "tool", label: "Found visual options" },
    attach_openmoji: { kind: "artifact", label: "Added a visual" },
    generate_voice: { kind: "artifact", label: "Created the voice track" },
    transcribe_audio: { kind: "artifact", label: "Timed every spoken word" },
    find_spoken_phrase: { kind: "tool", label: "Found the exact words" },
    correct_transcript: { kind: "artifact", label: "Corrected the transcript" },
    generate_image: { kind: "artifact", label: "Created a visual" },
    run_quality_checks: { kind: "tool", label: "Checked the finished cut" },
  };
  if (call.function.name === "save_evidence_ledger") {
    const sources = Array.isArray(args.sources)
      ? (args.sources as Array<Record<string, unknown>>)
      : [];
    const claims = Array.isArray(args.claims)
      ? (args.claims as Array<Record<string, unknown>>)
      : [];
    return {
      kind: "artifact",
      label: "Research is ready",
      detail: `${sources.length} references · ${claims.length} checked claims`,
      sceneIds,
      document: {
        title: "Research",
        subtitle: "The facts behind this production",
        sections: [
          {
            title: "Claims",
            lines: claims
              .map((claim) => String(claim.text ?? ""))
              .filter(Boolean),
          },
          {
            title: "References",
            lines: sources
              .map((source) => String(source.title ?? source.url ?? ""))
              .filter(Boolean),
          },
        ],
      },
    };
  }
  if (call.function.name === "save_content_package") {
    const scenes = Array.isArray(args.scenes)
      ? (args.scenes as Array<Record<string, unknown>>)
      : [];
    const metadata =
      args.metadata && typeof args.metadata === "object"
        ? (args.metadata as Record<string, unknown>)
        : {};
    return {
      kind: "artifact",
      label: "Storyboard is ready",
      detail: `${scenes.length} scenes · ${String(metadata.title ?? args.headline ?? "Untitled")}`,
      sceneIds,
      document: {
        title: String(args.headline ?? "Storyboard"),
        subtitle: String(args.dek ?? "Script, scenes, and release copy"),
        sections: [
          {
            title: "Scenes",
            lines: scenes.map((scene, index) => {
              const title = String(scene.title ?? `Scene ${index + 1}`);
              const narration = String(scene.narration ?? "");
              return `${index + 1}. ${title}${narration ? ` — ${narration}` : ""}`;
            }),
          },
          {
            title: "YouTube",
            lines: [
              String(metadata.title ?? ""),
              String(metadata.description ?? ""),
            ].filter(Boolean),
          },
        ],
      },
    };
  }
  const presentation = presentations[call.function.name];
  return presentation
    ? { ...presentation, detail: presentation.detail ?? "", sceneIds }
    : null;
};

export const describeEvent = (event: WireEvent): StudioAgentEvent[] => {
  const type = String(event.type ?? "agent.event");
  if (type === "model.message") {
    const output: StudioAgentEvent[] = [];
    const calls = toolCallsOf(event);
    for (const call of calls) {
      const presentation = toolPresentation(call);
      if (presentation) output.push({ id: call.id, ...presentation });
    }
    const content = textContent(event.content)
      .replace(/[*_`#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const isFiller = /^(let me|i(?:'ll| will)|now i|first[, ]|to begin)/i.test(
      content,
    );
    if (content && (calls.length === 0 || output.length === 0) && !isFiller) {
      const sentence =
        content.match(/^.{1,180}?(?:[.!?](?:\s|$)|$)/)?.[0] ??
        content.slice(0, 180);
      const humanSentence = /patch was not applied/i.test(sentence)
        ? "Change discarded."
        : sentence;
      output.push({
        id: String(event.id ?? crypto.randomUUID()),
        kind: "message",
        label: humanSentence.trim(),
        detail: "",
        sceneIds: [],
      });
    }
    return output;
  }
  if (type === "thread.created") {
    return [
      {
        id: String(event.id ?? crypto.randomUUID()),
        kind: "reasoning",
        label: "Researching in parallel",
        detail: "",
        sceneIds: [],
      },
    ];
  }
  return [];
};

export const useProducerAgent = (
  projectId: string | null,
  onFocus: (focus: EditorFocusInput) => void,
) => {
  const sessionId = useRef<string | null>(null);
  const activeProjectId = useRef(projectId);
  const onFocusRef = useRef(onFocus);
  const eventStore = useRef(new Map<string, WireEvent>());
  const outgoingStore = useRef(new Map<string, ProducerSendInput>());
  const [events, setEvents] = useState<StudioAgentEvent[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<
    PendingToolApproval[]
  >([]);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestion[]>(
    [],
  );
  const queryClient = useQueryClient();

  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  const appendEvents = useCallback((described: StudioAgentEvent[]) => {
    if (described.length === 0) return;
    setEvents((current) => {
      const ids = new Set(current.map((item) => item.id));
      const fresh = described.filter((item) => !ids.has(item.id));
      const compact = [...current];
      for (const item of fresh) {
        const last = compact.at(-1);
        if (last?.label === item.label && last.kind === item.kind) continue;
        compact.push(item);
      }
      return compact.slice(-40);
    });
  }, []);

  const ingest = useCallback(
    (incoming: WireEvent) => {
      let event = incoming;
      if (incoming.type === "model.message.delta") {
        const base = incoming.id
          ? eventStore.current.get(incoming.id)
          : undefined;
        if (base) mergeEventDelta(base as never, incoming as never);
        if (!(incoming.finishReason ?? incoming.finish_reason) || !base) return;
        event = base;
      }
      if (event.id) eventStore.current.set(event.id, event);

      if (
        event.type === "model.message" &&
        !event.content &&
        !event.reasoningContent &&
        !event.reasoning_content &&
        toolCallsOf(event).length === 0
      ) {
        return;
      }

      if (event.type === "model.message") {
        for (const call of toolCallsOf(event)) {
          if (call.function.name !== "focus_editor_selection") continue;
          const parsed = editorFocusInputSchema.safeParse(parseArguments(call));
          if (parsed.success) onFocusRef.current(parsed.data);
        }
      }

      if (
        event.type === "tool.approval_required" ||
        event.type === "tool.response_required"
      ) {
        const refs = (event.toolCalls ?? event.tool_calls) as
          | Array<{
              id: string;
              sourceEventId?: string;
              source_event_id?: string;
            }>
          | undefined;
        const resolved = (refs ?? []).flatMap((reference) => {
          const sourceId = reference.sourceEventId ?? reference.source_event_id;
          const source = sourceId
            ? eventStore.current.get(sourceId)
            : undefined;
          const call = source
            ? toolCallsOf(source).find(
                (candidate) => candidate.id === reference.id,
              )
            : undefined;
          return call ? [{ call, reference }] : [];
        });

        if (event.type === "tool.approval_required") {
          const approvals = resolved.map(({ call }) => ({
            eventId: String(event.id ?? crypto.randomUUID()),
            threadId: String(event.threadId ?? event.thread_id ?? "main"),
            toolCallId: call.id,
            toolName: call.function.name,
            arguments: parseArguments(call),
          }));
          setPendingApprovals((current) => [
            ...current.filter(
              (item) =>
                !approvals.some(
                  (approval) => approval.toolCallId === item.toolCallId,
                ),
            ),
            ...approvals,
          ]);
        } else {
          const questions = pendingQuestionsFromEvent(
            event,
            eventStore.current,
          );
          setPendingQuestions((current) => [
            ...current.filter(
              (item) =>
                !questions.some(
                  (question) => question.toolCallId === item.toolCallId,
                ),
            ),
            ...questions,
          ]);
        }
      }

      appendEvents(describeEvent(event));
    },
    [appendEvents],
  );

  useEffect(() => {
    activeProjectId.current = projectId;
    sessionId.current = null;
    eventStore.current.clear();
    outgoingStore.current.clear();
    setEvents([]);
    setPendingApprovals([]);
    setPendingQuestions([]);
    if (!projectId) return;

    let cancelled = false;
    const storageKey = `greenlight:producer-session:${projectId}`;
    const restore = async () => {
      let restoredSessionId: string | null = null;
      try {
        restoredSessionId = window.localStorage.getItem(storageKey);
      } catch {
        // Local storage can be unavailable in hardened browser contexts.
      }

      const findMatchingTurn = async (candidateSessionId: string) => {
        const turns = await trueforge.sessions.listTurns(candidateSessionId, {
          limit: 25,
        });
        let latest: TrueForgeApi.Turn | null = null;
        for await (const turn of turns) {
          const belongsToProject = (turn.input ?? []).some((item) => {
            const value = item as unknown as Record<string, unknown>;
            return (
              value.type === "user.message" &&
              typeof value.content === "string" &&
              value.content.includes(`PROJECT_ID: ${projectId}`)
            );
          });
          if (
            belongsToProject &&
            (!latest || turn.createdAt > latest.createdAt)
          ) {
            latest = turn;
          }
        }
        return latest;
      };

      let latestTurn = restoredSessionId
        ? await findMatchingTurn(restoredSessionId).catch(() => null)
        : null;
      if (!latestTurn) {
        const sessions = await trueforge.sessions.list({ limit: 25 });
        for await (const candidate of sessions) {
          if (
            candidate.agent.type !== "reference" ||
            candidate.agent.name !== "greenlight-producer"
          ) {
            continue;
          }
          const turn = await findMatchingTurn(candidate.id).catch(() => null);
          if (!turn) continue;
          restoredSessionId = candidate.id;
          latestTurn = turn;
          break;
        }
      }
      if (
        cancelled ||
        activeProjectId.current !== projectId ||
        !restoredSessionId ||
        !latestTurn ||
        sessionId.current
      ) {
        return;
      }

      sessionId.current = restoredSessionId;
      try {
        window.localStorage.setItem(storageKey, restoredSessionId);
      } catch {
        // The in-memory session still works when persistence is unavailable.
      }
      const restoredInstruction = (latestTurn.input ?? []).find((item) => {
        const value = item as unknown as Record<string, unknown>;
        return value.type === "user.message" && typeof value.content === "string";
      }) as { content?: string } | undefined;
      const instruction = restoredInstruction?.content
        ?.replace(/^PROJECT_ID:[^\n]+\n\n/, "")
        .split("\n\nEDITOR_SELECTION")[0]
        ?.trim();
      if (instruction) {
        appendEvents([
          {
            id: `instruction-${latestTurn.id}`,
            kind: "instruction",
            label: instruction,
            detail: "",
            sceneIds: [],
            delivery: "sent",
          },
        ]);
      }
      const persisted = await trueforge.sessions.listTurnEvents(
        restoredSessionId,
        latestTurn.id,
        { limit: 100, order: "asc" },
      );
      for await (const stored of persisted) {
        if (cancelled || activeProjectId.current !== projectId) return;
        ingest(stored as unknown as WireEvent);
      }
    };
    void restore().catch(() => {
      appendEvents([
        {
          id: "producer-restore-error",
          kind: "message",
          label: "Couldn’t reconnect to the previous Producer session.",
          detail: "Your next instruction will start a fresh session.",
          sceneIds: [],
        },
      ]);
    });
    return () => {
      cancelled = true;
    };
  }, [ingest, projectId]);

  const consume = useCallback(
    async (
      stream: Awaited<ReturnType<typeof trueforge.sessions.createTurnStream>>,
      streamProjectId: string,
    ) => {
      for await (const envelope of stream.withMetadata()) {
        if (activeProjectId.current !== streamProjectId) return;
        ingest(envelope.data as unknown as WireEvent);
      }
    },
    [ingest],
  );

  const send = useMutation<void, Error, ProducerSendInput, { eventId: string }>(
    {
      mutationFn: async (input) => {
        if (!projectId) throw new Error("project_not_selected");
        if (!sessionId.current) {
          const created = await trueforge.sessions.create({
            agent: { name: "greenlight-producer" },
          });
          sessionId.current = created.data.id;
          try {
            window.localStorage.setItem(
              `greenlight:producer-session:${projectId}`,
              created.data.id,
            );
          } catch {
            // Keep using the live in-memory session.
          }
        }
        const selectionContext = input.selection
          ? `\n\nEDITOR_SELECTION (exact current Studio scope):\n${JSON.stringify(input.selection)}`
          : "";
        const stream = await trueforge.sessions.createTurnStream(
          sessionId.current,
          {
            input: [
              {
                type: "user.message",
                content: `PROJECT_ID: ${projectId}\n\n${input.instruction}${selectionContext}`,
              },
            ],
          },
        );
        await consume(stream, projectId);
      },
      onMutate: (input) => {
        const eventId =
          input.clientEventId ?? `instruction-${crypto.randomUUID()}`;
        outgoingStore.current.set(eventId, {
          ...input,
          clientEventId: eventId,
        });
        setEvents((current) => {
          const event: StudioAgentEvent = {
            id: eventId,
            kind: "instruction",
            label: input.instruction,
            detail: "",
            sceneIds: input.selection?.scene_ids ?? [],
            delivery: "sending",
          };
          const existing = current.findIndex((item) => item.id === eventId);
          if (existing < 0) return [...current, event].slice(-40);
          return current.map((item) => (item.id === eventId ? event : item));
        });
        return { eventId };
      },
      onError: (_error, _input, context) => {
        if (!context) return;
        setEvents((current) =>
          current.map((item) =>
            item.id === context.eventId
              ? { ...item, delivery: "failed" as const }
              : item,
          ),
        );
      },
      onSuccess: async () => {
        if (projectId) {
          await queryClient.invalidateQueries({
            queryKey: greenlightKeys.project(projectId),
          });
        }
      },
      onSettled: (_data, error, _input, context) => {
        if (!context || error) return;
        outgoingStore.current.delete(context.eventId);
        setEvents((current) =>
          current.map((item) =>
            item.id === context.eventId
              ? { ...item, delivery: "sent" as const }
              : item,
          ),
        );
      },
    },
  );

  const retryInstruction = useCallback(
    (eventId: string) => {
      const input = outgoingStore.current.get(eventId);
      if (input && !send.isPending) send.mutate(input);
    },
    [send],
  );

  const approval = useMutation({
    mutationFn: async (input: {
      pending: PendingToolApproval;
      status: "allow" | "deny";
      reason?: string;
    }) => {
      if (!sessionId.current) throw new Error("producer_session_missing");
      if (!projectId) throw new Error("project_not_selected");
      const stream = await trueforge.sessions.createTurnStream(
        sessionId.current,
        {
          input: [
            {
              type: "user.tool_approval",
              threadId: input.pending.threadId,
              toolCallId: input.pending.toolCallId,
              approval:
                input.status === "allow"
                  ? { status: "allow" }
                  : { status: "deny", reason: input.reason },
            },
          ],
        },
      );
      setPendingApprovals((current) =>
        current.filter((item) => item.toolCallId !== input.pending.toolCallId),
      );
      await consume(stream, projectId);
    },
    onSuccess: async () => {
      if (projectId) {
        await queryClient.invalidateQueries({
          queryKey: greenlightKeys.project(projectId),
        });
      }
    },
  });

  const question = useMutation({
    mutationFn: async (input: { pending: PendingQuestion; answer: string }) => {
      if (!sessionId.current) throw new Error("producer_session_missing");
      if (!projectId) throw new Error("project_not_selected");
      const stream = await trueforge.sessions.createTurnStream(
        sessionId.current,
        {
          input: [
            {
              type: "user.tool_response",
              threadId: input.pending.threadId,
              toolCallId: input.pending.toolCallId,
              content: input.answer,
            },
          ],
        },
      );
      await consume(stream, projectId);
      setPendingQuestions((current) =>
        current.filter((item) => item.toolCallId !== input.pending.toolCallId),
      );
    },
    onSuccess: async () => {
      if (projectId) {
        await queryClient.invalidateQueries({
          queryKey: greenlightKeys.project(projectId),
        });
      }
    },
  });

  return {
    events,
    pendingApprovals,
    pendingQuestions,
    sessionId: sessionId.current,
    send: send.mutate,
    retryInstruction,
    isSending: send.isPending,
    decideApproval: approval.mutate,
    isApproving: approval.isPending,
    answerQuestion: question.mutate,
    isAnswering: question.isPending,
  };
};
