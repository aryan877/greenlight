import type { ContentPackage, EditorSelection } from "@greenlight/contracts";
import {
  Bot,
  Check,
  CircleDot,
  Film,
  MousePointer2,
  Send,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import type {
  PendingToolApproval,
  StudioAgentEvent,
} from "../api/trueforge.js";
import { cx } from "./controls.js";

const eventIcon: Record<StudioAgentEvent["kind"], typeof Bot> = {
  reasoning: Sparkles,
  tool: SlidersHorizontal,
  artifact: Film,
  approval: CircleDot,
  message: Bot,
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
  busy,
  onDecision,
}: {
  pending: PendingToolApproval;
  content: ContentPackage | null;
  busy: boolean;
  onDecision: (status: "allow" | "deny") => void;
}) => {
  const copy = approvalCopy(pending, content);
  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-xl border border-warning/25 bg-warning-soft">
      <div className="border-l-[3px] border-warning p-3">
        <div className="flex items-center gap-2 text-[10px] font-medium text-warning">
          <CircleDot size={14} className="text-warning" />
          Needs your approval
        </div>
        <p className="mt-2 text-[12px] font-medium text-ink">{copy.title}</p>
        <p className="mt-1 text-[10px] leading-4 text-ink-tertiary">
          {copy.detail}
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecision("allow")}
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink text-[10px] font-medium text-white hover:bg-ink-secondary disabled:opacity-40"
          >
            <Check size={13} /> {copy.action}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecision("deny")}
            className="grid size-8 place-items-center rounded-lg border border-line bg-surface text-ink-tertiary hover:bg-hover disabled:opacity-40"
            aria-label="Deny action"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

export const ProducerPanel = ({
  content,
  selection,
  draftIntent,
  events,
  pendingApprovals,
  isSending,
  isApproving,
  onSend,
  onApproval,
  onRemoveScene,
}: {
  content: ContentPackage | null;
  selection: EditorSelection | null;
  draftIntent: { id: string; text: string } | null;
  events: StudioAgentEvent[];
  pendingApprovals: PendingToolApproval[];
  isSending: boolean;
  isApproving: boolean;
  onSend: (instruction: string) => void;
  onApproval: (pending: PendingToolApproval, status: "allow" | "deny") => void;
  onRemoveScene: (sceneId: string) => void;
}) => {
  const [instruction, setInstruction] = useState("");
  useEffect(() => {
    if (draftIntent) setInstruction(draftIntent.text);
  }, [draftIntent]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-stable min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {events.length === 0 ? (
          <div className="h-full" />
        ) : (
          <div className="space-y-1">
            {events.map((event) => {
              const Icon = eventIcon[event.kind];
              return (
                <div key={event.id} className="flex gap-2.5 px-2 py-2.5">
                  <span
                    className={cx(
                      "grid size-6 shrink-0 place-items-center rounded-full bg-surface-sunken text-ink-tertiary",
                      event.kind === "artifact" && "bg-action-soft text-action",
                      event.kind === "approval" &&
                        "bg-warning-soft text-warning",
                    )}
                  >
                    <Icon size={12} />
                  </span>
                  <div className="min-w-0">
                    <strong className="block text-[10px] font-medium leading-5 text-ink">
                      {event.label}
                    </strong>
                    {event.detail ? (
                      <p className="mt-0.5 line-clamp-5 whitespace-pre-wrap text-[10px] leading-4 text-ink-tertiary">
                        {event.detail}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pendingApprovals.map((pending) => (
        <ApprovalCard
          key={pending.toolCallId}
          pending={pending}
          content={content}
          busy={isApproving}
          onDecision={(status) => onApproval(pending, status)}
        />
      ))}

      <form
        className="m-3 rounded-[20px] border border-line bg-surface-raised shadow-[0_6px_24px_rgb(17_24_39/0.09)]"
        onSubmit={(event) => {
          event.preventDefault();
          const next = instruction.trim();
          if (!next || isSending) return;
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
          </div>
        ) : null}
        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={
            selection ? "Edit this selection…" : "Direct the production…"
          }
          rows={3}
          className="w-full resize-none border-0 bg-transparent px-4 pt-3 text-[12px] leading-5 text-ink outline-none placeholder:text-ink-caption"
        />
        <div className="flex items-center justify-end px-3 pb-2.5 pt-1">
          <button
            type="submit"
            aria-label="Send instruction"
            disabled={!instruction.trim() || isSending}
            className="ml-auto grid size-8 place-items-center rounded-full bg-ink text-white transition-colors hover:bg-ink-secondary disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Send size={14} />
          </button>
        </div>
      </form>
    </div>
  );
};
