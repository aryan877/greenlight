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

import { greenlightApi } from "./greenlight.js";
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
  artifactId?: string;
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

type ProducerSendInput = {
  instruction: string;
  selection: EditorSelection | null;
  timeline: EditorTimelineContext | null;
  clientEventId?: string;
};

export const createProducerUserMessage = (
  projectId: string,
  input: Pick<ProducerSendInput, "instruction" | "selection" | "timeline">,
) => {
  const timelineContext = input.timeline
    ? `\n\nEDITOR_TIMELINE (complete current cut):\n${JSON.stringify(input.timeline)}`
    : "";
  const selectionContext = input.selection
    ? `\n\nEDITOR_SELECTION (current emphasis):\n${JSON.stringify(input.selection)}`
    : "";
  return `PROJECT_ID: ${projectId}\n\n${input.instruction}${timelineContext}${selectionContext}`;
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
};

const turnDoneState = (event: WireEvent): TurnDoneState | null =>
  event.type === "turn.done" && event.state && typeof event.state === "object"
    ? (event.state as TurnDoneState)
    : null;

export const terminalFailureMessage = (event: WireEvent): string | null => {
  const state = turnDoneState(event);
  if (state?.status === "error") {
    return "AI Producer couldn’t finish that reply. Check the model connection and retry.";
  }
  if (state?.status === "cancelled") {
    return "AI Producer stopped before answering. Retry when you’re ready.";
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
      typeof args.question === "string" ? args.question.trim() : "";
    if (!question) return [];
    return [
      {
        eventId: String(event.id ?? crypto.randomUUID()),
        turnId,
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
    save_evidence_ledger: {
      kind: "artifact",
      label: "Updated the source record",
      detail: `${Array.isArray(args.claims) ? args.claims.length : 0} supported claims kept`,
    },
    search_openmoji: { kind: "tool", label: "Found visual options" },
    attach_openmoji: { kind: "artifact", label: "Added a visual" },
    generate_voice: { kind: "artifact", label: "Created the voice track" },
    transcribe_audio: { kind: "artifact", label: "Timed every spoken word" },
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

const creatorFacingSentence = (value: string): string | null => {
  const content = value
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!content) return null;
  if (/^(done|patch applied successfully)\.?$/i.test(content)) {
    return "Change applied.";
  }
  if (
    /patch (?:was )?(?:cancelled|canceled|not applied)|no changes were made/i.test(
      content,
    )
  ) {
    return "Change cancelled.";
  }
  if (/^(?:yes|confirmed)\b.*\bcurrent cut\b/i.test(content)) {
    return "Yes — I can see the current cut.";
  }
  if (/^frame math\b/i.test(content)) return null;
  const sentences =
    content
      .match(/[^.!?]+[.!?](?:\s|$)|[^.!?]+$/g)
      ?.map((sentence) => sentence.trim()) ?? [];
  return (
    sentences.find(
      (sentence) =>
        sentence.length <= 180 &&
        !/(?:\bartifact[_-]?[a-z0-9]+|\bscene_[a-z0-9_-]+|frame math|frames? \d|gapafter|base_content_package|content_package_artifact|sha256|current revision)/i.test(
          sentence,
        ) &&
        !/^(got it|understood|okay|let me|i(?:'ll| will)|now i|first[, ]|to begin)/i.test(
          sentence,
        ),
    ) ?? null
  );
};

export const describeEvent = (event: WireEvent): StudioAgentEvent[] => {
  const type = String(event.type ?? "agent.event");
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
      if (presentation) output.push({ id: call.id, ...presentation });
    }
    const humanSentence = creatorFacingSentence(textContent(event.content));
    if (humanSentence && (calls.length === 0 || output.length === 0)) {
      output.push({
        id: String(event.id ?? crypto.randomUUID()),
        kind: "message",
        label: humanSentence,
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
  const [activity, setActivity] = useState<string | null>(null);
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
    (incoming: WireEvent, sourceTurnId: string | null) => {
      let event = incoming;
      const terminal = turnDoneState(incoming);
      if (terminal) {
        setActivity(null);
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

      if (
        event.type === "model.message" &&
        !event.content &&
        !event.reasoningContent &&
        !event.reasoning_content &&
        toolCallsOf(event).length === 0
      ) {
        return null;
      }

      if (event.type === "model.message") {
        for (const call of toolCallsOf(event)) {
          const nextActivity: Record<string, string> = {
            get_project: "Checking the current cut…",
            get_artifact: "Reading the selected media…",
            apply_editor_patch: "Preparing the preview…",
            transcribe_audio: "Timing the words…",
            generate_voice: "Generating the voice…",
            generate_image: "Creating the visual…",
            render_video: "Rendering the video…",
          };
          setActivity(nextActivity[call.function.name] ?? "Working…");
          if (call.function.name !== "focus_editor_selection") continue;
          const parsed = editorFocusInputSchema.safeParse(parseArguments(call));
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
          const approvals = resolved.map(({ call }) => ({
            eventId: String(event.id ?? crypto.randomUUID()),
            turnId: sourceTurnId,
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
          setActivity(null);
          const questions = pendingQuestionsFromEvent(
            event,
            eventStore.current,
            sourceTurnId,
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
      return event;
    },
    [appendEvents],
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
    ) => {
      let stream = initialStream;
      for (let handoff = 0; handoff < 4; handoff += 1) {
        let turnId: string | null = null;
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
    outgoingStore.current.clear();
    setEvents([]);
    setPendingApprovals([]);
    setPendingQuestions([]);
    setActivity(null);
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
      const restoredInstruction = (latestTurn.input ?? []).find((item) => {
        const value = item as unknown as Record<string, unknown>;
        return (
          value.type === "user.message" && typeof value.content === "string"
        );
      }) as { content?: string } | undefined;
      const instruction = restoredInstruction?.content
        ?.replace(/^PROJECT_ID:[^\n]+\n\n/, "")
        .split(/\n\nEDITOR_(?:TIMELINE|SELECTION)/)[0]
        ?.trim();
      if (
        instruction &&
        !instruction.startsWith("GREENLIGHT_ARTIFACT_HANDOFF")
      ) {
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
      const sandboxReferences: SandboxArtifactReference[] = [];
      for await (const stored of persisted) {
        if (cancelled || activeProjectId.current !== projectId) return;
        const event = ingest(stored as unknown as WireEvent, latestTurn.id);
        if (event?.type === "model.message") {
          sandboxReferences.push(
            ...parseSandboxArtifactReferences(event.content),
          );
        }
      }
      const imported = await importSandboxOutputs(
        restoredSessionId,
        latestTurn.id,
        sandboxReferences,
        projectId,
      );
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
    void restore().catch(() => {
      appendEvents([
        {
          id: "producer-restore-error",
          kind: "message",
          label: "Couldn’t reconnect to the previous AI Producer session.",
          detail: "Your next instruction will start a fresh session.",
          sceneIds: [],
        },
      ]);
    });
    return () => {
      cancelled = true;
    };
  }, [appendEvents, consume, importSandboxOutputs, ingest, projectId]);

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
          if (existing < 0) return [...current, event].slice(-40);
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
    onError: (_error, input) => {
      appendEvents([
        {
          id: `approval-delivery-${input.pending.toolCallId}-${crypto.randomUUID()}`,
          kind: "message",
          label: "Couldn’t send your decision.",
          detail: "The preview is still waiting. Try again.",
          sceneIds: selectionSceneIds(input.pending.arguments),
        },
      ]);
    },
  });

  const question = useMutation({
    mutationFn: async (input: { pending: PendingQuestion; answer: string }) => {
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
    onError: (_error, input) => {
      appendEvents([
        {
          id: `answer-delivery-${input.pending.toolCallId}-${crypto.randomUUID()}`,
          kind: "message",
          label: "Couldn’t send your answer.",
          detail: "The question is still open. Try again.",
          sceneIds: [],
        },
      ]);
    },
  });

  const sendInstruction = useCallback(
    (input: ProducerSendInput) => {
      if (
        send.isPending ||
        pendingApprovals.length > 0 ||
        pendingQuestions.length > 0
      ) {
        return;
      }
      send.mutate(input);
    },
    [pendingApprovals.length, pendingQuestions.length, send],
  );

  return {
    activity,
    events,
    pendingApprovals,
    pendingQuestions,
    sessionId: sessionId.current,
    send: sendInstruction,
    retryInstruction,
    isSending: send.isPending,
    decideApproval: approval.mutate,
    isApproving: approval.isPending,
    answerQuestion: question.mutate,
    cancelQuestion: (pending: PendingQuestion) =>
      question.mutate({ pending, answer: CREATOR_CANCELLED_QUESTION }),
    isAnswering: question.isPending,
  };
};
