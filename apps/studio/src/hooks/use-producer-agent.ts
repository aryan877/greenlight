import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  editorFocusInputSchema,
  type Artifact,
  type EditorFocusInput,
  type EditorSelection,
  type EditorTimelineContext,
} from "@greenlight/contracts";
import {
  mergeEventDelta,
  TrueForge,
  TrueForgeApi,
} from "@truefoundry/trueforge-sdk";
import { useCallback, useEffect, useRef, useState } from "react";

import { greenlightApi } from "../api/greenlight.js";
import { greenlightKeys } from "../api/query-keys.js";

export type StudioAgentEvent = {
  id: string;
  turnId?: string;
  kind:
    | "reasoning"
    | "plan"
    | "subagent"
    | "tool"
    | "artifact"
    | "approval"
    | "question"
    | "message"
    | "instruction"
    | "system";
  label: string;
  detail: string;
  sceneIds: string[];
  delivery?: "sending" | "sent" | "failed";
  document?: StudioReviewDocument;
  artifactId?: string;
  status?: "running" | "done" | "error";
  subagent?: StudioSubagentRun;
  durationMs?: number;
  tool?: {
    callId: string;
    name: string;
    server: string | null;
  };
  approval?: {
    pending: PendingToolApproval;
    decision?: {
      status: "allow" | "deny";
      label: string;
      reason?: string;
    };
  };
  question?: {
    pending: PendingQuestion;
    answer?: string;
  };
  plan?: {
    title: string;
    steps: Array<{
      id: string;
      label: string;
      status: "pending" | "in_progress" | "completed" | "blocked";
    }>;
  };
};

export type StudioSubagentStep = {
  id: string;
  label: string;
  status: "running" | "done";
};

export type StudioSubagentRun = {
  threadId: string;
  brief: string;
  steps: StudioSubagentStep[];
  result: string;
};

export type StudioReviewDocument = {
  title: string;
  subtitle: string;
  sections: Array<{
    title: string;
    lines: string[];
  }>;
};

export const appendUniqueStudioEvents = (
  current: StudioAgentEvent[],
  incoming: StudioAgentEvent[],
): StudioAgentEvent[] => {
  if (incoming.length === 0) return current;
  const updates = new Map(incoming.map((item) => [item.id, item]));
  const currentIds = new Set(current.map((item) => item.id));
  return [
    ...current.map((item) => {
      const update = updates.get(item.id);
      if (!update) return item;
      if (item.kind === "plan" && update.kind === "plan") {
        return {
          ...item,
          ...update,
          ...(item.turnId ? { turnId: item.turnId } : {}),
        };
      }
      if (item.kind !== "subagent" || update.kind !== "subagent") {
        return update;
      }
      const steps = new Map(
        (item.subagent?.steps ?? []).map((step) => [step.id, step]),
      );
      for (const step of update.subagent?.steps ?? []) {
        const currentStep = steps.get(step.id);
        steps.set(step.id, {
          ...currentStep,
          ...step,
          label: step.label || currentStep?.label || "Working",
        });
      }
      const settled = update.status && update.status !== "running";
      const uniqueSteps = new Map<string, StudioSubagentStep>();
      for (const step of steps.values()) {
        if (!step.label || step.label === "Working") continue;
        const key = step.label.toLocaleLowerCase();
        const next = settled ? { ...step, status: "done" as const } : step;
        const previous = uniqueSteps.get(key);
        uniqueSteps.set(key, previous ? { ...previous, ...next } : next);
      }
      return {
        ...item,
        ...update,
        label:
          update.label === "Subagent" && item.label ? item.label : update.label,
        subagent: {
          threadId: update.subagent?.threadId ?? item.subagent?.threadId ?? "",
          brief: update.subagent?.brief || item.subagent?.brief || "",
          steps: [...uniqueSteps.values()],
          result: update.subagent?.result || item.subagent?.result || "",
        },
      };
    }),
    ...incoming.filter((item) => !currentIds.has(item.id)),
  ];
};

export const compactStudioEvents = (
  events: StudioAgentEvent[],
): StudioAgentEvent[] => {
  const lastDuplicate = new Map<string, number>();
  for (const [index, event] of events.entries()) {
    if (event.kind !== "message") continue;
    const key = `${event.turnId ?? event.id}:${event.label.trim().toLocaleLowerCase()}`;
    lastDuplicate.set(key, index);
  }
  return events.filter((event, index) => {
    if (event.kind !== "message") return true;
    const key = `${event.turnId ?? event.id}:${event.label.trim().toLocaleLowerCase()}`;
    return lastDuplicate.get(key) === index;
  });
};

export type PendingToolApproval = {
  eventId: string;
  turnId: string;
  threadId: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
};

export type PendingQuestion = {
  eventId: string;
  turnId: string;
  threadId: string;
  toolCallId: string;
  question: string;
  options: string[];
};

export const CREATOR_CANCELLED_QUESTION =
  "The creator cancelled this request. Stop here and make no changes.";

const asideDivider = /\s+(?:—|–|--+)\s+/g;

export const cleanConversationText = (value: string): string =>
  value
    .replace(/[*_`#]/g, "")
    .replace(asideDivider, ". ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .replace(/^["']\s*/, "")
    .trim();

export const cleanQuestionChoice = (value: string): string =>
  cleanConversationText(value.split(/\s+(?:—|–|--+)\s+/, 1)[0] ?? value);

export const cleanCreatorQuestion = (value: string): string =>
  cleanConversationText(
    value
      .replace(/\s*\(scene_[a-z0-9_-]+\)\s*/gi, " ")
      .replace(/\bscene_[a-z0-9_-]+\b/gi, "this scene"),
  );

export const questionDecisionLabel = (answer: string): string =>
  answer === CREATOR_CANCELLED_QUESTION
    ? "Cancelled"
    : cleanQuestionChoice(answer);

export const approvalDecisionLabel = (
  status: "allow" | "deny",
  reason?: string,
): string => {
  if (status === "allow") return "Approved";
  if (!reason || /cancel/i.test(reason)) return "Cancelled";
  return `Requested a revision: ${cleanConversationText(reason)}`;
};

export const creatorDecisionFromTurnInput = (
  input: unknown[] | null | undefined,
): string | null => {
  for (const item of input ?? []) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    if (
      value.type === "user.tool_response" &&
      typeof value.content === "string"
    ) {
      return questionDecisionLabel(value.content);
    }
    if (value.type !== "user.tool_approval") continue;
    const approval = value.approval;
    if (!approval || typeof approval !== "object") continue;
    const decision = approval as Record<string, unknown>;
    if (decision.status === "allow") return "Approved";
    if (decision.status === "deny") {
      return approvalDecisionLabel(
        "deny",
        typeof decision.reason === "string" ? decision.reason : undefined,
      );
    }
  }
  return null;
};

type ProducerSendInput = {
  instruction: string;
  selection: EditorSelection | null;
  references: EditorSelection | null;
  timeline: EditorTimelineContext | null;
  clientEventId?: string;
};

export const createProducerUserMessage = (
  projectId: string,
  input: Pick<
    ProducerSendInput,
    "instruction" | "selection" | "references" | "timeline"
  >,
) => {
  const timelineContext = input.timeline
    ? `\n\nEDITOR_TIMELINE (complete current cut):\n${JSON.stringify(input.timeline)}`
    : "";
  const selectionContext = input.selection
    ? `\n\nEDITOR_SELECTION (current emphasis):\n${JSON.stringify(input.selection)}`
    : "";
  const referenceContext = input.references
    ? `\n\nEDITOR_REFERENCES (explicit creator attachments):\n${JSON.stringify(input.references)}`
    : "";
  return `PROJECT_ID: ${projectId}\n\n${input.instruction}${timelineContext}${selectionContext}${referenceContext}`;
};

type WireEvent = Record<string, unknown> & {
  id?: string;
  type?: string;
};

type TurnDoneState = {
  status?: string;
  output?: unknown;
  message?: unknown;
  reason?: unknown;
  completedAt?: string;
  completed_at?: string;
  metrics?: Record<string, unknown>;
};

const turnDoneState = (event: WireEvent): TurnDoneState | null =>
  event.type === "turn.done" && event.state && typeof event.state === "object"
    ? (event.state as TurnDoneState)
    : null;

const finiteNonNegativeNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

export const turnCostInUsd = (event: WireEvent): number | null => {
  const metrics = turnDoneState(event)?.metrics;
  if (!metrics) return null;
  return finiteNonNegativeNumber(
    metrics.totalCostInUsd ?? metrics.total_cost_in_usd,
  );
};

const eventTimestampMs = (event: WireEvent): number | null => {
  const value = event.createdAt ?? event.created_at;
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const turnDurationMs = (
  createdEvent: WireEvent | null | undefined,
  doneEvent: WireEvent,
): number | null => {
  if (createdEvent?.type !== "turn.created" || doneEvent.type !== "turn.done") {
    return null;
  }
  const startedAt = eventTimestampMs(createdEvent);
  const state = turnDoneState(doneEvent);
  const completedValue = state?.completedAt ?? state?.completed_at;
  const completedAt =
    typeof completedValue === "string"
      ? Date.parse(completedValue)
      : eventTimestampMs(doneEvent);
  if (
    startedAt === null ||
    completedAt === null ||
    !Number.isFinite(completedAt) ||
    completedAt < startedAt
  ) {
    return null;
  }
  return completedAt - startedAt;
};

export const totalSessionCostInUsd = (
  costsByTurn: ReadonlyMap<string, number>,
): number | null => {
  if (costsByTurn.size === 0) return null;
  return [...costsByTurn.values()].reduce((total, cost) => total + cost, 0);
};

export const terminalFailureMessage = (event: WireEvent): string | null => {
  const state = turnDoneState(event);
  if (state?.status === "error") {
    return "The model stopped before replying. Retry this message.";
  }
  if (state?.status === "cancelled") {
    return null;
  }
  return null;
};

const requestFailureMessage = (error: Error) => {
  if (/fetch|network|502|503|connect|proxy/i.test(error.message)) {
    return "AI Producer is offline. Start TrueForge, then retry.";
  }
  return terminalFailureMessage({
    type: "turn.done",
    state: { status: "error" },
  })!;
};

type RestorableTurn = {
  createdAt: string;
  input?: unknown[] | null;
};

export const latestProjectSessionTurn = <Turn extends RestorableTurn>(
  turns: Turn[],
  projectId: string,
): Turn | null => {
  let latest: Turn | null = null;
  let latestProjectMarker: { projectId: string; createdAt: string } | null =
    null;
  for (const turn of turns) {
    if (!latest || turn.createdAt > latest.createdAt) latest = turn;
    const marker = (turn.input ?? []).flatMap((item) => {
      const value = item as Record<string, unknown>;
      if (value.type !== "user.message" || typeof value.content !== "string") {
        return [];
      }
      const match = /^PROJECT_ID:\s*([^\n]+)/.exec(value.content);
      return match?.[1] ? [match[1].trim()] : [];
    })[0];
    if (
      marker &&
      (!latestProjectMarker || turn.createdAt > latestProjectMarker.createdAt)
    ) {
      latestProjectMarker = { projectId: marker, createdAt: turn.createdAt };
    }
  }
  return latestProjectMarker?.projectId === projectId ? latest : null;
};

export type SandboxArtifactReference = {
  name: string;
  path: string;
};

type ImportedSandboxOutput = {
  artifact: Artifact;
  reference: SandboxArtifactReference;
};

type ToolCall = {
  id: string;
  function: { arguments: string; name: string };
};

type ToolCallReference = {
  id: string;
  sourceEventId?: string;
  source_event_id?: string;
};

const trueforge = new TrueForge({
  baseUrl: `${window.location.origin}/trueforge`,
  timeoutInSeconds: 600,
});

const turnSequenceStorageKey = (projectId: string, turnId: string) =>
  `greenlight:producer-sequence:${projectId}:${turnId}`;

const storedTurnSequence = (projectId: string, turnId: string): number => {
  try {
    const value = Number(
      window.localStorage.getItem(turnSequenceStorageKey(projectId, turnId)),
    );
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
};

const storeTurnSequence = (
  projectId: string,
  turnId: string,
  value: string | undefined,
) => {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0) return;
  try {
    window.localStorage.setItem(
      turnSequenceStorageKey(projectId, turnId),
      String(sequence),
    );
  } catch {
    // Event replay still deduplicates safely when storage is unavailable.
  }
};

const clearTurnSequence = (projectId: string, turnId: string) => {
  try {
    window.localStorage.removeItem(turnSequenceStorageKey(projectId, turnId));
  } catch {
    // Stale sequence metadata is harmless because terminal turns are not resumed.
  }
};

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

const turnInputOf = (event: WireEvent): unknown[] =>
  Array.isArray(event.input) ? event.input : [];

const toolCallIdOfInput = (input: Record<string, unknown>): string | null => {
  const value = input.toolCallId ?? input.tool_call_id;
  return typeof value === "string" ? value : null;
};

const visibleCreatorInstruction = (
  content: unknown,
  projectId: string,
): string | null => {
  const message = textContent(content);
  const marker = /^PROJECT_ID:\s*([^\n]+)\n\n/.exec(message);
  if (marker?.[1]?.trim() !== projectId) return null;
  const instruction = message
    .slice(marker[0].length)
    .split(/\n\nEDITOR_(?:TIMELINE|SELECTION|REFERENCES)/)[0]
    ?.trim();
  if (!instruction || instruction.startsWith("GREENLIGHT_ARTIFACT_HANDOFF")) {
    return null;
  }
  return instruction;
};

export const describeTurnInput = (
  event: WireEvent,
  turnId: string,
  projectId: string,
): StudioAgentEvent[] =>
  turnInputOf(event).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const input = candidate as Record<string, unknown>;
    if (input.type === "user.message") {
      const instruction = visibleCreatorInstruction(input.content, projectId);
      return instruction
        ? [
            {
              id: `turn-input-${turnId}-${index}`,
              turnId,
              kind: "instruction" as const,
              label: instruction,
              detail: "",
              sceneIds: [],
              delivery: "sent" as const,
            },
          ]
        : [];
    }
    const decision = creatorDecisionFromTurnInput([input]);
    return decision
      ? [
          {
            id: `turn-input-${turnId}-${index}`,
            turnId,
            kind: "instruction" as const,
            label: decision,
            detail: "",
            sceneIds: [],
            delivery: "sent" as const,
          },
        ]
      : [];
  });

const resolvedToolCallIds = (event: WireEvent): string[] =>
  turnInputOf(event).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const input = candidate as Record<string, unknown>;
    if (
      input.type !== "user.tool_approval" &&
      input.type !== "user.tool_response"
    ) {
      return [];
    }
    const toolCallId = toolCallIdOfInput(input);
    return toolCallId ? [toolCallId] : [];
  });

export const parseSandboxArtifactReferences = (
  content: unknown,
): SandboxArtifactReference[] => {
  const text = textContent(content);
  const references: SandboxArtifactReference[] = [];
  const seen = new Set<string>();
  for (const block of text.matchAll(
    /```sandbox_artifacts\s*\n([\s\S]*?)```/g,
  )) {
    const body = block[1] ?? "";
    for (const link of body.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
      const label = link[1]?.trim() ?? "";
      const path = link[2]?.trim() ?? "";
      if (!label || !path.startsWith("/") || seen.has(path)) continue;
      const pathName = path.split("/").at(-1) ?? "";
      const name = /\.[a-z0-9]{2,8}$/i.test(label) ? label : pathName || label;
      seen.add(path);
      references.push({ name, path });
    }
  }
  return references;
};

const artifactHandoffMessage = (
  projectId: string,
  outputs: ImportedSandboxOutput[],
) =>
  `PROJECT_ID: ${projectId}\n\nGREENLIGHT_ARTIFACT_HANDOFF (internal):\n${JSON.stringify(
    outputs.map(({ artifact, reference }) => ({
      artifact_id: artifact.id,
      kind: artifact.kind,
      label: reference.name,
    })),
  )}\n\nUse these immutable artifact IDs to finish the pending edit. Do not emit the same sandbox files again.`;

const toolCallsOf = (event: WireEvent): ToolCall[] => {
  const value = event.toolCalls ?? event.tool_calls;
  return Array.isArray(value) ? (value as ToolCall[]) : [];
};

const toolCallReferencesOf = (event: WireEvent): ToolCallReference[] => {
  const value = event.toolCalls ?? event.tool_calls;
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      !("id" in candidate) ||
      typeof candidate.id !== "string"
    ) {
      return [];
    }
    const reference = candidate as Record<string, unknown>;
    return [
      {
        id: candidate.id,
        ...(typeof reference.sourceEventId === "string"
          ? { sourceEventId: reference.sourceEventId }
          : {}),
        ...(typeof reference.source_event_id === "string"
          ? { source_event_id: reference.source_event_id }
          : {}),
      },
    ];
  });
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
  turnId: string,
): PendingQuestion[] => {
  if (event.type !== "tool.response_required") return [];
  return toolCallReferencesOf(event).flatMap((reference) => {
    const sourceId = reference.sourceEventId ?? reference.source_event_id;
    const source = sourceId ? sources.get(sourceId) : undefined;
    const call = source
      ? toolCallsOf(source).find((candidate) => candidate.id === reference.id)
      : undefined;
    if (!call || call.function.name !== "ask_user_question") return [];
    const args = parseArguments(call);
    const question =
      typeof args.question === "string"
        ? cleanCreatorQuestion(args.question)
        : "";
    if (!question) return [];
    return [
      {
        eventId: String(event.id ?? crypto.randomUUID()),
        turnId,
        threadId: String(event.threadId ?? event.thread_id ?? "main"),
        toolCallId: call.id,
        question,
        options: Array.isArray(args.options)
          ? args.options
              .filter((option): option is string => typeof option === "string")
              .map(cleanQuestionChoice)
              .filter(Boolean)
          : [],
      },
    ];
  });
};

const selectionSceneIds = (args: Record<string, unknown>) =>
  args.selection && typeof args.selection === "object"
    ? ((args.selection as { scene_ids?: string[] }).scene_ids ?? [])
    : [];

type ResolvedToolCall = {
  id: string;
  name: string;
  server: string | null;
  arguments: Record<string, unknown>;
};

const resolvedToolCall = (call: ToolCall): ResolvedToolCall => {
  const outer = parseArguments(call);
  if (call.function.name === "call_tool") {
    const delegatedName =
      typeof outer.tool_name === "string"
        ? outer.tool_name
        : typeof outer.toolName === "string"
          ? outer.toolName
          : typeof outer.name === "string"
            ? outer.name
            : "unknown_tool";
    return {
      id: call.id,
      name: delegatedName,
      server: typeof outer.mcp_server === "string" ? outer.mcp_server : null,
      arguments:
        outer.input && typeof outer.input === "object"
          ? (outer.input as Record<string, unknown>)
          : {},
    };
  }
  const greenlightTools = new Set([
    "create_project",
    "get_project",
    "get_artifact",
    "get_media_capabilities",
    "search_media_library",
    "import_media_library_asset",
    "save_evidence_ledger",
    "search_openmoji",
    "attach_openmoji",
    "generate_sound_effect",
    "save_content_package",
    "apply_editor_patch",
    "focus_editor_selection",
    "generate_voice",
    "transcribe_audio",
    "correct_transcript",
    "generate_image",
    "render_video",
    "run_quality_checks",
    "stage_video_unlisted",
    "publish_video",
    "schedule_video",
    "update_production_plan",
  ]);
  const exaTools = new Set(["search", "get_contents"]);
  return {
    id: call.id,
    name: call.function.name,
    server: greenlightTools.has(call.function.name)
      ? "greenlight"
      : exaTools.has(call.function.name)
        ? "exa"
        : null,
    arguments: outer,
  };
};

const toolDetail = (server: string | null): string =>
  server
    ? `${server === "greenlight" ? "Greenlight" : server} MCP`
    : "TrueForge";

const completedToolLabel = (name: string, current: string): string => {
  const labels: Record<string, string> = {
    apply_editor_patch: "Applied the editor change",
    render_video: "Rendered the finished cut",
    run_quality_checks: "Checked the finished cut",
  };
  return labels[name] ?? current;
};

export const toolResponseFailure = (event: WireEvent): string | null => {
  if (event.type !== "tool.response") return null;
  const explicitlyFailed = event.isError === true || event.is_error === true;
  let errorText = "";
  if (typeof event.content === "string") {
    try {
      const parsed = JSON.parse(event.content) as Record<string, unknown>;
      if (parsed.error) errorText = JSON.stringify(parsed.error);
    } catch {
      if (explicitlyFailed) errorText = event.content;
    }
  }
  if (!explicitlyFailed && !errorText) return null;
  if (/outside_selection/i.test(errorText)) {
    return "The preview did not include its complete scope.";
  }
  if (/base_content_package|revision|stale/i.test(errorText)) {
    return "The production changed before this action could run.";
  }
  if (/denied|cancel/i.test(errorText)) {
    return "The creator stopped this action.";
  }
  if (/input validation error/i.test(errorText)) {
    return "One detail needed a correction before this step could be saved.";
  }
  return "This action did not complete.";
};

const failedToolLabel = (name: string): string => {
  if (name === "apply_editor_patch") return "Editor change was rejected";
  if (name === "render_video") return "Render did not complete";
  if (name === "save_evidence_ledger") return "Adjusted the source record";
  return "Action did not complete";
};

const toolPresentation = (
  call: ToolCall,
): Omit<StudioAgentEvent, "id"> | null => {
  const resolved = resolvedToolCall(call);
  const { arguments: args, name, server } = resolved;
  const sceneIds = selectionSceneIds(args);
  if (name === "update_production_plan") {
    const steps = Array.isArray(args.steps)
      ? args.steps.flatMap((candidate) => {
          if (!candidate || typeof candidate !== "object") return [];
          const step = candidate as Record<string, unknown>;
          const status = step.status;
          if (
            typeof step.id !== "string" ||
            typeof step.label !== "string" ||
            (status !== "pending" &&
              status !== "in_progress" &&
              status !== "completed" &&
              status !== "blocked")
          ) {
            return [];
          }
          return [
            {
              id: step.id,
              label: step.label,
              status: status as
                "pending" | "in_progress" | "completed" | "blocked",
            },
          ];
        })
      : [];
    const blocked = steps.some((step) => step.status === "blocked");
    const completed =
      steps.length > 0 && steps.every((step) => step.status === "completed");
    return {
      kind: "plan",
      label: typeof args.title === "string" ? args.title : "Production plan",
      detail: "",
      sceneIds: [],
      status: blocked ? "error" : completed ? "done" : "running",
      plan: {
        title: typeof args.title === "string" ? args.title : "Production plan",
        steps,
      },
    };
  }
  const presentations: Record<
    string,
    { kind: StudioAgentEvent["kind"]; label: string; detail?: string }
  > = {
    create_project: { kind: "artifact", label: "Created the production" },
    get_project: { kind: "tool", label: "Read the current production" },
    get_artifact: { kind: "tool", label: "Read managed media" },
    get_media_capabilities: {
      kind: "tool",
      label: "Checked production capabilities",
    },
    search_media_library: {
      kind: "tool",
      label:
        args.use === "music"
          ? "Searched licensed music"
          : args.use === "sound_effect"
            ? "Searched licensed sound effects"
            : "Searched licensed B-roll",
    },
    import_media_library_asset: {
      kind: "artifact",
      label:
        args.use === "music"
          ? "Imported licensed music"
          : args.use === "sound_effect"
            ? "Imported a licensed sound effect"
            : "Imported licensed B-roll",
    },
    save_evidence_ledger: {
      kind: "artifact",
      label: "Updated the source record",
      detail: `${Array.isArray(args.claims) ? args.claims.length : 0} supported claims kept`,
    },
    search_openmoji: { kind: "tool", label: "Searched OpenMoji visuals" },
    attach_openmoji: { kind: "artifact", label: "Attached an OpenMoji visual" },
    generate_sound_effect: {
      kind: "artifact",
      label: "Generated a sound-effect preview",
    },
    save_content_package: { kind: "artifact", label: "Saved the storyboard" },
    apply_editor_patch: { kind: "tool", label: "Prepared an editor change" },
    focus_editor_selection: {
      kind: "tool",
      label: "Focused the referenced edit",
    },
    generate_voice: { kind: "artifact", label: "Created the voice track" },
    transcribe_audio: { kind: "artifact", label: "Timed every spoken word" },
    correct_transcript: { kind: "artifact", label: "Corrected the transcript" },
    generate_image: { kind: "artifact", label: "Created a visual" },
    render_video: { kind: "artifact", label: "Prepared the final render" },
    run_quality_checks: { kind: "tool", label: "Checked the finished cut" },
    stage_video_unlisted: {
      kind: "artifact",
      label: "Uploaded the video for review",
    },
    publish_video: { kind: "artifact", label: "Published the video" },
    schedule_video: { kind: "artifact", label: "Scheduled the video" },
    search: { kind: "tool", label: "Searched current sources" },
    get_contents: { kind: "tool", label: "Read source pages" },
    get_current_datetime: {
      kind: "tool",
      label: "Checked source freshness",
    },
  };
  if (name === "save_evidence_ledger") {
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
      status: "running",
      tool: { callId: resolved.id, name, server },
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
  if (name === "save_content_package") {
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
      status: "running",
      tool: { callId: resolved.id, name, server },
      document: {
        title: String(args.headline ?? "Storyboard"),
        subtitle: String(args.dek ?? "Script, scenes, and release copy"),
        sections: [
          {
            title: "Scenes",
            lines: scenes.map((scene, index) => {
              const title = String(scene.title ?? `Scene ${index + 1}`);
              const narration = String(scene.narration ?? "");
              return `${index + 1}. ${title}${narration ? `: ${narration}` : ""}`;
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
  const presentation = presentations[name];
  return presentation
    ? {
        ...presentation,
        detail: presentation.detail ?? toolDetail(server),
        sceneIds,
        status: "running",
        tool: { callId: resolved.id, name, server },
      }
    : null;
};

const eventThreadId = (event: WireEvent): string | null => {
  const value = event.threadId ?? event.thread_id;
  return typeof value === "string" ? value : null;
};

const subagentInfo = (event: WireEvent) => {
  const value = event.agentInfo ?? event.agent_info;
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
};

const creatorFacingSubagentTitle = (value: string): string => {
  const title = cleanConversationText(value);
  if (/current head|head lookup|get project|project state/i.test(title)) {
    return "Reviewing the current edit";
  }
  return title || "Background work";
};

const creatorFacingSubagentBrief = (value: string): string => {
  const brief = cleanConversationText(value);
  return brief.length > 180 ||
    /^(?:you are|your task|project context|instructions?|deliverable)\b/i.test(
      brief,
    ) ||
    /(?:project[_-][a-z0-9]+|artifact[_-][a-z0-9]+|mcp|tool|content.?package|host path|credentials?|environment variables?|code.?mode)/i.test(
      brief,
    )
    ? ""
    : brief;
};

const subagentToolLabel = (call: ToolCall): string | null => {
  const resolved = resolvedToolCall(call);
  const toolName = resolved.name;
  if (toolName === "unknown_tool") return null;
  const rawSubject = [
    resolved.arguments.query,
    resolved.arguments.q,
    resolved.arguments.url,
    resolved.arguments.topic,
  ].find((value): value is string => typeof value === "string");
  const subject = rawSubject
    ? cleanConversationText(rawSubject).replace(/^https?:\/\/(?:www\.)?/, "")
    : "";
  const withSubject = (label: string) =>
    subject && subject.length <= 110 ? `${label} · ${subject}` : label;
  if (/get_current_datetime/i.test(toolName)) return "Checked source freshness";
  if (/search|exa/i.test(toolName)) return withSubject("Searching the web");
  if (/crawl|fetch|read|contents?/i.test(toolName))
    return withSubject("Reading a source");
  if (/evidence|claim|source/i.test(toolName)) return "Organizing findings";
  if (/script|story|content_package/i.test(toolName))
    return "Shaping the draft";
  if (/get_project/i.test(toolName)) return "Reading the current project";
  if (/^(?:get_tool_info|get_tool_output_schema|list_tools)$/i.test(toolName)) {
    return null;
  }
  if (/^exec$/i.test(toolName)) return "Analyzing the findings";
  return cleanConversationText(toolName.replaceAll("_", " "));
};

const subagentResult = (event: WireEvent): string => {
  const state =
    event.state && typeof event.state === "object"
      ? (event.state as Record<string, unknown>)
      : null;
  const output =
    state?.output && typeof state.output === "object"
      ? (state.output as Record<string, unknown>)
      : null;
  const result = textContent(output?.content)
    .replace(/```(?:markdown|md)?/gi, "")
    .replace(/```/g, "")
    .replace(/^\s*-{3,}\s*$/gm, "")
    .replace(/^\s*\.\.\.\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 12_000);
  return /(?:project[_-][a-z0-9]+|artifact[_-][a-z0-9]+|content.?package|tool|mcp|host path|credentials?|environment variables?)/i.test(
    result,
  )
    ? ""
    : result;
};

const cleanDocumentLine = (value: string): string =>
  cleanConversationText(
    value
      .replace(/\bclaim_[a-z0-9_-]+\b\s*,?/gi, "")
      .replace(/\bclaims?:\s*(?:,\s*)*/gi, "")
      .replace(/^\s*[•·]\s*/, "")
      .replace(/\s*[•·]\s*$/g, ""),
  );

const titleCaseDocumentHeading = (value: string): string => {
  const clean = cleanDocumentLine(value);
  return clean === clean.toLocaleUpperCase()
    ? clean
        .toLocaleLowerCase()
        .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())
    : clean;
};

const scriptField = (block: string, label: string): string => {
  const match = new RegExp(
    `(?:\\*\\*)?${label}:(?:\\*\\*)?\\s*([\\s\\S]*?)(?=\\s*(?:[•·]\\s*)?(?:\\*\\*)?(?:Narration|Duration|Claims?|Visual(?: detail)?|Summary):|$)`,
    "i",
  ).exec(block);
  const raw = (match?.[1] ?? "")
    .trim()
    .replace(/^\*+|\*+$/g, "")
    .trim();
  const wrapped = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
  ].find(
    ([opening, closing]) => raw.startsWith(opening!) && raw.endsWith(closing!),
  );
  return cleanDocumentLine(wrapped ? raw.slice(1, -1).trim() : raw);
};

export const scriptReviewDocument = (
  title: string,
  result: string,
): StudioReviewDocument | undefined => {
  if (!result || !/script|chapter|story|outline/i.test(title)) return undefined;
  const blocks = result
    .replace(/```(?:markdown|md)?/gi, "")
    .replace(/```/g, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(
      (block) =>
        Boolean(block) &&
        !/^-{3,}$/.test(block) &&
        !/^part\s+\d+\s*(?:—|–|-).*script/i.test(cleanDocumentLine(block)),
    );
  const sceneSections = blocks.flatMap((block) => {
    const timedScene =
      /^\s*\*{0,2}(\d+)\.\s*([^\n(]+?)\s*\(([^)]+)\)\*{0,2}\s*(?:—|–|-)?\s*([\s\S]*)$/i.exec(
        block,
      );
    const titledScene =
      /^\s*#{0,6}\s*\*{0,2}(\d+)\.\s*[A-Z][A-Z\s]*\s*[·—–:-]\s*["“]?([^"”\n]+)["”]?\*{0,2}\s*([\s\S]*)$/i.exec(
        block,
      );
    if (!timedScene && !titledScene) return [];
    const number = timedScene?.[1] ?? titledScene?.[1] ?? "";
    const title = timedScene?.[2] ?? titledScene?.[2] ?? "Scene";
    const body = timedScene?.[4] ?? titledScene?.[3] ?? "";
    const duration = timedScene?.[3] ?? scriptField(body, "Duration");
    const narration = scriptField(body, "Narration");
    const visual =
      scriptField(body, "Visual detail") || scriptField(body, "Visual");
    const lines = [
      narration ? `Narration · ${narration}` : "",
      visual ? `Visual · ${visual}` : "",
    ].filter(Boolean);
    return [
      {
        title: [
          number,
          titleCaseDocumentHeading(title)
            .replace(/^["“]|["”]$/g, "")
            .replace(/\bCta\b/g, "CTA"),
          cleanDocumentLine(duration),
        ]
          .filter(Boolean)
          .join(" · "),
        lines,
      },
    ];
  });
  const summary = blocks
    .map((block) => scriptField(block, "Summary"))
    .find(Boolean);
  const fallbackLines = blocks.map(cleanDocumentLine).filter(Boolean);
  return {
    title: "Script draft",
    subtitle: "Review the chapters and wording before production starts",
    sections:
      sceneSections.length > 0
        ? [
            ...sceneSections,
            ...(summary ? [{ title: "Overview", lines: [summary] }] : []),
          ]
        : [{ title: titleCaseDocumentHeading(title), lines: fallbackLines }],
  };
};

const describeSubagentEvent = (event: WireEvent): StudioAgentEvent[] | null => {
  const type = String(event.type ?? "");
  const threadId = eventThreadId(event);

  if (type === "thread.created") {
    const childThreadId = String(threadId ?? event.id ?? "");
    const info = subagentInfo(event);
    const title = creatorFacingSubagentTitle(
      String(event.title ?? info?.name ?? "Subagent"),
    );
    return [
      {
        id: `subagent-${childThreadId}`,
        kind: "subagent",
        label: title,
        detail: "Working",
        sceneIds: [],
        status: "running",
        subagent: {
          threadId: childThreadId,
          brief: creatorFacingSubagentBrief(String(info?.input ?? "")),
          steps: [],
          result: "",
        },
      },
    ];
  }

  if (!threadId || threadId === "main") return null;

  if (type === "model.message") {
    const steps = toolCallsOf(event).flatMap((call) => {
      const label = subagentToolLabel(call);
      return label ? [{ id: call.id, label, status: "running" as const }] : [];
    });
    return steps.length > 0
      ? [
          {
            id: `subagent-${threadId}`,
            kind: "subagent",
            label: "Subagent",
            detail: steps.at(-1)?.label ?? "Working",
            sceneIds: [],
            status: "running",
            subagent: { threadId, brief: "", steps, result: "" },
          },
        ]
      : [];
  }

  if (type === "tool.response") {
    const callId = String(
      event.tool_call_id ?? event.toolCallId ?? event.id ?? "",
    );
    return callId
      ? [
          {
            id: `subagent-${threadId}`,
            kind: "subagent",
            label: "Subagent",
            detail: "Working",
            sceneIds: [],
            status: "running",
            subagent: {
              threadId,
              brief: "",
              steps: [{ id: callId, label: "", status: "done" }],
              result: "",
            },
          },
        ]
      : [];
  }

  if (type === "thread.done") {
    const title = creatorFacingSubagentTitle(String(event.title ?? "Subagent"));
    const state =
      event.state && typeof event.state === "object"
        ? (event.state as Record<string, unknown>)
        : null;
    const failed = state?.status === "error";
    const result = subagentResult(event);
    return [
      {
        id: `subagent-${threadId}`,
        kind: "subagent",
        label: title,
        detail: failed ? "Stopped" : "Done",
        sceneIds: [],
        status: failed ? "error" : "done",
        subagent: {
          threadId,
          brief: "",
          steps: [],
          result:
            failed && !result
              ? "This branch stopped before returning findings."
              : result,
        },
        document: scriptReviewDocument(title, result),
      },
    ];
  }

  return [];
};

const creatorFacingSentence = (value: string): string | null => {
  const content = cleanConversationText(value);
  if (!content) return null;
  if (
    /\b(?:sandbox|code mode|proxy error|pydantic|mcp tools?|tool protocol|tools? greenlight exposes|configured adapter|use=music|generate_?voice|transcribe_?audio|content package|artifact ids?|scene ids?|schemas?|strict-check|frame-grid|frame rate|30\s?fps|rounded display|capabilities are wired|jq|on path|the id just needs|technical anchor)\b/i.test(
      content,
    )
  ) {
    return null;
  }
  if (
    /^(?:the )?project state is large\.?$/i.test(content) ||
    /^\d+(?:\.\d+)?s across \d+ scenes?\.?$/i.test(content) ||
    /^the package is (?:intact|corrected|intact and corrected)\.?$/i.test(
      content,
    )
  ) {
    return null;
  }
  if (/^(done|patch applied successfully)\.?$/i.test(content)) {
    return "Change applied.";
  }
  if (
    /patch (?:was )?(?:cancelled|canceled|not applied)|no changes were made|stopped,? no changes|cancelled again/i.test(
      content,
    )
  ) {
    return null;
  }
  if (/^(?:yes|confirmed)\b.*\bcurrent cut\b/i.test(content)) {
    return "Yes. I can see the current cut.";
  }
  if (/^frame math\b|durations? must align/i.test(content)) return null;
  if (/\buser cancelled (?:the )?research subagents?\b/i.test(content)) {
    return null;
  }
  const sentences =
    content
      .match(/[^.!?]+[.!?](?:\s|$)|[^.!?]+$/g)
      ?.map((sentence) => sentence.trim()) ?? [];
  return (
    sentences.find(
      (sentence) =>
        sentence.length <= 180 &&
        /[A-Za-z]{3}/.test(sentence) &&
        /^[A-Za-z0-9]/.test(sentence) &&
        !/[|`]/.test(sentence) &&
        !/:\s*\d+\.$/.test(sentence) &&
        !/^(?:scene|clip|track)\s+\d+\b/i.test(sentence) &&
        !/^#{1,6}\s/.test(sentence) &&
        !/(?:\bartifact[_-]?[a-z0-9]+|\bartifact ids?|\bscene_[a-z0-9_-]+|\bscene ids?|schemas?|strict-check|frame math|frame-grid|frame multiples|frames? \d|rounded display|project state is large|^\d+(?:\.\d+)?s across \d+ scenes?|package is (?:intact|corrected)|corrected payload|gapafter|base_content_package|content_package_artifact|sha256|current revision)/i.test(
          sentence,
        ) &&
        !/^(got it|on it|understood|okay|let me|i(?:'ll| will| now)|now i|first[, ]|to begin)/i.test(
          sentence,
        ),
    ) ?? null
  );
};

export const describeEvent = (
  event: WireEvent,
  context: { durationMs?: number; turnId?: string } = {},
): StudioAgentEvent[] => {
  const type = String(event.type ?? "agent.event");
  const childEvent = describeSubagentEvent(event);
  if (childEvent) return childEvent;
  if (type === "agent.context.overwrite" && event.reason === "compaction") {
    return [
      {
        id: String(event.id ?? crypto.randomUUID()),
        kind: "system",
        label: "Context compacted",
        detail: "Earlier messages remain available in this history.",
        sceneIds: [],
      },
    ];
  }
  if (type === "turn.done") {
    const failure = terminalFailureMessage(event);
    return failure
      ? [
          {
            id: String(event.id ?? crypto.randomUUID()),
            kind: "message",
            label: failure,
            detail: "",
            sceneIds: [],
          },
        ]
      : [];
  }
  if (type === "model.message") {
    const output: StudioAgentEvent[] = [];
    const calls = toolCallsOf(event);
    for (const call of calls) {
      const presentation = toolPresentation(call);
      if (presentation) {
        const resolved = resolvedToolCall(call);
        const planId =
          resolved.name === "update_production_plan" &&
          typeof resolved.arguments.plan_id === "string"
            ? resolved.arguments.plan_id
            : null;
        output.push({
          id: planId ? `production-plan-${planId}` : call.id,
          ...presentation,
        });
      }
    }
    const humanSentence = creatorFacingSentence(textContent(event.content));
    const onlyCreatorQuestions =
      calls.length > 0 &&
      calls.every(
        (call) => resolvedToolCall(call).name === "ask_user_question",
      );
    if (humanSentence && (calls.length === 0 || onlyCreatorQuestions)) {
      output.push({
        id: String(event.id ?? crypto.randomUUID()),
        kind: "message",
        label: humanSentence,
        detail: "",
        sceneIds: [],
        ...(context.durationMs === undefined
          ? {}
          : { durationMs: context.durationMs }),
      });
    }
    return output;
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
  const toolCallStore = useRef(new Map<string, ToolCall>());
  const turnCreatedEvents = useRef(new Map<string, WireEvent>());
  const turnCostsInUsd = useRef(new Map<string, number>());
  const outgoingStore = useRef(new Map<string, ProducerSendInput>());
  const [events, setEvents] = useState<StudioAgentEvent[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<
    PendingToolApproval[]
  >([]);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestion[]>(
    [],
  );
  const [activity, setActivity] = useState<string | null>(null);
  const [sessionCostInUsd, setSessionCostInUsd] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  const appendEvents = useCallback((described: StudioAgentEvent[]) => {
    if (described.length === 0) return;
    setEvents((current) => appendUniqueStudioEvents(current, described));
  }, []);

  const ingest = useCallback(
    (
      incoming: WireEvent,
      sourceTurnId: string | null,
      options: { historical?: boolean } = {},
    ) => {
      let event = incoming;
      const terminal = turnDoneState(incoming);
      let durationMs: number | undefined;
      if (sourceTurnId && incoming.type === "turn.created") {
        turnCreatedEvents.current.set(sourceTurnId, incoming);
        setEvents((current) => {
          let attachAt = -1;
          for (let index = current.length - 1; index >= 0; index -= 1) {
            const item = current[index];
            if (
              item?.kind === "instruction" &&
              !item.turnId &&
              item.delivery === "sending"
            ) {
              attachAt = index;
              break;
            }
          }
          return attachAt < 0
            ? current
            : current.map((item, index) =>
                index === attachAt ? { ...item, turnId: sourceTurnId } : item,
              );
        });
      }
      if (terminal) {
        setActivity(null);
        if (sourceTurnId) {
          const measuredDuration = turnDurationMs(
            turnCreatedEvents.current.get(sourceTurnId),
            incoming,
          );
          if (measuredDuration !== null) durationMs = measuredDuration;
          const reportedCost = turnCostInUsd(incoming);
          if (reportedCost !== null) {
            turnCostsInUsd.current.set(sourceTurnId, reportedCost);
            setSessionCostInUsd(totalSessionCostInUsd(turnCostsInUsd.current));
          }
        }
        if (
          terminal.status === "done" &&
          terminal.output &&
          typeof terminal.output === "object"
        ) {
          event = terminal.output as WireEvent;
        }
      }
      if (incoming.type === "model.message.delta") {
        const base = incoming.id
          ? eventStore.current.get(incoming.id)
          : undefined;
        if (base) mergeEventDelta(base as never, incoming as never);
        if (!(incoming.finishReason ?? incoming.finish_reason) || !base) {
          return null;
        }
        event = base;
      }
      if (event.id) eventStore.current.set(event.id, event);

      if (event.type === "model.message") {
        for (const call of toolCallsOf(event)) {
          toolCallStore.current.set(call.id, call);
        }
      }

      if (event.type === "tool.response") {
        const toolCallId = event.toolCallId ?? event.tool_call_id;
        if (typeof toolCallId === "string") {
          const failure = toolResponseFailure(event);
          setEvents((current) =>
            current.map((item) =>
              item.tool?.callId === toolCallId
                ? failure
                  ? {
                      ...item,
                      label: failedToolLabel(item.tool.name),
                      detail: failure,
                      status: "error" as const,
                    }
                  : {
                      ...item,
                      label: completedToolLabel(item.tool.name, item.label),
                      status: "done" as const,
                    }
                : item,
            ),
          );
        }
      }

      if (event.type === "turn.created") {
        const resolved = new Set(resolvedToolCallIds(event));
        for (const input of turnInputOf(event)) {
          if (!input || typeof input !== "object") continue;
          const decisionInput = input as Record<string, unknown>;
          if (
            decisionInput.type === "user.tool_response" &&
            typeof decisionInput.content === "string"
          ) {
            const toolCallId = toolCallIdOfInput(decisionInput);
            if (toolCallId) {
              const answer = questionDecisionLabel(decisionInput.content);
              setEvents((current) =>
                current.map((item) =>
                  item.id === `question-${toolCallId}` && item.question
                    ? {
                        ...item,
                        question: { ...item.question, answer },
                      }
                    : item,
                ),
              );
            }
            continue;
          }
          if (decisionInput.type !== "user.tool_approval") continue;
          const toolCallId = toolCallIdOfInput(decisionInput);
          const approval =
            decisionInput.approval && typeof decisionInput.approval === "object"
              ? (decisionInput.approval as Record<string, unknown>)
              : null;
          const status = approval?.status;
          if (!toolCallId || (status !== "allow" && status !== "deny")) {
            continue;
          }
          const reason =
            typeof approval?.reason === "string" ? approval.reason : undefined;
          setEvents((current) =>
            current.map((item) =>
              item.id === `approval-${toolCallId}` && item.approval
                ? {
                    ...item,
                    approval: {
                      ...item.approval,
                      decision: {
                        status,
                        label: approvalDecisionLabel(status, reason),
                        ...(reason ? { reason } : {}),
                      },
                    },
                  }
                : item,
            ),
          );
        }
        if (resolved.size > 0) {
          setPendingApprovals((current) =>
            current.filter((item) => !resolved.has(item.toolCallId)),
          );
          setPendingQuestions((current) =>
            current.filter((item) => !resolved.has(item.toolCallId)),
          );
        }
      }

      if (
        event.type === "model.message" &&
        !event.content &&
        !event.reasoningContent &&
        !event.reasoning_content &&
        toolCallsOf(event).length === 0
      ) {
        return null;
      }

      if (event.type === "model.message" && !options.historical) {
        for (const call of toolCallsOf(event)) {
          const resolved = resolvedToolCall(call);
          const nextActivity: Record<string, string> = {
            get_project: "Checking the current cut…",
            get_artifact: "Reading the selected media…",
            apply_editor_patch: "Preparing the preview…",
            transcribe_audio: "Timing the words…",
            generate_voice: "Generating the voice…",
            generate_image: "Creating the visual…",
            render_video: "Rendering the video…",
            search_media_library: "Searching licensed media…",
            import_media_library_asset: "Importing licensed media…",
            run_quality_checks: "Checking the finished cut…",
          };
          setActivity(nextActivity[resolved.name] ?? "Working…");
          if (resolved.name !== "focus_editor_selection") continue;
          const parsed = editorFocusInputSchema.safeParse(resolved.arguments);
          if (parsed.success) onFocusRef.current(parsed.data);
        }
      }

      if (
        event.type === "tool.approval_required" ||
        event.type === "tool.response_required"
      ) {
        if (!sourceTurnId) return event;
        const resolved = toolCallReferencesOf(event).flatMap((reference) => {
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
          setActivity(null);
          const approvals = resolved.map(({ call }) => {
            const tool = resolvedToolCall(call);
            return {
              eventId: String(event.id ?? crypto.randomUUID()),
              turnId: sourceTurnId,
              threadId: String(event.threadId ?? event.thread_id ?? "main"),
              toolCallId: call.id,
              toolName: tool.name,
              arguments: tool.arguments,
            };
          });
          appendEvents(
            approvals.map((pending) => ({
              id: `approval-${pending.toolCallId}`,
              turnId: sourceTurnId,
              kind: "approval" as const,
              label: "Review before continuing",
              detail: "",
              sceneIds: [],
              approval: { pending },
            })),
          );
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
          setActivity(null);
          const questions = pendingQuestionsFromEvent(
            event,
            eventStore.current,
            sourceTurnId,
          );
          appendEvents(
            questions.map((pending) => ({
              id: `question-${pending.toolCallId}`,
              turnId: sourceTurnId,
              kind: "question" as const,
              label: "Creator input required",
              detail: "",
              sceneIds: [],
              question: { pending },
            })),
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

      appendEvents(
        describeEvent(event, {
          durationMs,
          ...(sourceTurnId ? { turnId: sourceTurnId } : {}),
        }).map((described) => ({
          ...described,
          ...(sourceTurnId ? { turnId: sourceTurnId } : {}),
        })),
      );
      return event;
    },
    [appendEvents],
  );

  const replaySessionHistory = useCallback(
    async (historySessionId: string, historyProjectId: string) => {
      const page = await trueforge.sessions.listEvents(historySessionId, {
        limit: 100,
      });
      const history: Array<{ turnId: string; event: WireEvent }> = [];
      for await (const item of page) {
        history.push({
          turnId: item.turnId,
          event: item.event as unknown as WireEvent,
        });
      }
      history.reverse();
      if (activeProjectId.current !== historyProjectId) return [];

      eventStore.current.clear();
      toolCallStore.current.clear();
      turnCreatedEvents.current.clear();
      turnCostsInUsd.current.clear();
      setEvents([]);
      setPendingApprovals([]);
      setPendingQuestions([]);
      setSessionCostInUsd(null);
      for (const item of history) {
        if (item.event.type === "turn.created") {
          appendEvents(
            describeTurnInput(item.event, item.turnId, historyProjectId),
          );
        }
        ingest(item.event, item.turnId, { historical: true });
      }
      return history;
    },
    [appendEvents, ingest],
  );

  const importSandboxOutputs = useCallback(
    async (
      outputSessionId: string,
      turnId: string,
      references: SandboxArtifactReference[],
      outputProjectId: string,
    ) => {
      if (references.length === 0) return [];
      const detail = await greenlightApi.getProject(outputProjectId);
      const uniqueReferences = Array.from(
        new Map(
          references.map((reference) => [reference.path, reference]),
        ).values(),
      );
      const pending = uniqueReferences.filter(
        (reference) =>
          !detail.artifacts.some(
            (artifact) =>
              artifact.provenance.trueforge_session_id === outputSessionId &&
              artifact.provenance.trueforge_turn_id === turnId &&
              artifact.provenance.sandbox_path === reference.path,
          ),
      );
      const imported: ImportedSandboxOutput[] = [];
      for (const reference of pending) {
        try {
          const binary = await trueforge.sessions.downloadSandboxFile(
            outputSessionId,
            turnId,
            { path: reference.path },
          );
          const blob = await binary.blob();
          const file = new File([blob], reference.name, {
            type: blob.type || "application/octet-stream",
          });
          const artifact = await greenlightApi.uploadSandboxAsset(
            outputProjectId,
            file,
            {
              path: reference.path,
              sessionId: outputSessionId,
              turnId,
            },
          );
          imported.push({ artifact, reference });
          appendEvents([
            {
              id: `sandbox-import-${artifact.id}`,
              kind: "artifact",
              label: `Created ${reference.name}`,
              detail: "Ready for this edit",
              sceneIds: [],
              artifactId: artifact.id,
            },
          ]);
        } catch (error) {
          appendEvents([
            {
              id: `sandbox-import-error-${turnId}-${reference.path}`,
              kind: "message",
              label: `Couldn’t add ${reference.name}`,
              detail:
                error instanceof Error
                  ? error.message.replaceAll("_", " ")
                  : "Sandbox output import failed",
              sceneIds: [],
            },
          ]);
        }
      }
      if (imported.length > 0) {
        await queryClient.invalidateQueries({
          queryKey: greenlightKeys.project(outputProjectId),
        });
      }
      return imported;
    },
    [appendEvents, queryClient],
  );

  const consume = useCallback(
    async (
      initialStream: Awaited<
        ReturnType<typeof trueforge.sessions.createTurnStream>
      >,
      streamProjectId: string,
      initialTurnId: string | null = null,
    ) => {
      let stream = initialStream;
      for (let handoff = 0; handoff < 4; handoff += 1) {
        let turnId: string | null = handoff === 0 ? initialTurnId : null;
        let sawTerminalEvent = false;
        const references: SandboxArtifactReference[] = [];
        for await (const envelope of stream.withMetadata()) {
          if (activeProjectId.current !== streamProjectId) return;
          const incoming = envelope.data as unknown as WireEvent;
          if (incoming.type === "turn.done") sawTerminalEvent = true;
          const terminalFailure = terminalFailureMessage(incoming);
          if (terminalFailure) throw new Error(terminalFailure);
          if (incoming.type === "turn.created") {
            turnId = String(incoming.turnId ?? incoming.turn_id ?? "") || null;
          }
          if (turnId) {
            storeTurnSequence(streamProjectId, turnId, envelope.id);
            if (incoming.type === "turn.done") {
              clearTurnSequence(streamProjectId, turnId);
            }
          }
          const event = ingest(incoming, turnId);
          if (!event) continue;
          if (event.type === "turn.created") {
            turnId = String(event.turnId ?? event.turn_id ?? "") || turnId;
          }
          if (event.type === "model.message") {
            references.push(...parseSandboxArtifactReferences(event.content));
          }
        }
        if (!sawTerminalEvent) {
          throw new Error(
            "AI Producer connection ended before the reply was complete.",
          );
        }
        if (!turnId || references.length === 0 || !sessionId.current) return;
        const imported = await importSandboxOutputs(
          sessionId.current,
          turnId,
          references,
          streamProjectId,
        );
        if (imported.length === 0) return;
        stream = await trueforge.sessions.createTurnStream(sessionId.current, {
          input: [
            {
              type: "user.message",
              content: artifactHandoffMessage(streamProjectId, imported),
            },
          ],
        });
      }
      appendEvents([
        {
          id: `sandbox-handoff-limit-${streamProjectId}`,
          kind: "message",
          label: "The edit produced too many chained files.",
          detail: "Ask AI Producer to continue from the latest imported media.",
          sceneIds: [],
        },
      ]);
    },
    [appendEvents, importSandboxOutputs, ingest],
  );

  useEffect(() => {
    activeProjectId.current = projectId;
    sessionId.current = null;
    eventStore.current.clear();
    toolCallStore.current.clear();
    turnCreatedEvents.current.clear();
    turnCostsInUsd.current.clear();
    outgoingStore.current.clear();
    setEvents([]);
    setPendingApprovals([]);
    setPendingQuestions([]);
    setActivity(projectId ? "Restoring the Producer thread…" : null);
    setSessionCostInUsd(null);
    setIsRestoring(Boolean(projectId));
    if (!projectId) return;

    let cancelled = false;
    const restoreController = new AbortController();
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
        const candidates: TrueForgeApi.Turn[] = [];
        for await (const turn of turns) {
          candidates.push(turn);
        }
        return latestProjectSessionTurn(candidates, projectId);
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
      const persisted = await replaySessionHistory(
        restoredSessionId,
        projectId,
      );
      if (latestTurn.state.status === "running") {
        setActivity("Thinking…");
        const stream = await trueforge.sessions.subscribeToTurn(
          restoredSessionId,
          latestTurn.id,
          {
            afterSequenceNumber: storedTurnSequence(projectId, latestTurn.id),
          },
          { abortSignal: restoreController.signal },
        );
        await consume(stream, projectId, latestTurn.id);
        await replaySessionHistory(restoredSessionId, projectId);
        return;
      }
      const sandboxReferences = new Map<string, SandboxArtifactReference[]>();
      for await (const stored of persisted) {
        if (cancelled || activeProjectId.current !== projectId) return;
        if (stored.event.type === "model.message") {
          const references = [
            ...parseSandboxArtifactReferences(stored.event.content),
          ];
          if (references.length > 0) {
            sandboxReferences.set(stored.turnId, [
              ...(sandboxReferences.get(stored.turnId) ?? []),
              ...references,
            ]);
          }
        }
      }
      const imported: ImportedSandboxOutput[] = [];
      for (const [turnId, references] of sandboxReferences) {
        imported.push(
          ...(await importSandboxOutputs(
            restoredSessionId,
            turnId,
            references,
            projectId,
          )),
        );
      }
      if (imported.length > 0 && !cancelled) {
        const handoff = await trueforge.sessions.createTurnStream(
          restoredSessionId,
          {
            input: [
              {
                type: "user.message",
                content: artifactHandoffMessage(projectId, imported),
              },
            ],
          },
        );
        await consume(handoff, projectId);
      }
    };
    void restore()
      .catch(() => {
        if (cancelled) return;
        appendEvents([
          {
            id: "producer-restore-error",
            kind: "message",
            label: "Couldn’t reconnect to the previous AI Producer session.",
            detail: "Your next instruction will start a fresh session.",
            sceneIds: [],
          },
        ]);
      })
      .finally(() => {
        if (!cancelled && activeProjectId.current === projectId) {
          setIsRestoring(false);
          setActivity((current) =>
            current === "Restoring the Producer thread…" ? null : current,
          );
        }
      });
    return () => {
      cancelled = true;
      restoreController.abort();
    };
  }, [
    appendEvents,
    consume,
    importSandboxOutputs,
    projectId,
    replaySessionHistory,
  ]);

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
        const stream = await trueforge.sessions.createTurnStream(
          sessionId.current,
          {
            input: [
              {
                type: "user.message",
                content: createProducerUserMessage(projectId, input),
              },
            ],
          },
        );
        await consume(stream, projectId);
      },
      onMutate: (input) => {
        setActivity("Thinking…");
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
          if (existing < 0) return [...current, event];
          return current.map((item) => (item.id === eventId ? event : item));
        });
        return { eventId };
      },
      onError: (error, _input, context) => {
        setActivity(null);
        if (!context) return;
        setEvents((current) =>
          current.map((item) =>
            item.id === context.eventId
              ? {
                  ...item,
                  detail: requestFailureMessage(error),
                  delivery: "failed" as const,
                }
              : item,
          ),
        );
      },
      onSuccess: async () => {
        if (sessionId.current && projectId) {
          await replaySessionHistory(sessionId.current, projectId);
        }
        if (projectId) {
          await queryClient.invalidateQueries({
            queryKey: greenlightKeys.project(projectId),
          });
        }
      },
      onSettled: (_data, error, _input, context) => {
        setActivity(null);
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
      if (
        input &&
        !send.isPending &&
        pendingApprovals.length === 0 &&
        pendingQuestions.length === 0
      ) {
        send.mutate(input);
      }
    },
    [pendingApprovals.length, pendingQuestions.length, send],
  );

  const stop = useMutation({
    mutationFn: async () => {
      if (!sessionId.current) throw new Error("producer_session_missing");
      await trueforge.sessions.cancel(sessionId.current);
    },
    onMutate: () => setActivity("Stopping…"),
    onError: () => {
      setActivity(null);
      appendEvents([
        {
          id: `producer-stop-error-${crypto.randomUUID()}`,
          kind: "message",
          label: "Couldn’t stop the current run. Try again.",
          detail: "",
          sceneIds: [],
        },
      ]);
    },
  });

  type ApprovalInput = {
    pending: PendingToolApproval;
    status: "allow" | "deny";
    reason?: string;
  };

  const approval = useMutation<void, Error, ApprovalInput, { eventId: string }>(
    {
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
            previousTurnId: input.pending.turnId,
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
        await consume(stream, projectId);
        setPendingApprovals((current) =>
          current.filter(
            (item) => item.toolCallId !== input.pending.toolCallId,
          ),
        );
      },
      onMutate: (input) => {
        const eventId = `approval-decision-${input.pending.toolCallId}-${crypto.randomUUID()}`;
        appendEvents([
          {
            id: eventId,
            kind: "instruction",
            label: approvalDecisionLabel(input.status, input.reason),
            detail: "",
            sceneIds: selectionSceneIds(input.pending.arguments),
            delivery: "sending",
          },
        ]);
        return { eventId };
      },
      onSuccess: async (_data, _input, context) => {
        if (sessionId.current && projectId) {
          await replaySessionHistory(sessionId.current, projectId);
        }
        setEvents((current) =>
          current.map((item) =>
            item.id === context?.eventId
              ? { ...item, delivery: "sent" as const }
              : item,
          ),
        );
        if (projectId) {
          await queryClient.invalidateQueries({
            queryKey: greenlightKeys.project(projectId),
          });
        }
      },
      onError: (_error, _input, context) => {
        setEvents((current) =>
          current.map((item) =>
            item.id === context?.eventId
              ? {
                  ...item,
                  delivery: "failed" as const,
                  detail: "That decision was not sent. Try again.",
                }
              : item,
          ),
        );
      },
    },
  );

  type QuestionInput = { pending: PendingQuestion; answer: string };

  const question = useMutation<void, Error, QuestionInput, { eventId: string }>(
    {
      mutationFn: async (input: {
        pending: PendingQuestion;
        answer: string;
      }) => {
        if (!sessionId.current) throw new Error("producer_session_missing");
        if (!projectId) throw new Error("project_not_selected");
        const stream = await trueforge.sessions.createTurnStream(
          sessionId.current,
          {
            previousTurnId: input.pending.turnId,
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
          current.filter(
            (item) => item.toolCallId !== input.pending.toolCallId,
          ),
        );
      },
      onMutate: (input) => {
        const eventId = `question-decision-${input.pending.toolCallId}-${crypto.randomUUID()}`;
        appendEvents([
          {
            id: eventId,
            kind: "instruction",
            label: questionDecisionLabel(input.answer),
            detail: "",
            sceneIds: [],
            delivery: "sending",
          },
        ]);
        return { eventId };
      },
      onSuccess: async (_data, _input, context) => {
        if (sessionId.current && projectId) {
          await replaySessionHistory(sessionId.current, projectId);
        }
        setEvents((current) =>
          current.map((item) =>
            item.id === context?.eventId
              ? { ...item, delivery: "sent" as const }
              : item,
          ),
        );
        if (projectId) {
          await queryClient.invalidateQueries({
            queryKey: greenlightKeys.project(projectId),
          });
        }
      },
      onError: (_error, _input, context) => {
        setEvents((current) =>
          current.map((item) =>
            item.id === context?.eventId
              ? {
                  ...item,
                  delivery: "failed" as const,
                  detail: "That answer was not sent. Try again.",
                }
              : item,
          ),
        );
      },
    },
  );

  const sendInstruction = useCallback(
    (input: ProducerSendInput) => {
      if (
        isRestoring ||
        send.isPending ||
        pendingApprovals.length > 0 ||
        pendingQuestions.length > 0
      ) {
        return;
      }
      send.mutate(input);
    },
    [isRestoring, pendingApprovals.length, pendingQuestions.length, send],
  );

  return {
    activity,
    events: compactStudioEvents(events),
    pendingApprovals,
    pendingQuestions,
    sessionCostInUsd,
    sessionId: sessionId.current,
    send: sendInstruction,
    stop: () => stop.mutate(),
    canStop:
      Boolean(
        sessionId.current &&
        (activity ||
          send.isPending ||
          approval.isPending ||
          question.isPending),
      ) && !stop.isPending,
    isStopping: stop.isPending,
    retryInstruction,
    isSending: send.isPending || isRestoring,
    decideApproval: approval.mutate,
    isApproving: approval.isPending,
    answerQuestion: question.mutate,
    cancelQuestion: (pending: PendingQuestion) =>
      question.mutate({ pending, answer: CREATOR_CANCELLED_QUESTION }),
    isAnswering: question.isPending,
  };
};
