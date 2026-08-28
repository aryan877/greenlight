import type {
  Artifact,
  ContentPackage,
  EditorSelection,
  EditorTimelineGap,
  EditorTimelineItem,
  EditorTimelineTrack,
} from "@greenlight/contracts";
import {
  Blend,
  ArrowUp,
  Captions,
  Check,
  ChevronDown,
  CircleDot,
  Film,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Mic2,
  Paperclip,
  Play,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Split,
  Sparkles,
  FileText,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { greenlightApi, type VoiceOption } from "../api/greenlight.js";
import { useVoiceCapabilities, useVoiceSample } from "../api/queries.js";
import { GreenlightMark } from "../brand-icons.js";
import type {
  PendingToolApproval,
  PendingQuestion,
  StudioAgentEvent,
  StudioReviewDocument,
} from "../api/trueforge.js";
import { MEDIA_ACCEPT, MEDIA_ARTIFACT_MIME } from "../editor/media-transfer.js";
import { shouldSubmitProducerInstruction } from "../editor/producer-composer.js";
import type { ProducerDraftIntent } from "../editor/producer-draft.js";
import { cx } from "./controls.js";

const eventIcon: Partial<
  Record<StudioAgentEvent["kind"], typeof SlidersHorizontal>
> = {
  reasoning: Sparkles,
  subagent: Search,
  tool: SlidersHorizontal,
  artifact: Film,
  approval: CircleDot,
};

const formatReplyDuration = (durationMs: number) =>
  `${(durationMs / 1_000).toFixed(1)}s`;

const sessionCostFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
});

const formatSessionCost = (costInUsd: number | null) =>
  costInUsd === null ? "—" : sessionCostFormatter.format(costInUsd);

const AgentMark = ({ thinking = false }: { thinking?: boolean }) => (
  <span className="mt-1 grid size-5 shrink-0 place-items-center text-action">
    <GreenlightMark
      size={16}
      strokeWidth={1.9}
      className={cx(thinking && "motion-safe:animate-spin")}
    />
  </span>
);

const SubagentMark = ({
  running,
  failed,
}: {
  running: boolean;
  failed: boolean;
}) => (
  <span
    className={cx(
      "relative grid size-7 shrink-0 place-items-center rounded-full bg-action-soft text-action",
      failed && "bg-warning-soft text-warning",
    )}
  >
    <GreenlightMark
      size={16}
      strokeWidth={1.9}
      className={cx(running && "motion-safe:animate-spin")}
    />
    <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-surface bg-action" />
  </span>
);

const SubagentCard = ({
  event,
  onOpenDocument,
}: {
  event: StudioAgentEvent;
  onOpenDocument: (document: StudioReviewDocument) => void;
}) => {
  const running = event.status === "running";
  const failed = event.status === "error";
  const shouldStayOpen = running || Boolean(event.document);
  const [open, setOpen] = useState(shouldStayOpen);
  const previousStatus = useRef(event.status);
  const document = event.document;

  useEffect(() => {
    if (shouldStayOpen) {
      setOpen(true);
    } else if (previousStatus.current === "running") {
      setOpen(false);
    }
    previousStatus.current = event.status;
  }, [event.status, shouldStayOpen]);

  const run = event.subagent;
  return (
    <section className="ml-8 w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-line bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-raised"
      >
        <SubagentMark running={running} failed={failed} />
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-[12px] font-medium leading-5 text-ink">
            {event.label}
          </strong>
          <span className="text-[11px] text-ink-tertiary">{event.detail}</span>
        </span>
        <ChevronDown
          size={14}
          className={cx(
            "shrink-0 text-ink-tertiary transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="border-t border-line-subtle px-3 pb-3 pt-2.5">
          {run?.brief ? (
            <p className="mb-2 text-[11px] leading-5 text-ink-secondary">
              {run.brief}
            </p>
          ) : null}
          {run?.steps.length ? (
            <ul className="space-y-1.5">
              {run.steps.map((step) => (
                <li
                  key={step.id}
                  className="flex items-center gap-2 text-[11px] leading-5 text-ink-tertiary"
                >
                  {step.status === "done" ? (
                    <Check size={12} className="shrink-0 text-action" />
                  ) : (
                    <LoaderCircle
                      size={12}
                      className="shrink-0 motion-safe:animate-spin"
                    />
                  )}
                  <span>{step.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {run?.result && !event.document ? (
            <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-[11px] leading-5 text-ink-secondary">
              {run.result}
            </p>
          ) : null}
          {document ? (
            <button
              type="button"
              onClick={() => onOpenDocument(document)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-[11px] font-medium text-ink hover:border-action/40"
            >
              <FileText size={12} /> Review draft
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

type TimelineReferenceKind = EditorTimelineItem["kind"] | "gap";

const referenceAppearance = {
  video: {
    Icon: Layers3,
    className:
      "border-track-video-strong/30 bg-track-video text-track-video-strong",
  },
  audio: {
    Icon: Mic2,
    className:
      "border-track-voice-strong/30 bg-track-voice text-track-voice-strong",
  },
  caption: {
    Icon: Captions,
    className:
      "border-track-caption-strong/30 bg-track-caption text-track-caption-strong",
  },
  transition: {
    Icon: Blend,
    className: "border-action/35 bg-action-soft text-action",
  },
  gap: {
    Icon: Split,
    className: "border-line bg-surface-sunken text-ink-secondary",
  },
} satisfies Record<
  TimelineReferenceKind,
  { Icon: typeof Layers3; className: string }
>;

const ReferenceToken = ({
  kind,
  label,
  removeLabel,
  onRemove,
}: {
  kind: TimelineReferenceKind;
  label: string;
  removeLabel?: string;
  onRemove?: () => void;
}) => {
  const { Icon, className } = referenceAppearance[kind];
  return (
    <span
      className={cx(
        "flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 rounded-lg border px-2 text-[10px]",
        className,
      )}
    >
      <Icon size={11} className="shrink-0" />
      <span className="truncate">{label}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="-mr-1 grid size-5 shrink-0 place-items-center rounded-full opacity-70 hover:bg-surface/60 hover:opacity-100"
        >
          <X size={11} />
        </button>
      ) : null}
    </span>
  );
};

const quickIntents = [
  {
    label: "Cut at a word",
    prompt: "Cut this when the speaker says ",
  },
  {
    label: "Tighten pacing",
    prompt:
      "Tighten the pacing in this selection and show me the proposed cuts.",
  },
  {
    label: "Add B-roll",
    prompt:
      "Add relevant B-roll to this selection without changing the narration.",
  },
  {
    label: "Fix captions",
    prompt: "Correct and retime the captions in this selection.",
  },
  {
    label: "Dub this",
    prompt: "Dub this selection. Ask me to choose and audition a voice first.",
  },
  {
    label: "Prepare release",
    prompt:
      "Prepare the YouTube title, description, thumbnail, and unlisted release for review.",
  },
] as const;

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
    <div className="mx-3 my-4 grid grid-cols-[20px_minmax(0,1fr)] gap-3">
      <AgentMark />
      <section className="overflow-hidden rounded-xl border border-action/25 bg-surface-raised">
        <p className="border-l-2 border-action px-4 pb-3 pt-3.5 text-[14px] font-medium leading-6 text-ink">
          {pending.question}
        </p>
        {pending.options.length > 0 ? (
          <div className="grid gap-1.5 border-y border-line-subtle p-2">
            {pending.options.map((option) => (
              <button
                key={option}
                type="button"
                disabled={busy}
                onClick={() => onAnswer(option)}
                className="rounded-lg border border-line bg-surface px-4 py-3 text-left text-[13px] leading-5 text-ink-secondary transition-colors hover:border-action hover:bg-action-soft hover:text-ink disabled:opacity-40"
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
        <form
          className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 p-3"
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
            className="rounded-lg border border-line bg-surface px-3 text-[12px] font-medium text-ink-secondary hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            Cancel
          </button>
          <input
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Write your own answer"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] leading-5 text-ink outline-none focus:border-action"
          />
          <button
            type="submit"
            disabled={!answer.trim() || busy}
            aria-label="Answer Greenlight"
            className="grid size-9 place-items-center rounded-full bg-control text-control-ink disabled:opacity-30"
          >
            <ArrowUp size={14} strokeWidth={2.2} />
          </button>
        </form>
      </section>
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
    const updatesRelease = operations.some(
      (operation) => operation.type === "update_release",
    );
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
      if (operation.metadata !== undefined) fields.add("YouTube details");
      if (operation.release !== undefined) fields.add("release plan");
      if (operation.type === "split_scene") fields.add("structure");
      if (
        operation.type === "upsert_audio_track" ||
        operation.type === "remove_audio_track"
      ) {
        fields.add("audio track");
      }
    }
    const target = updatesRelease
      ? "the YouTube release"
      : names.length > 0
        ? `“${names.join("”, “")}”`
        : "the selected scene";
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
    <div className="mx-3 my-4 overflow-hidden rounded-xl border border-warning/25 bg-warning-soft">
      <div className="border-l-2 border-warning p-4">
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
                className="h-8 rounded-lg px-2 text-[11px] text-ink-tertiary hover:text-ink"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!reason.trim() || busy}
                onClick={() => onDecision("deny", reason.trim())}
                className="h-8 rounded-lg bg-control px-3 text-[11px] font-medium text-control-ink disabled:opacity-30"
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
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-control text-[12px] font-medium text-control-ink hover:bg-control-hover disabled:opacity-40"
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
              className="h-9 rounded-lg px-1.5 text-[11px] text-ink-tertiary hover:bg-hover hover:text-ink disabled:opacity-40"
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
  prompt,
  onChoose,
  onCancel,
}: {
  projectId: string;
  sampleScript: string;
  prompt: string;
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
          <p className="text-[12px] leading-5 text-ink-tertiary">{prompt}</p>
        </div>
        <button
          type="button"
          aria-label="Close voice picker"
          onClick={onCancel}
          className="grid size-7 place-items-center rounded-full text-ink-tertiary hover:bg-hover hover:text-ink"
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
          <label className="mx-3 mt-3 flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 focus-within:border-action">
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
          className="h-8 rounded-lg px-3 text-[12px] text-ink-tertiary hover:bg-hover hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={() => selected && onChoose(selected)}
          className="h-8 rounded-lg bg-control px-3 text-[12px] font-medium text-control-ink disabled:opacity-30"
        >
          Use {selected?.id ?? "voice"}
        </button>
      </footer>
    </section>
  );
};

export type ProducerReference =
  | { type: "item"; value: EditorTimelineItem }
  | { type: "track"; value: EditorTimelineTrack }
  | { type: "gap"; value: EditorTimelineGap };

export const ProducerPanel = ({
  projectId,
  content,
  artifacts,
  selection,
  liveSelection,
  references,
  contextArtifacts,
  draftIntent,
  events,
  sessionCostInUsd,
  activity,
  pendingApprovals,
  pendingQuestions,
  isSending,
  isApproving,
  isAnswering,
  onSend,
  onRetryInstruction,
  onApproval,
  onAnswerQuestion,
  onCancelQuestion,
  onRemoveItem,
  onRemoveTrack,
  onRemoveGap,
  onRemoveArtifact,
  onClearReferences,
  onAttachArtifact,
  onImportFiles,
  importing,
}: {
  projectId: string | null;
  content: ContentPackage | null;
  artifacts: Artifact[];
  selection: EditorSelection | null;
  liveSelection: ProducerReference[];
  references: ProducerReference[];
  contextArtifacts: Artifact[];
  draftIntent: ProducerDraftIntent | null;
  events: StudioAgentEvent[];
  sessionCostInUsd: number | null;
  activity: string | null;
  pendingApprovals: PendingToolApproval[];
  pendingQuestions: PendingQuestion[];
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
  onRemoveItem: (itemId: string) => void;
  onRemoveTrack: (trackId: string) => void;
  onRemoveGap: (gapId: string) => void;
  onRemoveArtifact: (artifactId: string) => void;
  onClearReferences: () => void;
  onAttachArtifact: (artifactId: string) => void;
  onImportFiles: (files: File[]) => Promise<string[]>;
  importing: boolean;
}) => {
  const [instruction, setInstruction] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [openDocument, setOpenDocument] = useState<StudioReviewDocument | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const followConversationRef = useRef(true);
  const lastCreatorEventIdRef = useRef<string | null>(null);
  const wasSendingRef = useRef(false);
  useEffect(() => {
    if (!draftIntent) return;
    setInstruction(draftIntent.text);
  }, [draftIntent]);
  const latestCreatorEventId = [...events]
    .reverse()
    .find((event) => event.kind === "instruction")?.id;
  useLayoutEffect(() => {
    const creatorSubmitted =
      Boolean(latestCreatorEventId) &&
      latestCreatorEventId !== lastCreatorEventIdRef.current;
    const retryStarted = isSending && !wasSendingRef.current;
    if (creatorSubmitted || retryStarted) {
      followConversationRef.current = true;
    }
    lastCreatorEventIdRef.current = latestCreatorEventId ?? null;
    wasSendingRef.current = isSending;
    if (!followConversationRef.current) return;
    const frame = requestAnimationFrame(() => {
      const conversation = conversationRef.current;
      if (!conversation) return;
      conversation.scrollTo({
        top: conversation.scrollHeight,
        behavior: creatorSubmitted || retryStarted ? "smooth" : "auto",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    activity,
    events,
    isSending,
    latestCreatorEventId,
    pendingApprovals.length,
    pendingQuestions.length,
  ]);
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
  const isVoiceQuestion = (pending: PendingQuestion) =>
    /\b(?:voice|narrat|dub|speaker)\b/i.test(pending.question);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        data-testid="producer-conversation"
        ref={conversationRef}
        onScroll={(event) => {
          const conversation = event.currentTarget;
          followConversationRef.current =
            conversation.scrollHeight -
              conversation.scrollTop -
              conversation.clientHeight <
            72;
        }}
        className="scroll-stable min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {events.length === 0 ? (
          <div className="h-full" />
        ) : (
          <div className="mx-auto w-full max-w-[680px] space-y-3">
            {events.map((event) => {
              if (event.kind === "instruction") {
                return (
                  <div key={event.id} className="flex justify-end py-0.5">
                    <div
                      className={cx(
                        "max-w-[86%] rounded-[14px] rounded-br-[4px] bg-message-user px-3.5 py-2.5 text-message-user-ink",
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
                            {event.detail || "The AI couldn’t answer."}
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
              if (event.kind === "system") {
                return (
                  <div
                    key={event.id}
                    className="flex items-center gap-2 py-1 text-[10px] text-ink-caption"
                    title={event.detail}
                  >
                    <span className="h-px flex-1 bg-line-subtle" />
                    <span>{event.label}</span>
                    <span className="h-px flex-1 bg-line-subtle" />
                  </div>
                );
              }
              const Icon = eventIcon[event.kind];
              const eventArtifact = event.artifactId
                ? artifacts.find((artifact) => artifact.id === event.artifactId)
                : null;
              if (event.kind === "message") {
                return (
                  <div
                    key={event.id}
                    className="grid grid-cols-[20px_minmax(0,1fr)] gap-3 py-1"
                  >
                    <AgentMark />
                    <div className="min-w-0">
                      <p className="whitespace-pre-wrap text-[14px] leading-6 text-ink">
                        {event.label}
                      </p>
                      {event.durationMs === undefined ? null : (
                        <span
                          className="mt-1 block font-mono text-[10px] text-ink-secondary"
                          title={`Completed in ${formatReplyDuration(event.durationMs)}`}
                        >
                          {formatReplyDuration(event.durationMs)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              }
              if (event.kind === "subagent") {
                return (
                  <SubagentCard
                    key={event.id}
                    event={event}
                    onOpenDocument={setOpenDocument}
                  />
                );
              }
              return (
                <div
                  key={event.id}
                  className="ml-8 flex w-[calc(100%-2rem)] gap-2.5 border-l border-line px-3 py-2 text-left"
                >
                  <span
                    className={cx(
                      "mt-0.5 grid size-5 shrink-0 place-items-center text-ink-tertiary",
                      event.kind === "artifact" && "text-action",
                      event.kind === "approval" && "text-warning",
                    )}
                  >
                    {event.document ? (
                      <FileText size={12} />
                    ) : Icon ? (
                      <Icon size={12} />
                    ) : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <strong className="block text-[12px] font-medium leading-5 text-ink-secondary">
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
          <div className="mx-auto grid w-full max-w-[680px] grid-cols-[20px_minmax(0,1fr)] gap-3 py-2 text-[13px]">
            <AgentMark thinking />
            <span className="agent-thinking pt-0.5">{activity}</span>
          </div>
        ) : null}
        {pendingQuestions.map((pending) =>
          isVoiceQuestion(pending) && projectId ? (
            <VoicePickerCard
              key={pending.toolCallId}
              projectId={projectId}
              sampleScript={sampleScript}
              prompt={pending.question}
              onCancel={() => onCancelQuestion(pending)}
              onChoose={(voice) => onAnswerQuestion(pending, voice.id)}
            />
          ) : (
            <QuestionCard
              key={pending.toolCallId}
              pending={pending}
              busy={isAnswering}
              onAnswer={(answer) => onAnswerQuestion(pending, answer)}
              onCancel={() => onCancelQuestion(pending)}
            />
          ),
        )}

        {pendingApprovals.map((pending) => (
          <ApprovalCard
            key={pending.toolCallId}
            pending={pending}
            content={content}
            busy={isApproving}
            onDecision={(status, reason) => onApproval(pending, status, reason)}
          />
        ))}
      </div>

      <form
        data-testid="producer-composer"
        className={cx(
          "m-3 rounded-[18px] border bg-surface-raised shadow-float transition-colors",
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
          onClearReferences();
        }}
      >
        {liveSelection.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line-subtle px-3 py-2">
            <span className="font-mono text-[9px] text-ink-caption">
              {liveSelection.length} selected
            </span>
            {liveSelection.map((reference) => {
              const label =
                reference.type === "item"
                  ? reference.value.label
                  : reference.type === "track"
                    ? reference.value.name
                    : reference.value.label;
              const kind =
                reference.type === "gap" ? "gap" : reference.value.kind;
              return (
                <ReferenceToken
                  key={`selection:${reference.type}:${reference.value.id}`}
                  kind={kind}
                  label={label}
                />
              );
            })}
          </div>
        ) : null}
        {!conversationPaused ? (
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b border-line-subtle px-3 py-2">
            {liveSelection.some((reference) => reference.type === "gap") ? (
              <button
                type="button"
                onClick={() =>
                  setInstruction(
                    "Fill the selected gap with the best available material and show me the plan first.",
                  )
                }
                className="shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[10px] font-medium text-ink-secondary hover:border-action hover:text-ink"
              >
                Fill this gap
              </button>
            ) : null}
            {quickIntents.map((intent) => (
              <button
                key={intent.label}
                type="button"
                onClick={() => setInstruction(intent.prompt)}
                className="shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[10px] font-medium text-ink-secondary hover:border-action hover:text-ink"
              >
                {intent.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex min-h-[88px] flex-col gap-2 px-3 pt-3">
          {references.length > 0 || contextArtifacts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {references.map((reference) => {
                const label =
                  reference.type === "item"
                    ? reference.value.label
                    : reference.type === "track"
                      ? reference.value.name
                      : reference.value.label;
                const kind =
                  reference.type === "gap" ? "gap" : reference.value.kind;
                return (
                  <ReferenceToken
                    key={`${reference.type}:${reference.value.id}`}
                    kind={kind}
                    label={label}
                    removeLabel={`Remove ${label}${reference.type === "track" ? " track" : ""}`}
                    onRemove={() =>
                      reference.type === "item"
                        ? onRemoveItem(reference.value.id)
                        : reference.type === "track"
                          ? onRemoveTrack(reference.value.id)
                          : onRemoveGap(reference.value.id)
                    }
                  />
                );
              })}
              {contextArtifacts.map((artifact) => {
                const original = artifact.provenance.original_filename;
                const label =
                  typeof original === "string" ? original : artifact.kind;
                return (
                  <span
                    key={artifact.id}
                    className="flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 rounded-lg border border-line bg-surface px-1.5 text-[10px] text-ink-secondary"
                  >
                    <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-sunken text-ink-caption">
                      {artifact.kind === "image" ? (
                        <img
                          src={greenlightApi.artifactUrl(artifact.id)}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : artifact.kind === "video" ? (
                        <Film size={11} />
                      ) : artifact.kind === "narration" ? (
                        <Mic2 size={11} />
                      ) : artifact.kind === "caption" ? (
                        <Captions size={11} />
                      ) : (
                        <ImageIcon size={11} />
                      )}
                    </span>
                    <span className="truncate">{label}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${label}`}
                      onClick={() => onRemoveArtifact(artifact.id)}
                      className="-mr-1 grid size-5 shrink-0 place-items-center rounded-full text-ink-caption hover:bg-hover hover:text-ink"
                    >
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
              {references.length + contextArtifacts.length > 1 ? (
                <button
                  type="button"
                  onClick={onClearReferences}
                  className="h-7 shrink-0 rounded-lg px-2 text-[10px] text-ink-tertiary hover:bg-hover hover:text-ink"
                >
                  Clear all
                </button>
              ) : null}
            </div>
          ) : null}
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (
                !shouldSubmitProducerInstruction({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  isComposing: event.nativeEvent.isComposing,
                })
              ) {
                return;
              }
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
            placeholder={
              pendingQuestions.length > 0
                ? "Answer the question above…"
                : pendingApprovals.length > 0
                  ? "Review the change above…"
                  : selection
                    ? "Edit this selection…"
                    : "Direct the production…"
            }
            disabled={conversationPaused}
            rows={3}
            className="min-w-[180px] flex-1 resize-none border-0 bg-transparent px-1 text-[14px] leading-6 text-ink outline-none placeholder:text-ink-caption disabled:cursor-not-allowed disabled:bg-surface-sunken/40"
          />
        </div>
        <div className="flex items-center px-3 pb-2.5 pt-1">
          <span
            className="mr-auto font-mono text-[10px] text-ink-secondary"
            title="Provider-reported cost for this TrueForge session"
          >
            Session cost {formatSessionCost(sessionCostInUsd)}
          </span>
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
            className="ml-1 grid size-8 place-items-center rounded-full bg-control text-control-ink transition-colors hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-30"
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
