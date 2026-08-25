import type {
  Artifact,
  ContentPackage,
  EditorSelection,
} from "@greenlight/contracts";
import {
  ArrowUp,
  Bot,
  Captions,
  Check,
  CircleDot,
  Film,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Mic2,
  MousePointer2,
  Paperclip,
  Play,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  FileText,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { greenlightApi, type VoiceOption } from "../api/greenlight.js";
import { useVoiceCapabilities, useVoiceSample } from "../api/queries.js";
import type {
  PendingToolApproval,
  PendingQuestion,
  StudioAgentEvent,
  StudioReviewDocument,
} from "../api/trueforge.js";
import { MEDIA_ACCEPT, MEDIA_ARTIFACT_MIME } from "../editor/media-transfer.js";
import {
  attachProducerSceneReference,
  type ProducerDraftIntent,
  type ProducerSceneReference,
} from "../editor/producer-draft.js";
import { cx } from "./controls.js";

const eventIcon: Record<StudioAgentEvent["kind"], typeof Bot> = {
  reasoning: Sparkles,
  tool: SlidersHorizontal,
  artifact: Film,
  approval: CircleDot,
  message: Bot,
  instruction: MousePointer2,
};

const QuestionCard = ({
  pending,
  busy,
  onAnswer,
  onCancel,
}: {
  pending: PendingQuestion;
  busy: boolean;
  onAnswer: (answer: string) => void;
  onCancel: () => void;
}) => {
  const [answer, setAnswer] = useState("");
  return (
    <div className="mx-3 mb-2 rounded-xl border border-action/25 bg-action-soft p-3">
      <p className="text-[14px] font-medium leading-6 text-ink">
        {pending.question}
      </p>
      {pending.options.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pending.options.map((option) => (
            <button
              key={option}
              type="button"
              disabled={busy}
              onClick={() => onAnswer(option)}
              className="rounded-md border border-action/20 bg-surface px-3 py-2 text-left text-[12px] leading-4 text-ink-secondary hover:border-action hover:text-ink disabled:opacity-40"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="mt-2 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          const value = answer.trim();
          if (value && !busy) onAnswer(value);
        }}
      >
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-md border border-line bg-surface px-3 text-[12px] font-medium text-ink-secondary hover:border-ink-caption hover:text-ink disabled:opacity-40"
        >
          Cancel
        </button>
        <input
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder="Or answer in your own words"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-[12px] leading-4 text-ink outline-none focus:border-action"
        />
        <button
          type="submit"
          disabled={!answer.trim() || busy}
          aria-label="Answer Producer"
          className="grid size-7 place-items-center rounded-md bg-ink text-white disabled:opacity-30"
        >
          <ArrowUp size={13} strokeWidth={2.2} />
        </button>
      </form>
    </div>
  );
};

const approvalCopy = (
  pending: PendingToolApproval,
  content: ContentPackage | null,
) => {
  if (pending.toolName === "apply_editor_patch") {
    const operations = Array.isArray(pending.arguments.operations)
      ? (pending.arguments.operations as Array<Record<string, unknown>>)
      : [];
    const sceneIds = [
      ...new Set(
        operations.flatMap((operation) =>
          typeof operation.scene_id === "string" ? [operation.scene_id] : [],
        ),
      ),
    ];
    const names = sceneIds.flatMap((sceneId) => {
      const scene = content?.scenes.find(
        (candidate) => candidate.id === sceneId,
      );
      return scene ? [scene.title] : [];
    });
    const fields = new Set<string>();
    for (const operation of operations) {
      if (operation.title !== undefined) fields.add("title");
      if (operation.claim_ids !== undefined) fields.add("sources");
      if (operation.narration !== undefined) fields.add("script");
      if (operation.narration_artifact_id !== undefined) fields.add("voice");
      if (operation.captions_artifact_id !== undefined) fields.add("captions");
      if (operation.transcript_artifact_id !== undefined)
        fields.add("transcript");
      if (operation.duration_seconds !== undefined) fields.add("timing");
      if (operation.gap_after_seconds !== undefined) fields.add("gap");
      if (operation.source_clip !== undefined) fields.add("source range");
      if (operation.playback_rate !== undefined) fields.add("speed");
      if (operation.visual !== undefined) fields.add("visual");
      if (operation.type === "split_scene") fields.add("structure");
      if (
        operation.type === "upsert_audio_track" ||
        operation.type === "remove_audio_track"
      ) {
        fields.add("audio track");
      }
    }
    const target =
      names.length > 0 ? `“${names.join("”, “")}”` : "the selected scene";
    const changes = fields.size > 0 ? [...fields].join(", ") : "scene content";
    return {
      title: `Update ${target}`,
      detail: `Change ${changes}. Everything else stays as it is.`,
      action: "Apply change",
    };
  }
  if (pending.toolName === "render_video") {
    return {
      title: "Render the current cut",
      detail: "Create a new MP4 from this revision.",
      action: "Render",
    };
  }
  if (pending.toolName === "stage_video_unlisted") {
    return {
      title: "Upload to YouTube as unlisted",
      detail: "Only people with the link will be able to watch it.",
      action: "Upload unlisted",
    };
  }
  if (pending.toolName === "publish_video") {
    return {
      title: "Make this video public",
      detail: "Anyone can find and watch it on YouTube.",
      action: "Publish",
    };
  }
  if (pending.toolName === "schedule_video") {
    return {
      title: "Schedule public release",
      detail: "YouTube will publish it at the proposed time.",
      action: "Schedule",
    };
  }
  return {
    title: "Review this action",
    detail: "Greenlight will continue only if you allow it.",
    action: "Continue",
  };
};

const ApprovalCard = ({
  pending,
  content,
  busy,
  onDecision,
}: {
  pending: PendingToolApproval;
  content: ContentPackage | null;
  busy: boolean;
  onDecision: (status: "allow" | "deny", reason?: string) => void;
}) => {
  const copy = approvalCopy(pending, content);
  const [refining, setRefining] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-xl border border-warning/25 bg-warning-soft">
      <div className="border-l-[3px] border-warning p-3">
        <div className="flex items-center gap-2 text-[12px] font-medium text-warning">
          Needs your approval
        </div>
        <p className="mt-2 text-[14px] font-medium leading-5 text-ink">
          {copy.title}
        </p>
        <p className="mt-1 text-[12px] leading-5 text-ink-tertiary">
          {copy.detail}
        </p>
        {refining ? (
          <div className="mt-3">
            <textarea
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What should change?"
              rows={2}
              className="w-full resize-none rounded-lg border border-warning/25 bg-surface px-3 py-2 text-[13px] leading-5 text-ink outline-none placeholder:text-ink-caption"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRefining(false)}
                className="h-8 px-2 text-[11px] text-ink-tertiary hover:text-ink"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!reason.trim() || busy}
                onClick={() => onDecision("deny", reason.trim())}
                className="h-8 rounded-md bg-ink px-3 text-[11px] font-medium text-white disabled:opacity-30"
              >
                Refine
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecision("allow")}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink text-[12px] font-medium text-white hover:bg-ink-secondary disabled:opacity-40"
            >
              <Check size={13} /> {copy.action}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRefining(true)}
              className="h-9 rounded-lg border border-line bg-surface px-3 text-[11px] text-ink-secondary hover:bg-hover disabled:opacity-40"
            >
              Refine
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecision("deny", "Cancelled by the creator.")}
              className="h-9 px-1.5 text-[11px] text-ink-tertiary hover:text-ink disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const ReviewDocument = ({
  document,
  onClose,
}: {
  document: StudioReviewDocument;
  onClose: () => void;
}) => (
  <div
    role="dialog"
    aria-modal="true"
    aria-label={document.title}
    className="fixed inset-0 z-50 grid place-items-center bg-ink/25 p-6 backdrop-blur-[2px]"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}
  >
    <article className="flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-float">
      <header className="flex items-start border-b border-line-subtle px-6 py-5">
        <div>
          <h2 className="text-[17px] font-medium tracking-[-0.02em] text-ink">
            {document.title}
          </h2>
          <p className="mt-1 text-[10px] text-ink-tertiary">
            {document.subtitle}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="ml-auto grid size-8 place-items-center rounded-md text-ink-tertiary hover:bg-hover hover:text-ink"
        >
          <X size={14} />
        </button>
      </header>
      <div className="scroll-stable min-h-0 overflow-y-auto px-6 py-2">
        {document.sections.map((section) => (
          <section
            key={section.title}
            className="border-b border-line-subtle py-5 last:border-0"
          >
            <h3 className="text-[10px] font-medium text-ink">
              {section.title}
            </h3>
            <div className="mt-3 space-y-3">
              {section.lines.map((line, index) => (
                <p
                  key={`${section.title}-${index}`}
                  className="text-[11px] leading-5 text-ink-secondary"
                >
                  {line}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  </div>
);

const VoicePickerCard = ({
  projectId,
  sampleScript,
  onChoose,
  onCancel,
}: {
  projectId: string;
  sampleScript: string;
  onChoose: (voice: VoiceOption) => void;
  onCancel: () => void;
}) => {
  const capabilities = useVoiceCapabilities();
  const sample = useVoiceSample(projectId);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voices = capabilities.data?.voices ?? [];
  const filteredVoices = voices.filter((voice) =>
    `${voice.id} ${voice.character}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selected = voices.find((voice) => voice.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && capabilities.data?.voice_id) {
      setSelectedId(capabilities.data.voice_id);
    }
  }, [capabilities.data?.voice_id, selectedId]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  const audition = async (voice: VoiceOption) => {
    audioRef.current?.pause();
    setPlayingId(voice.id);
    try {
      const result = await sample.mutateAsync({
        script: sampleScript,
        voice_id: voice.id,
      });
      const audio = new Audio(greenlightApi.artifactUrl(result.artifact.id));
      audioRef.current = audio;
      audio.addEventListener("ended", () => setPlayingId(null), {
        once: true,
      });
      await audio.play();
    } catch {
      setPlayingId(null);
    }
  };

  return (
    <section className="mx-3 mb-2 overflow-hidden rounded-xl border border-line bg-surface-raised shadow-[0_6px_24px_rgb(17_24_39/0.07)]">
      <header className="flex items-start gap-3 border-b border-line-subtle px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-action-soft text-action">
          <Mic2 size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-medium leading-5 text-ink">
            Choose a voice
          </h3>
          <p className="text-[12px] leading-5 text-ink-tertiary">
            Hear this scene in a Gemini voice before using it.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close voice picker"
          onClick={onCancel}
          className="grid size-7 place-items-center text-ink-tertiary hover:text-ink"
        >
          <X size={14} />
        </button>
      </header>

      {capabilities.isLoading ? (
        <div className="grid h-32 place-items-center text-ink-caption">
          <LoaderCircle size={18} className="animate-spin" />
        </div>
      ) : capabilities.isError || !capabilities.data?.available ? (
        <p className="px-4 py-5 text-[13px] leading-5 text-ink-secondary">
          Voice previews need the project’s OpenRouter connection.
        </p>
      ) : (
        <>
          <label className="mx-3 mt-3 flex h-9 items-center gap-2 border border-line bg-surface px-3 focus-within:border-action">
            <Search size={13} className="text-ink-caption" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search voices"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-caption"
            />
          </label>
          <div className="scroll-stable mx-3 my-2 max-h-56 overflow-y-auto border-y border-line-subtle">
            {filteredVoices.map((voice) => {
              const chosen = voice.id === selectedId;
              const loading = sample.isPending && playingId === voice.id;
              return (
                <div
                  key={voice.id}
                  className={cx(
                    "flex min-h-11 items-center border-b border-line-subtle px-2 last:border-0",
                    chosen && "bg-action-soft",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(voice.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
                  >
                    <span
                      className={cx(
                        "size-3 rounded-full border border-line-strong bg-surface",
                        chosen && "border-[4px] border-action",
                      )}
                    />
                    <span className="min-w-0">
                      <strong className="block text-[13px] font-medium text-ink">
                        {voice.id}
                      </strong>
                      <span className="block text-[11px] text-ink-tertiary">
                        {voice.character}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={sample.isPending}
                    onClick={() => void audition(voice)}
                    aria-label={`Hear ${voice.id}`}
                    className="grid size-8 place-items-center rounded-full border border-line bg-surface text-ink-secondary hover:border-action hover:text-action disabled:opacity-35"
                  >
                    {loading ? (
                      <LoaderCircle size={13} className="animate-spin" />
                    ) : (
                      <Play size={13} fill="currentColor" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {sample.isError ? (
        <p className="px-4 pb-2 text-[11px] text-warning">
          That preview could not be generated. Try another voice.
        </p>
      ) : null}
      <footer className="flex items-center justify-end gap-2 border-t border-line-subtle px-3 py-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 text-[12px] text-ink-tertiary hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={() => selected && onChoose(selected)}
          className="h-8 rounded-md bg-ink px-3 text-[12px] font-medium text-white disabled:opacity-30"
        >
          Use {selected?.id ?? "voice"}
        </button>
      </footer>
    </section>
  );
};

export const ProducerPanel = ({
  projectId,
  content,
  artifacts,
  selection,
  contextArtifacts,
  draftIntent,
  events,
  activity,
  pendingApprovals,
  pendingQuestions,
  selectedGapAfterSceneIds,
  isSending,
  isApproving,
  isAnswering,
  onSend,
  onRetryInstruction,
  onApproval,
  onAnswerQuestion,
  onCancelQuestion,
  onRemoveScene,
  onRemoveArtifact,
  onAttachArtifact,
  onImportFiles,
  importing,
}: {
  projectId: string | null;
  content: ContentPackage | null;
  artifacts: Artifact[];
  selection: EditorSelection | null;
  contextArtifacts: Artifact[];
  draftIntent: ProducerDraftIntent | null;
  events: StudioAgentEvent[];
  activity: string | null;
  pendingApprovals: PendingToolApproval[];
  pendingQuestions: PendingQuestion[];
  selectedGapAfterSceneIds: string[];
  isSending: boolean;
  isApproving: boolean;
  isAnswering: boolean;
  onSend: (instruction: string) => void;
  onRetryInstruction: (eventId: string) => void;
  onApproval: (
    pending: PendingToolApproval,
    status: "allow" | "deny",
    reason?: string,
  ) => void;
  onAnswerQuestion: (pending: PendingQuestion, answer: string) => void;
  onCancelQuestion: (pending: PendingQuestion) => void;
  onRemoveScene: (sceneId: string) => void;
  onRemoveArtifact: (artifactId: string) => void;
  onAttachArtifact: (artifactId: string) => void;
  onImportFiles: (files: File[]) => Promise<string[]>;
  importing: boolean;
}) => {
  const [instruction, setInstruction] = useState("");
  const [sceneReferences, setSceneReferences] = useState<
    ProducerSceneReference[]
  >([]);
  const [dragActive, setDragActive] = useState(false);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [openDocument, setOpenDocument] = useState<StudioReviewDocument | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!draftIntent) return;
    if (draftIntent.mode === "replace") {
      setInstruction(draftIntent.text);
      return;
    }
    setSceneReferences((current) =>
      attachProducerSceneReference(current, draftIntent),
    );
  }, [draftIntent]);
  const conversationPaused =
    pendingQuestions.length > 0 || pendingApprovals.length > 0;
  const sampleScript =
    selection?.scene_ids
      .map((sceneId) =>
        content?.scenes.find((scene) => scene.id === sceneId)?.narration.trim(),
      )
      .find(Boolean)
      ?.slice(0, 220) ??
    "Every edit stays intentional, reversible, and ready to share.";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-stable min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {events.length === 0 ? (
          <div className="h-full" />
        ) : (
          <div className="space-y-1">
            {events.map((event) => {
              if (event.kind === "instruction") {
                return (
                  <div key={event.id} className="flex justify-end py-1">
                    <div
                      className={cx(
                        "max-w-[88%] rounded-xl rounded-br-sm bg-ink px-3 py-2 text-white",
                        event.delivery === "failed" &&
                          "border border-warning/30 bg-warning-soft text-ink",
                      )}
                    >
                      <p className="whitespace-pre-wrap text-[14px] leading-6">
                        {event.label}
                      </p>
                      {event.delivery === "failed" ? (
                        <div className="mt-2 border-t border-warning/20 pt-2">
                          <p className="text-[12px] leading-5 text-ink-secondary">
                            {event.detail || "Producer couldn’t answer."}
                          </p>
                          <button
                            type="button"
                            onClick={() => onRetryInstruction(event.id)}
                            disabled={isSending}
                            className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-warning hover:underline disabled:opacity-40"
                          >
                            <RotateCcw size={10} /> Retry
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              }
              const Icon = eventIcon[event.kind];
              const eventArtifact = event.artifactId
                ? artifacts.find((artifact) => artifact.id === event.artifactId)
                : null;
              return (
                <div
                  key={event.id}
                  className="flex w-full gap-2.5 rounded-lg px-2 py-2.5 text-left"
                >
                  <span
                    className={cx(
                      "grid size-6 shrink-0 place-items-center rounded-full bg-surface-sunken text-ink-tertiary",
                      event.kind === "artifact" && "bg-action-soft text-action",
                      event.kind === "approval" &&
                        "bg-warning-soft text-warning",
                    )}
                  >
                    {event.document ? (
                      <FileText size={12} />
                    ) : (
                      <Icon size={12} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <strong className="block text-[12px] font-medium leading-5 text-ink">
                      {event.label}
                    </strong>
                    {event.detail ? (
                      <p className="mt-0.5 line-clamp-5 whitespace-pre-wrap text-[12px] leading-5 text-ink-tertiary">
                        {event.detail}
                      </p>
                    ) : null}
                    {event.document ? (
                      <button
                        type="button"
                        onClick={() => setOpenDocument(event.document!)}
                        className="mt-1 block text-[11px] font-medium text-action hover:underline"
                      >
                        Open
                      </button>
                    ) : null}
                    {eventArtifact ? (
                      <a
                        href={greenlightApi.artifactUrl(eventArtifact.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block text-[11px] font-medium text-action hover:underline"
                      >
                        Open media
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {activity ? (
          <div className="flex items-center gap-2.5 px-2 py-2.5 text-[12px] text-ink-secondary">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-action-soft text-action">
              <LoaderCircle size={12} className="animate-spin" />
            </span>
            <span>{activity}</span>
          </div>
        ) : null}
        {pendingQuestions.map((pending) => (
          <QuestionCard
            key={pending.toolCallId}
            pending={pending}
            busy={isAnswering}
            onAnswer={(answer) => onAnswerQuestion(pending, answer)}
            onCancel={() => onCancelQuestion(pending)}
          />
        ))}

        {pendingApprovals.map((pending) => (
          <ApprovalCard
            key={pending.toolCallId}
            pending={pending}
            content={content}
            busy={isApproving}
            onDecision={(status, reason) => onApproval(pending, status, reason)}
          />
        ))}

        {voicePickerOpen && !conversationPaused && projectId ? (
          <VoicePickerCard
            projectId={projectId}
            sampleScript={sampleScript}
            onCancel={() => setVoicePickerOpen(false)}
            onChoose={(voice) => {
              setInstruction((current) => {
                const choice = `Use the ${voice.id} voice (${voice.character.toLowerCase()}) for the selected narration or dub track. Generate scene-sized clips and preview the track change before applying it.`;
                return current.trim()
                  ? `${current.trim()}\n\n${choice}`
                  : choice;
              });
              setVoicePickerOpen(false);
            }}
          />
        ) : null}
      </div>

      <form
        data-testid="producer-composer"
        className={cx(
          "m-3 rounded-[20px] border bg-surface-raised shadow-[0_6px_24px_rgb(17_24_39/0.09)] transition-colors",
          dragActive ? "border-action bg-action-soft/30" : "border-line",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setDragActive(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          const artifactId = event.dataTransfer.getData(MEDIA_ARTIFACT_MIME);
          if (artifactId) {
            onAttachArtifact(artifactId);
            return;
          }
          const files = [...event.dataTransfer.files];
          if (files.length > 0) void onImportFiles(files);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const next = instruction.trim();
          if (!next || isSending || conversationPaused) return;
          onSend(next);
          setInstruction("");
          setSceneReferences([]);
        }}
      >
        {selection && content ? (
          <div className="flex flex-wrap gap-1.5 border-b border-line-subtle px-3 pb-2 pt-2.5">
            <span className="flex h-6 shrink-0 items-center gap-1 text-[9px] text-ink-caption">
              <MousePointer2 size={11} className="text-action" />
              {selection.scene_ids.length}
            </span>
            {selection.scene_ids.slice(0, 3).map((sceneId) => {
              const scene = content.scenes.find(
                (candidate) => candidate.id === sceneId,
              );
              return (
                <span
                  key={sceneId}
                  className="flex h-6 min-w-0 max-w-[190px] items-center gap-1.5 rounded-md bg-action-soft px-2 text-[9px] text-ink-secondary"
                >
                  <span className="truncate">{scene?.title ?? sceneId}</span>
                  {selection.scene_ids.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`Detach ${scene?.title ?? "scene"}`}
                      onClick={() => onRemoveScene(sceneId)}
                      className="shrink-0 text-ink-caption hover:text-ink"
                    >
                      <X size={10} />
                    </button>
                  ) : null}
                </span>
              );
            })}
            {selection.scene_ids.length > 3 ? (
              <span className="flex h-6 shrink-0 items-center rounded-md bg-action-soft px-2 font-mono text-[8px] text-ink-secondary">
                +{selection.scene_ids.length - 3}
              </span>
            ) : null}
            {selectedGapAfterSceneIds.slice(0, 2).map((sceneId) => {
              const scene = content.scenes.find(
                (candidate) => candidate.id === sceneId,
              );
              if (!scene?.gap_after_seconds) return null;
              return (
                <span
                  key={`${sceneId}-gap`}
                  className="flex h-6 min-w-0 max-w-[220px] items-center gap-1.5 rounded-md bg-warning-soft px-2 text-[9px] text-ink-secondary"
                >
                  <span className="truncate">
                    {scene.gap_after_seconds.toFixed(1)}s gap after{" "}
                    {scene.title}
                  </span>
                </span>
              );
            })}
            {selectedGapAfterSceneIds.length > 2 ? (
              <span className="flex h-6 shrink-0 items-center rounded-md bg-warning-soft px-2 font-mono text-[8px] text-ink-secondary">
                +{selectedGapAfterSceneIds.length - 2} gaps
              </span>
            ) : null}
            {contextArtifacts.slice(0, 3).map((artifact) => {
              const original = artifact.provenance.original_filename;
              const label =
                typeof original === "string" ? original : artifact.kind;
              return (
                <span
                  key={artifact.id}
                  className="flex h-7 min-w-0 max-w-[210px] items-center gap-1.5 rounded-md border border-line bg-surface p-1 pr-2 text-[9px] text-ink-secondary"
                >
                  <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-sm bg-surface-sunken text-ink-caption">
                    {artifact.kind === "image" ? (
                      <img
                        src={greenlightApi.artifactUrl(artifact.id)}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : artifact.kind === "video" ? (
                      <Film size={10} />
                    ) : artifact.kind === "narration" ? (
                      <Mic2 size={10} />
                    ) : artifact.kind === "caption" ? (
                      <Captions size={10} />
                    ) : (
                      <ImageIcon size={10} />
                    )}
                  </span>
                  <span className="truncate">{label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${label}`}
                    onClick={() => onRemoveArtifact(artifact.id)}
                    className="shrink-0 text-ink-caption hover:text-ink"
                  >
                    <X size={10} />
                  </button>
                </span>
              );
            })}
            {contextArtifacts.length > 3 ? (
              <span className="flex h-6 shrink-0 items-center rounded-md border border-line bg-surface px-2 font-mono text-[8px] text-ink-secondary">
                +{contextArtifacts.length - 3} files
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="flex min-h-[88px] flex-wrap content-start items-start gap-1.5 px-3 pt-3">
          {sceneReferences.map((reference) => (
            <span
              key={reference.sceneId}
              data-testid="producer-scene-reference"
              className="flex h-7 max-w-full shrink-0 items-center gap-1.5 rounded-md border border-action/20 bg-action-soft px-2 text-[12px] font-medium text-ink-secondary"
            >
              <Layers3 size={12} className="shrink-0 text-action" />
              <span className="max-w-[220px] truncate">{reference.title}</span>
              <button
                type="button"
                aria-label={`Remove ${reference.title} from the instruction`}
                onClick={() => {
                  setSceneReferences((current) =>
                    current.filter(
                      ({ sceneId }) => sceneId !== reference.sceneId,
                    ),
                  );
                }}
                className="-mr-1 grid size-5 shrink-0 place-items-center rounded-sm text-ink-caption transition-colors duration-100 hover:bg-surface hover:text-ink"
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={
              pendingQuestions.length > 0
                ? "Answer the question above…"
                : pendingApprovals.length > 0
                  ? "Review the change above…"
                  : sceneReferences.length > 0
                    ? "What should change?"
                    : selection
                      ? "Edit this selection…"
                      : "Direct the production…"
            }
            disabled={conversationPaused}
            rows={3}
            className="min-w-[180px] flex-1 resize-none border-0 bg-transparent px-1 text-[14px] leading-6 text-ink outline-none placeholder:text-ink-caption disabled:cursor-not-allowed disabled:bg-surface-sunken/40"
          />
        </div>
        <div className="flex items-center justify-end px-3 pb-2.5 pt-1">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={MEDIA_ACCEPT}
            className="sr-only"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              if (files.length > 0) void onImportFiles(files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            aria-label="Choose a Gemini voice"
            disabled={conversationPaused || !projectId}
            onClick={() => setVoicePickerOpen((open) => !open)}
            className={cx(
              "grid size-8 place-items-center rounded-full text-ink-tertiary hover:bg-hover hover:text-ink disabled:opacity-30",
              voicePickerOpen && "bg-action-soft text-action",
            )}
          >
            <Mic2 size={14} />
          </button>
          <button
            type="button"
            aria-label="Attach media"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            className="grid size-8 place-items-center rounded-full text-ink-tertiary hover:bg-hover hover:text-ink disabled:opacity-30"
          >
            <Paperclip size={14} />
          </button>
          <button
            type="submit"
            aria-label="Send instruction"
            disabled={!instruction.trim() || isSending || conversationPaused}
            className="ml-auto grid size-8 place-items-center rounded-full bg-ink text-white transition-colors hover:bg-ink-secondary disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUp size={15} strokeWidth={2.2} />
          </button>
        </div>
      </form>
      {openDocument ? (
        <ReviewDocument
          document={openDocument}
          onClose={() => setOpenDocument(null)}
        />
      ) : null}
    </div>
  );
};
