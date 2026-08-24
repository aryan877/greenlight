import type {
  Artifact,
  ContentPackage,
  EditorSelection,
} from "@greenlight/contracts";
import { editorPatchInputSchema } from "@greenlight/contracts";
import {
  ArrowUp,
  Bot,
  Captions,
  Check,
  CircleDot,
  Film,
  Image as ImageIcon,
  Mic2,
  MousePointer2,
  Paperclip,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  FileText,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { greenlightApi } from "../api/greenlight.js";
import type {
  PendingToolApproval,
  PendingQuestion,
  StudioAgentEvent,
  StudioReviewDocument,
} from "../api/trueforge.js";
import { MEDIA_ACCEPT, MEDIA_ARTIFACT_MIME } from "../editor/media-transfer.js";
import { cx } from "./controls.js";
import { EditPatchPreview } from "./EditPatchPreview.js";

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
      if ("title" in operation) fields.add("title");
      if ("claim_ids" in operation) fields.add("sources");
      if ("narration" in operation) fields.add("script");
      if ("narration_artifact_id" in operation) fields.add("voice");
      if ("captions_artifact_id" in operation) fields.add("captions");
      if ("transcript_artifact_id" in operation) fields.add("transcript");
      if ("duration_seconds" in operation) fields.add("timing");
      if ("gap_after_seconds" in operation) fields.add("gap");
      if ("source_clip" in operation) fields.add("source range");
      if ("playback_rate" in operation) fields.add("speed");
      if ("visual" in operation) fields.add("visual");
      if (operation.type === "split_scene") fields.add("structure");
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
  artifacts,
  busy,
  onDecision,
}: {
  pending: PendingToolApproval;
  content: ContentPackage | null;
  artifacts: Artifact[];
  busy: boolean;
  onDecision: (status: "allow" | "deny", reason?: string) => void;
}) => {
  const copy = approvalCopy(pending, content);
  const editPatch =
    pending.toolName === "apply_editor_patch"
      ? editorPatchInputSchema.safeParse(pending.arguments)
      : null;
  const [refining, setRefining] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-xl border border-warning/25 bg-warning-soft">
      <div className="border-l-[3px] border-warning p-3">
        <div className="flex items-center gap-2 text-[12px] font-medium text-warning">
          <CircleDot size={14} className="text-warning" />
          Needs your approval
        </div>
        <p className="mt-2 text-[14px] font-medium leading-5 text-ink">
          {copy.title}
        </p>
        <p className="mt-1 text-[12px] leading-5 text-ink-tertiary">
          {copy.detail}
        </p>
        {content && editPatch?.success ? (
          <EditPatchPreview
            artifacts={artifacts}
            content={content}
            patch={editPatch.data}
          />
        ) : null}
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

const ComposerExamples = ({
  sceneCount,
  onChoose,
}: {
  sceneCount: number;
  onChoose: (instruction: string) => void;
}) => {
  const examples: Array<readonly [string, string]> =
    sceneCount > 1
      ? [
          [
            "Tighten",
            "Tighten the pacing across these scenes without changing their meaning. Show the exact timing patch first.",
          ],
          [
            "Merge",
            "Merge the contiguous scenes that belong together into one editable scene bundle. Preview the combined cut first.",
          ],
          [
            "Re-caption",
            "Regenerate and correct captions for these scenes from their measured transcripts. Preview every changed cue.",
          ],
          [
            "Dub",
            "Create a localized voice and caption track for these scenes. Ask me for the language only if it is missing.",
          ],
        ]
      : [
          [
            "Trim",
            "Trim this scene to its strongest ending. Preserve unused source handles, show the resulting gap, and preview the exact new end first.",
          ],
          [
            "Split at word",
            "Split this scene at the spoken word I specify. Resolve its measured timestamp and show the cut in the video preview first.",
          ],
          [
            "Speed",
            "Speed up this scene without clipping speech or captions. Preview the new duration and playback rate first.",
          ],
          [
            "Re-caption",
            "Correct this scene's captions from its measured transcript and preview the changed cues first.",
          ],
        ];
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line-subtle px-3 py-2">
      {examples.map(([label, instruction]) => (
        <button
          key={label}
          type="button"
          onClick={() => onChoose(instruction)}
          className="h-6 shrink-0 border border-line px-2 text-[9px] font-medium text-ink-tertiary hover:border-line-strong hover:bg-hover hover:text-ink"
        >
          {label}
        </button>
      ))}
    </div>
  );
};

export const ProducerPanel = ({
  content,
  artifacts,
  selection,
  contextArtifacts,
  draftIntent,
  events,
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
  onRemoveScene,
  onRemoveArtifact,
  onAttachArtifact,
  onImportFiles,
  importing,
}: {
  content: ContentPackage | null;
  artifacts: Artifact[];
  selection: EditorSelection | null;
  contextArtifacts: Artifact[];
  draftIntent: { id: string; text: string } | null;
  events: StudioAgentEvent[];
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
  onRemoveScene: (sceneId: string) => void;
  onRemoveArtifact: (artifactId: string) => void;
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
  useEffect(() => {
    if (draftIntent) setInstruction(draftIntent.text);
  }, [draftIntent]);
  const conversationPaused =
    pendingQuestions.length > 0 || pendingApprovals.length > 0;

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
                      {event.delivery === "sending" ? (
                        <span className="mt-1 block text-[10px] leading-4 text-white/60">
                          Sending…
                        </span>
                      ) : null}
                      {event.delivery === "failed" ? (
                        <button
                          type="button"
                          onClick={() => onRetryInstruction(event.id)}
                          disabled={isSending}
                          className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-warning hover:underline disabled:opacity-40"
                        >
                          <RotateCcw size={9} /> Retry
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              }
              const Icon = eventIcon[event.kind];
              return (
                <button
                  type="button"
                  key={event.id}
                  disabled={!event.document}
                  onClick={() =>
                    event.document && setOpenDocument(event.document)
                  }
                  className={cx(
                    "flex w-full gap-2.5 rounded-lg px-2 py-2.5 text-left",
                    event.document && "hover:bg-hover",
                  )}
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
                      <span className="mt-1 block text-[11px] font-medium text-action">
                        Open
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

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
          artifacts={artifacts}
          busy={isApproving}
          onDecision={(status, reason) => onApproval(pending, status, reason)}
        />
      ))}

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
        }}
      >
        {selection && content ? (
          <div className="flex max-h-[68px] flex-wrap gap-1.5 overflow-y-auto border-b border-line-subtle px-3 pb-2 pt-2.5">
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
        {selection && !conversationPaused ? (
          <ComposerExamples
            sceneCount={selection.scene_ids.length}
            onChoose={setInstruction}
          />
        ) : null}
        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
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
          className="w-full resize-none border-0 bg-transparent px-4 pt-3 text-[14px] leading-6 text-ink outline-none placeholder:text-ink-caption disabled:cursor-not-allowed disabled:bg-surface-sunken/40"
        />
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
