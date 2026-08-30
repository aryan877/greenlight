import {
  editorPatchInputSchema,
  type Artifact,
  type ContentPackage,
  type EditorSelection,
  type EditorTimelineGap,
  type EditorTimelineItem,
  type EditorTimelineTrack,
} from "@greenlight/contracts";
import {
  Blend,
  ArrowUp,
  BookOpen,
  Captions,
  Check,
  ChevronDown,
  Film,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Mic2,
  Paperclip,
  Play,
  RotateCcw,
  Search,
  Square,
  Split,
  FileText,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { greenlightApi, type VoiceOption } from "../api/greenlight.js";
import {
  useVoiceCapabilities,
  useVoiceSample,
} from "../hooks/use-greenlight-queries.js";
import { GreenlightMark, TrueForgeIcon } from "../brand-icons.js";
import type {
  PendingToolApproval,
  PendingQuestion,
  StudioAgentEvent,
  StudioReviewDocument,
} from "../hooks/use-producer-agent.js";
import { MEDIA_ACCEPT, MEDIA_ARTIFACT_MIME } from "../editor/media-transfer.js";
import { shouldSubmitProducerInstruction } from "../editor/producer-composer.js";
import type { ProducerDraftIntent } from "../editor/producer-draft.js";
import { cx } from "./controls.js";
import { PromptLibraryModal } from "./prompt-library-modal.js";

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

const CreatorMessage = ({
  event,
  isSending,
  onRetry,
}: {
  event: StudioAgentEvent;
  isSending: boolean;
  onRetry: () => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const collapsible =
    event.label.length > 320 || event.label.split("\n").length > 6;
  return (
    <div className="flex justify-end py-0.5">
      <div
        className={cx(
          "max-w-[86%] rounded-[14px] rounded-br-[4px] bg-message-user px-3.5 py-2.5 text-message-user-ink",
          event.delivery === "failed" &&
            "border border-warning/30 bg-warning-soft text-ink",
        )}
      >
        <p
          className={cx(
            "whitespace-pre-wrap text-[14px] leading-6",
            collapsible && !expanded && "line-clamp-6",
          )}
        >
          {event.label}
        </p>
        {collapsible ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="mt-1 text-[11px] font-medium opacity-65 hover:opacity-100"
          >
            {expanded ? "Show less" : "Show full prompt"}
          </button>
        ) : null}
        {event.delivery === "failed" ? (
          <div className="mt-2 border-t border-warning/20 pt-2">
            <p className="text-[12px] leading-5 text-ink-secondary">
              {event.detail || "The AI couldn’t answer."}
            </p>
            <button
              type="button"
              onClick={onRetry}
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
};

const SubagentMark = ({
  running,
  failed,
}: {
  running: boolean;
  failed: boolean;
}) => (
  <span
    className={cx(
      "relative grid size-7 shrink-0 place-items-center rounded-full bg-track-voice text-track-voice-strong",
      failed && "bg-warning-soft text-warning",
    )}
  >
    <GreenlightMark
      size={16}
      strokeWidth={1.9}
      className={cx(running && "motion-safe:animate-spin")}
    />
    <span
      className={cx(
        "absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-surface bg-track-voice-strong",
        failed && "bg-warning",
      )}
    />
  </span>
);

const InlineResearchText = ({ value }: { value: string }) => {
  const parts = value.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
  return parts.map((part, index) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold) return <strong key={index}>{bold[1]}</strong>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(part);
    if (link) {
      return (
        <a
          key={index}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="text-action underline decoration-action/35 underline-offset-2 hover:decoration-action"
        >
          {link[1]}
        </a>
      );
    }
    return part;
  });
};

const ResearchResult = ({ value }: { value: string }) => (
  <div className="mt-3 max-h-[26rem] space-y-2 overflow-y-auto border-t border-line-subtle pt-3 pr-1 text-[11px] leading-5 text-ink-secondary">
    {value.split("\n").flatMap((rawLine, index) => {
      const line = rawLine.trim();
      if (!line || /^(?:-{3,}|\.\.\.)$/.test(line)) return [];
      const heading = /^#{1,6}\s+(.+)$/.exec(line);
      const bullet = /^(?:[-*•])\s+(.+)$/.exec(line);
      if (heading) {
        return [
          <h4 key={index} className="pt-1 text-[12px] font-semibold text-ink">
            <InlineResearchText value={heading[1]!} />
          </h4>,
        ];
      }
      if (bullet) {
        return [
          <div key={index} className="grid grid-cols-[10px_1fr] gap-1.5">
            <span aria-hidden="true" className="text-action">
              •
            </span>
            <p>
              <InlineResearchText value={bullet[1]!} />
            </p>
          </div>,
        ];
      }
      return [
        <p key={index}>
          <InlineResearchText value={line} />
        </p>,
      ];
    })}
  </div>
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
  const shouldStayOpen = Boolean(event.document);
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
    <section className="w-full overflow-hidden rounded-lg border border-line bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-surface-raised"
      >
        <SubagentMark running={running} failed={failed} />
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] text-track-voice-strong">
            Subagent
          </span>
          <strong className="mt-0.5 line-clamp-2 block text-[12px] font-medium leading-5 text-ink">
            {event.label}
          </strong>
        </span>
        <span
          className={cx(
            "flex shrink-0 items-center gap-1 text-[10px] font-medium text-ink-tertiary",
            failed && "text-warning",
          )}
        >
          {!running && !failed ? <Check size={11} /> : null}
          {event.detail}
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
            <ResearchResult value={run.result} />
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

type ApprovalCopy = {
  title: string;
  detail: string;
  action: string;
  blocked?: boolean;
};

export const approvalCopy = (
  pending: PendingToolApproval,
  content: ContentPackage | null,
  artifacts: Artifact[] = [],
): ApprovalCopy => {
  if (pending.toolName === "apply_editor_patch") {
    const parsed = editorPatchInputSchema.safeParse(pending.arguments);
    if (!parsed.success) {
      return {
        title: "Preview is not ready",
        detail: "Ask AI Producer to rebuild this change before applying it.",
        action: "Unavailable",
        blocked: true,
      };
    }
    const operations = parsed.data.operations as unknown as Array<
      Record<string, unknown>
    >;
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
    const updatesNarration = operations.some(
      (operation) =>
        operation.narration_artifact_id !== undefined ||
        operation.captions_artifact_id !== undefined ||
        operation.transcript_artifact_id !== undefined ||
        (operation.type === "upsert_audio_track" &&
          (operation.track as Record<string, unknown> | undefined)?.role ===
            "narration"),
    );
    const videoTracks = operations
      .filter((operation) => operation.type === "upsert_video_track")
      .map((operation) => operation.track)
      .filter(
        (track): track is Record<string, unknown> =>
          Boolean(track) && typeof track === "object",
      );
    const videoClipCount = videoTracks.reduce(
      (count, track) =>
        count + (Array.isArray(track.clips) ? track.clips.length : 0),
      0,
    );
    const updatesVisuals =
      videoTracks.length > 0 ||
      operations.some((operation) => operation.visual !== undefined);
    const transitionOperations = operations.filter(
      (operation) =>
        operation.type === "upsert_transition_track" ||
        operation.type === "update_transition_clip",
    );
    const audioTracks = operations
      .filter((operation) => operation.type === "upsert_audio_track")
      .map((operation) => operation.track)
      .filter(
        (track): track is Record<string, unknown> =>
          Boolean(track) && typeof track === "object",
      );
    const dubTrack = audioTracks.find((track) => track.role === "dub");
    const musicTrack = audioTracks.find((track) => track.role === "music");
    const thumbnailCount = operations.reduce((count, operation) => {
      if (operation.type !== "update_release") return count;
      const release = operation.release;
      if (!release || typeof release !== "object") return count;
      const candidates = (release as Record<string, unknown>)
        .thumbnail_candidate_artifact_ids;
      return Math.max(count, Array.isArray(candidates) ? candidates.length : 0);
    }, 0);
    if (transitionOperations.length > 0) {
      const transitionCount = transitionOperations.reduce(
        (count, operation) => {
          if (operation.type !== "upsert_transition_track") return count + 1;
          const track = operation.track;
          if (!track || typeof track !== "object") return count;
          const clips = (track as Record<string, unknown>).clips;
          return count + (Array.isArray(clips) ? clips.length : 0);
        },
        0,
      );
      if (musicTrack || thumbnailCount > 0) {
        const additions = [
          `${transitionCount} ${transitionCount === 1 ? "transition" : "transitions"}`,
          ...(musicTrack ? ["a quiet ducked music bed"] : []),
          ...(thumbnailCount > 0
            ? [
                `${thumbnailCount} ${thumbnailCount === 1 ? "thumbnail" : "thumbnail candidates"}`,
              ]
            : []),
        ];
        return {
          title: "Polish the locked cut",
          detail: `Add ${additions.join(", ")}. Scene timing, narration, and captions stay unchanged.`,
          action: "Apply polish",
        };
      }
      return {
        title: `Add ${transitionCount} subtle ${transitionCount === 1 ? "transition" : "transitions"}`,
        detail: `Place them on the ${transitionCount} real ${transitionCount === 1 ? "cut" : "cuts"}. Scene timing, narration, captions, and release stay unchanged.`,
        action: "Add transitions",
      };
    }
    for (const operation of operations) {
      if (operation.title !== undefined) fields.add("title");
      if (operation.claim_ids !== undefined) fields.add("sources");
      if (operation.narration !== undefined) fields.add("script");
      if (operation.narration_artifact_id !== undefined) fields.add("voice");
      if (
        operation.captions_artifact_id !== undefined ||
        operation.transcript_artifact_id !== undefined
      ) {
        fields.add("timed captions");
      }
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
    if (dubTrack) {
      const locale = typeof dubTrack.locale === "string" ? dubTrack.locale : "";
      const language = locale.toLowerCase().startsWith("hi")
        ? "Hindi"
        : locale || "alternate-language";
      const clipCount = Array.isArray(dubTrack.clips)
        ? dubTrack.clips.length
        : content?.scenes.length || 1;
      return {
        title: `Add the ${language} dub`,
        detail: `${clipCount} separate voice clips will follow the existing scene cuts. The original narration stays available and video timing does not change.`,
        action: `Add ${language} dub`,
      };
    }
    if (musicTrack) {
      return {
        title: "Add background music",
        detail:
          "Place one licensed music bed under the full cut, keep speech clear with ducking, and leave every video cut unchanged.",
        action: "Add music",
      };
    }
    if (updatesNarration && updatesVisuals) {
      const count = sceneIds.length || content?.scenes.length || 1;
      return {
        title: `Build the complete ${count}-scene cut`,
        detail: `Place ${videoClipCount || "the"} licensed B-roll ${videoClipCount === 1 ? "clip" : "clips"}, add the chosen narration and measured captions, and keep the release unchanged.`,
        action: "Build cut",
      };
    }
    if (updatesNarration) {
      const count = sceneIds.length || content?.scenes.length || 1;
      const allScenes = count === content?.scenes.length;
      return {
        title: `Add narration to ${allScenes ? "all " : ""}${count} ${count === 1 ? "scene" : "scenes"}`,
        detail:
          "Use the chosen voice, add measured captions, normalize speech, and duck the music. Script, visuals, thumbnail, and release stay unchanged.",
        action: "Add narration",
      };
    }
    if (updatesVisuals) {
      const count = sceneIds.length || content?.scenes.length || 1;
      const allScenes = count === content?.scenes.length;
      const visualArtifactIds = operations.flatMap((operation) => {
        const visual = operation.visual;
        if (!visual || typeof visual !== "object") return [];
        const ids = (visual as { artifact_ids?: unknown }).artifact_ids;
        return Array.isArray(ids)
          ? ids.filter((id): id is string => typeof id === "string")
          : [];
      });
      const visualSources = visualArtifactIds.flatMap((id) => {
        const artifact = artifacts.find((candidate) => candidate.id === id);
        const provider = artifact?.provenance.provider;
        const source = artifact?.provenance.source;
        return [provider, source].filter(
          (value): value is string => typeof value === "string",
        );
      });
      const usesPexels = visualSources.some((value) => /pexels/i.test(value));
      const usesOpenMoji = visualSources.some((value) =>
        /openmoji/i.test(value),
      );
      return {
        title: `Add visuals to ${allScenes ? "all " : ""}${count} ${count === 1 ? "scene" : "scenes"}`,
        detail: usesPexels
          ? `Place licensed Pexels B-roll${usesOpenMoji ? " and OpenMoji illustrations" : ""} into the selected scenes. Script, narration, captions, and release stay unchanged.`
          : "Place licensed OpenMoji illustrations in the selected scenes. Script, narration, captions, and release stay unchanged.",
        action: "Add visuals",
      };
    }
    if (updatesRelease) {
      return {
        title: "Update the YouTube package",
        detail:
          "Save the reviewed thumbnail or metadata choice. The cut itself stays unchanged.",
        action: "Save release",
      };
    }
    const target = updatesRelease
      ? "the YouTube release"
      : names.length > 0
        ? names.length === 1
          ? `“${names[0]}”`
          : `${names.length} scenes`
        : "the selected edit";
    const changes = fields.size > 0 ? [...fields].join(", ") : "scene content";
    return {
      title: `Update ${target}`,
      detail: `Change ${changes}. Everything else stays as it is.`,
      action: "Apply change",
    };
  }
  if (pending.toolName === "generate_voice") {
    const sceneId =
      typeof pending.arguments.scene_id === "string"
        ? pending.arguments.scene_id
        : null;
    const scene = content?.scenes.find((candidate) => candidate.id === sceneId);
    const locale =
      typeof pending.arguments.locale === "string"
        ? pending.arguments.locale
        : null;
    return {
      title: `Generate voice${scene ? ` for “${scene.title}”` : ""}`,
      detail: `Create one synthetic ${locale?.toLowerCase().startsWith("hi") ? "Hindi dub" : "narration"} clip. It will not enter the timeline until you approve the edit preview.`,
      action: "Generate voice",
    };
  }
  if (pending.toolName === "transcribe_audio") {
    const sceneId =
      typeof pending.arguments.scene_id === "string"
        ? pending.arguments.scene_id
        : null;
    const scene = content?.scenes.find((candidate) => candidate.id === sceneId);
    return {
      title: `Create timed captions${scene ? ` for “${scene.title}”` : ""}`,
      detail:
        "Measure the spoken words and create synchronized captions. The audio and cut remain unchanged.",
      action: "Create captions",
    };
  }
  if (pending.toolName === "generate_image") {
    const kind =
      pending.arguments.kind === "thumbnail" ? "thumbnail" : "visual";
    return {
      title: `Generate one ${kind}`,
      detail:
        "Create one new GPT Image 2 asset at low quality. It will not enter the cut or release until you approve a separate edit.",
      action: `Generate ${kind}`,
    };
  }
  if (pending.toolName === "generate_sound_effect") {
    return {
      title: "Generate one sound effect",
      detail:
        "Create a short synthetic sound. It will not enter the timeline until you approve the edit preview.",
      action: "Generate sound",
    };
  }
  if (pending.toolName === "render_video") {
    return {
      title: "Render the current cut",
      detail: "Create a new MP4 from this revision.",
      action: "Render",
    };
  }
  if (pending.toolName === "import_media_library_asset") {
    const provider = String(pending.arguments.provider ?? "");
    const use = String(pending.arguments.use ?? "");
    if (provider === "pexels" && use === "broll") {
      return {
        title: "Import licensed Pexels B-roll",
        detail:
          "Save one selected video and its Pexels license receipt to this project. It will not enter the timeline yet.",
        action: "Import B-roll",
      };
    }
    return {
      title:
        use === "sound_effect"
          ? "Import a licensed sound effect"
          : "Import licensed music",
      detail:
        "Save one commercially usable Openverse asset and its license receipt to this project. Nothing is added to the timeline yet.",
      action: use === "sound_effect" ? "Import sound" : "Import music",
    };
  }
  if (pending.toolName === "stage_video_unlisted") {
    return {
      title: "Upload to YouTube for review",
      detail:
        "Greenlight requests unlisted. Google may keep a new API project's upload private until it is audited.",
      action: "Upload for review",
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
  decision,
  onDecision,
}: {
  pending: PendingToolApproval;
  content: ContentPackage | null;
  artifacts: Artifact[];
  busy: boolean;
  decision?: NonNullable<NonNullable<StudioAgentEvent["approval"]>["decision"]>;
  onDecision: (status: "allow" | "deny", reason?: string) => void;
}) => {
  const copy = approvalCopy(pending, content, artifacts);
  const [refining, setRefining] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="px-3.5 py-3">
        <div className="flex items-center gap-2 text-[10px] font-medium text-ink-tertiary">
          {decision ? "Decision recorded" : "Your approval is required"}
          {decision ? (
            <span
              className={cx(
                "ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium",
                decision.status === "allow"
                  ? "bg-action-soft text-action"
                  : "bg-warning-soft text-warning",
              )}
            >
              {decision.status === "allow" ? <Check size={10} /> : null}
              {decision.label}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-[13px] font-medium leading-5 text-ink">
          {copy.title}
        </p>
        <p className="mt-0.5 text-[11px] leading-5 text-ink-tertiary">
          {copy.detail}
        </p>
        {decision ? (
          decision.reason ? (
            <p className="mt-2 border-l-2 border-warning pl-2 text-[11px] leading-5 text-ink-secondary">
              {decision.reason}
            </p>
          ) : null
        ) : refining ? (
          <div className="mt-3">
            <textarea
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What should change?"
              rows={2}
              className="w-full resize-none border border-line bg-surface px-3 py-2 text-[13px] leading-5 text-ink outline-none placeholder:text-ink-caption focus:border-action"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRefining(false)}
                className="h-8 rounded-md px-2 text-[11px] text-ink-tertiary hover:bg-hover hover:text-ink"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!reason.trim() || busy}
                onClick={() => onDecision("deny", reason.trim())}
                className="h-8 rounded-md bg-control px-3 text-[11px] font-medium text-control-ink disabled:opacity-30"
              >
                Send changes
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-subtle pt-3">
            {!copy.blocked ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onDecision("allow")}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-control px-3 text-[11px] font-medium text-control-ink hover:bg-control-hover disabled:opacity-40"
              >
                <Check size={13} /> {copy.action}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => setRefining(true)}
              className={cx(
                "h-8 rounded-md border border-line bg-surface px-3 text-[11px] text-ink-secondary hover:bg-hover disabled:opacity-40",
                copy.blocked && "flex-1",
              )}
            >
              {copy.blocked ? "Rebuild preview" : "Request changes"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecision("deny", "Cancelled by the creator.")}
              className="h-8 rounded-md px-2 text-[11px] text-ink-tertiary hover:bg-hover hover:text-ink disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

type ProducerConversationBlock =
  | { kind: "event"; event: StudioAgentEvent }
  | {
      kind: "turn";
      id: string;
      turnId?: string;
      events: StudioAgentEvent[];
    };

export const groupProducerEvents = (
  events: StudioAgentEvent[],
): ProducerConversationBlock[] => {
  const blocks: ProducerConversationBlock[] = [];
  for (const event of events) {
    const belongsToGreenlight = !["instruction", "system"].includes(event.kind);
    const previous = blocks.at(-1);
    if (
      belongsToGreenlight &&
      previous?.kind === "turn" &&
      previous.turnId === event.turnId &&
      Boolean(event.turnId)
    ) {
      previous.events.push(event);
      continue;
    }
    blocks.push(
      belongsToGreenlight
        ? {
            kind: "turn",
            id: `turn-${event.turnId ?? event.id}`,
            ...(event.turnId ? { turnId: event.turnId } : {}),
            events: [event],
          }
        : { kind: "event", event },
    );
  }
  return blocks;
};

export const groupExecutionEvents = (
  events: StudioAgentEvent[],
): Array<{ event: StudioAgentEvent; count: number }> => {
  const rows: Array<{ event: StudioAgentEvent; count: number }> = [];
  const grouped = new Map<string, number>();
  const visibleEvents = events.filter((event, index) => {
    const failedTool = event.tool;
    if (!failedTool || event.status !== "error") return true;
    return !events
      .slice(index + 1)
      .some(
        (candidate) =>
          candidate.tool?.name === failedTool.name &&
          candidate.tool.server === failedTool.server &&
          candidate.status === "done",
      );
  });
  for (const event of visibleEvents) {
    if (!event.tool) {
      rows.push({ event, count: 1 });
      continue;
    }
    const key = [
      event.tool.server ?? "trueforge",
      event.tool.name,
      event.label,
      event.detail,
    ].join(":");
    const rowIndex = grouped.get(key);
    if (rowIndex === undefined) {
      grouped.set(key, rows.length);
      rows.push({ event, count: 1 });
      continue;
    }
    const row = rows[rowIndex]!;
    rows[rowIndex] = {
      event: {
        ...row.event,
        status:
          row.event.status === "running" || event.status === "running"
            ? "running"
            : event.status,
      },
      count: row.count + 1,
    };
  }
  return rows;
};

const ExecutionStepsCard = ({
  events,
  content,
  artifacts,
  busy,
  onApproval,
  onOpenDocument,
}: {
  events: StudioAgentEvent[];
  content: ContentPackage | null;
  artifacts: Artifact[];
  busy: boolean;
  onApproval: (
    pending: PendingToolApproval,
    status: "allow" | "deny",
    reason?: string,
  ) => void;
  onOpenDocument: (document: StudioReviewDocument) => void;
}) => {
  const active = events.some(
    (event) =>
      event.status === "running" ||
      (event.kind === "approval" && !event.approval?.decision),
  );
  const hasReviewDocument = events.some((event) => Boolean(event.document));
  const [open, setOpen] = useState(active || hasReviewDocument);
  const wasActive = useRef(active);
  useEffect(() => {
    if (active || hasReviewDocument) setOpen(true);
    else if (wasActive.current) setOpen(false);
    wasActive.current = active;
  }, [active, hasReviewDocument]);
  const toolCount = events.filter((event) => Boolean(event.tool)).length;
  const subagentCount = events.filter(
    (event) => event.kind === "subagent",
  ).length;
  const decisionCount = events.filter(
    (event) => event.kind === "approval" || event.kind === "question",
  ).length;
  const visibleEvents = groupExecutionEvents(events);
  const counts = [
    toolCount ? `${toolCount} ${toolCount === 1 ? "tool" : "tools"}` : "",
    subagentCount
      ? `${subagentCount} ${subagentCount === 1 ? "subagent" : "subagents"}`
      : "",
    decisionCount
      ? `${decisionCount} ${decisionCount === 1 ? "decision" : "decisions"}`
      : "",
  ].filter(Boolean);

  return (
    <section className="w-full overflow-hidden rounded-lg border border-line bg-surface-sunken">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-hover"
      >
        {active ? (
          <LoaderCircle
            size={13}
            className="shrink-0 animate-spin text-action"
          />
        ) : (
          <Check size={13} className="shrink-0 text-action" />
        )}
        <strong className="text-[11px] font-medium text-ink">
          Producer steps
        </strong>
        <span className="min-w-0 flex-1 truncate text-[10px] text-ink-tertiary">
          {counts.join(" · ")}
        </span>
        <ChevronDown
          size={13}
          className={cx(
            "shrink-0 text-ink-tertiary transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-line-subtle p-2.5">
          {visibleEvents.map(({ event, count }) => {
            if (event.kind === "subagent") {
              return (
                <SubagentCard
                  key={event.id}
                  event={event}
                  onOpenDocument={onOpenDocument}
                />
              );
            }
            if (event.kind === "approval" && event.approval) {
              return (
                <ApprovalCard
                  key={event.id}
                  pending={event.approval.pending}
                  content={content}
                  artifacts={artifacts}
                  busy={busy}
                  decision={event.approval.decision}
                  onDecision={(status, reason) =>
                    onApproval(event.approval!.pending, status, reason)
                  }
                />
              );
            }
            if (event.kind === "question" && event.question) {
              return event.question.answer ? (
                <section
                  key={event.id}
                  className="rounded-lg border border-line bg-surface px-3.5 py-3"
                >
                  <div className="flex items-center gap-2 text-[10px] font-medium text-ink-tertiary">
                    Answer recorded
                    <span className="ml-auto inline-flex max-w-[55%] truncate rounded-md bg-action-soft px-2 py-0.5 text-action">
                      {event.question.answer}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-5 text-ink-secondary">
                    {event.question.pending.question}
                  </p>
                </section>
              ) : null;
            }
            const eventArtifact = event.artifactId
              ? artifacts.find((artifact) => artifact.id === event.artifactId)
              : null;
            return (
              <div
                key={event.id}
                className="flex min-w-0 items-start gap-2.5 rounded-md px-2 py-1.5"
              >
                {event.status === "running" ? (
                  <LoaderCircle
                    size={12}
                    className="mt-0.5 shrink-0 animate-spin text-action"
                  />
                ) : event.status === "error" ? (
                  <X size={12} className="mt-0.5 shrink-0 text-warning" />
                ) : (
                  <Check size={12} className="mt-0.5 shrink-0 text-action" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[11px] font-medium text-ink-secondary">
                      {event.label}
                    </span>
                    {count > 1 ? (
                      <span className="shrink-0 font-mono text-[9px] text-ink-caption">
                        ×{count}
                      </span>
                    ) : null}
                    {event.tool ? (
                      <span className="ml-auto shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[9px] text-ink-tertiary">
                        {event.tool.server
                          ? `${event.tool.server === "greenlight" ? "Greenlight" : event.tool.server} MCP`
                          : "TrueForge"}
                      </span>
                    ) : null}
                  </div>
                  {event.detail &&
                  !/^(?:TrueForge|(?:Greenlight|Exa) MCP)$/.test(
                    event.detail,
                  ) ? (
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-ink-tertiary">
                      {event.detail}
                    </p>
                  ) : null}
                  {event.document ? (
                    <button
                      type="button"
                      onClick={() => onOpenDocument(event.document!)}
                      className="mt-1 text-[10px] font-medium text-action hover:underline"
                    >
                      Review document
                    </button>
                  ) : null}
                  {eventArtifact ? (
                    <a
                      href={greenlightApi.artifactUrl(eventArtifact.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block text-[10px] font-medium text-action hover:underline"
                    >
                      Open media
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
};

const ProductionPlanCard = ({ event }: { event: StudioAgentEvent }) => {
  const plan = event.plan;
  if (!plan || plan.steps.length === 0) return null;
  const completed = plan.steps.filter(
    (step) => step.status === "completed",
  ).length;
  const allDone = completed === plan.steps.length;

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line-subtle px-3.5 py-2.5">
        {allDone ? (
          <Check size={14} className="shrink-0 text-action" />
        ) : (
          <LoaderCircle
            size={14}
            className="shrink-0 animate-spin text-action"
          />
        )}
        <strong className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
          {plan.title}
        </strong>
        <span className="font-mono text-[10px] text-ink-tertiary">
          {completed}/{plan.steps.length}
        </span>
      </div>
      <ol className="px-3.5 py-2.5">
        {plan.steps.map((step) => (
          <li
            key={step.id}
            className="flex min-h-7 items-center gap-2.5 text-[11px]"
          >
            {step.status === "completed" ? (
              <span className="grid size-4 shrink-0 place-items-center rounded-full bg-action-soft text-action">
                <Check size={10} strokeWidth={2.5} />
              </span>
            ) : step.status === "in_progress" ? (
              <span className="grid size-4 shrink-0 place-items-center rounded-full border border-action">
                <span className="size-1.5 animate-pulse rounded-full bg-action" />
              </span>
            ) : step.status === "blocked" ? (
              <span className="grid size-4 shrink-0 place-items-center rounded-full border border-warning text-warning">
                <X size={10} strokeWidth={2.5} />
              </span>
            ) : (
              <span className="size-4 shrink-0 rounded-full border border-line-strong" />
            )}
            <span
              className={cx(
                "min-w-0 flex-1",
                step.status === "completed"
                  ? "text-ink-secondary"
                  : step.status === "pending"
                    ? "text-ink-tertiary"
                    : step.status === "blocked"
                      ? "text-warning"
                      : "font-medium text-ink",
              )}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
};

const ProducerTurn = ({
  block,
  activity,
  content,
  artifacts,
  busy,
  onApproval,
  onOpenDocument,
}: {
  block: Extract<ProducerConversationBlock, { kind: "turn" }>;
  activity: string | null;
  content: ContentPackage | null;
  artifacts: Artifact[];
  busy: boolean;
  onApproval: (
    pending: PendingToolApproval,
    status: "allow" | "deny",
    reason?: string,
  ) => void;
  onOpenDocument: (document: StudioReviewDocument) => void;
}) => {
  const segments: Array<
    | { kind: "message"; event: StudioAgentEvent }
    | { kind: "plan"; event: StudioAgentEvent }
    | { kind: "steps"; id: string; events: StudioAgentEvent[] }
  > = [];
  for (const event of block.events) {
    if (event.kind === "message") {
      segments.push({ kind: "message", event });
      continue;
    }
    if (event.kind === "plan") {
      segments.push({ kind: "plan", event });
      continue;
    }
    const previous = segments.at(-1);
    if (previous?.kind === "steps") {
      previous.events.push(event);
    } else {
      segments.push({
        kind: "steps",
        id: `steps-${event.id}`,
        events: [event],
      });
    }
  }
  const running = block.events.some((event) => event.status === "running");

  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-3 py-1">
      <AgentMark thinking={running && Boolean(activity)} />
      <div className="min-w-0 space-y-2.5">
        {segments.map((segment) =>
          segment.kind === "message" ? (
            <div key={segment.event.id}>
              <p className="whitespace-pre-wrap text-[14px] leading-6 text-ink">
                {segment.event.label}
              </p>
              {segment.event.durationMs === undefined ? null : (
                <span
                  className="mt-1 block font-mono text-[10px] text-ink-secondary"
                  title={`Completed in ${formatReplyDuration(segment.event.durationMs)}`}
                >
                  {formatReplyDuration(segment.event.durationMs)}
                </span>
              )}
            </div>
          ) : segment.kind === "plan" ? (
            <ProductionPlanCard key={segment.event.id} event={segment.event} />
          ) : (
            <ExecutionStepsCard
              key={segment.id}
              events={segment.events}
              content={content}
              artifacts={artifacts}
              busy={busy}
              onApproval={onApproval}
              onOpenDocument={onOpenDocument}
            />
          ),
        )}
        {activity ? (
          <p className="agent-thinking text-[11px] text-ink-tertiary">
            {activity}
          </p>
        ) : null}
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
    <article className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-float">
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
      <div className="scroll-stable min-h-0 overflow-y-auto bg-surface-sunken px-6 py-5">
        {document.sections.map((section) => (
          <section
            key={section.title}
            className="mb-3 border border-line bg-surface px-4 py-4 last:mb-0"
          >
            <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-action">
              {section.title}
            </h3>
            <div className="mt-3 divide-y divide-line-subtle">
              {section.lines.map((line, index) => {
                const field = /^(Narration|Visual) · ([\s\S]+)$/.exec(line);
                return (
                  <div
                    key={`${section.title}-${index}`}
                    className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[76px_minmax(0,1fr)] sm:gap-4"
                  >
                    {field ? (
                      <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-caption">
                        {field[1]}
                      </span>
                    ) : null}
                    <p
                      className={cx(
                        "text-[13px] leading-6 text-ink-secondary",
                        !field && "sm:col-span-2",
                      )}
                    >
                      {field?.[2] ?? line}
                    </p>
                  </div>
                );
              })}
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
  sessionId,
  sessionCostInUsd,
  activity,
  pendingApprovals,
  pendingQuestions,
  isSending,
  isApproving,
  isAnswering,
  canStop,
  isStopping,
  onSend,
  onStop,
  onRetryInstruction,
  onApproval,
  onAnswerQuestion,
  onCancelQuestion,
  onRemoveItem,
  onRemoveTrack,
  onRemoveGap,
  onRemoveArtifact,
  onClearSelection,
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
  sessionId: string | null;
  sessionCostInUsd: number | null;
  activity: string | null;
  pendingApprovals: PendingToolApproval[];
  pendingQuestions: PendingQuestion[];
  isSending: boolean;
  isApproving: boolean;
  isAnswering: boolean;
  canStop: boolean;
  isStopping: boolean;
  onSend: (instruction: string) => void;
  onStop: () => void;
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
  onClearSelection: () => void;
  onClearReferences: () => void;
  onAttachArtifact: (artifactId: string) => void;
  onImportFiles: (files: File[]) => Promise<string[]>;
  importing: boolean;
}) => {
  const [instruction, setInstruction] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [selectionHasMore, setSelectionHasMore] = useState(false);
  const [openDocument, setOpenDocument] = useState<StudioReviewDocument | null>(
    null,
  );
  const autoOpenedDocumentRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectionScrollRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const followConversationRef = useRef(true);
  const lastCreatorEventIdRef = useRef<string | null>(null);
  const wasSendingRef = useRef(false);
  useEffect(() => {
    if (!draftIntent) return;
    setInstruction(draftIntent.text);
  }, [draftIntent]);
  useLayoutEffect(() => {
    const scroller = selectionScrollRef.current;
    if (!scroller) {
      setSelectionHasMore(false);
      return;
    }
    const update = () => {
      setSelectionHasMore(
        scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 4,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [liveSelection.length]);
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
    /\b(?:choose|pick|select|audition)\b.{0,80}\b(?:voice|speaker|narrator)\b|\b(?:voice|speaker|narrator)\b.{0,80}\b(?:choose|pick|select|audition)\b|\b(?:which|what)\b.{0,80}\b(?:voice|speaker|narrator)\b|\bnarrator voice\b/i.test(
      pending.question,
    );
  const conversationBlocks = groupProducerEvents(events);
  const pendingScriptDocument = [...events]
    .reverse()
    .find((event) => event.document?.title === "Script draft");
  useEffect(() => {
    if (
      !pendingScriptDocument?.document ||
      pendingQuestions.length === 0 ||
      autoOpenedDocumentRef.current === pendingScriptDocument.id
    ) {
      return;
    }
    autoOpenedDocumentRef.current = pendingScriptDocument.id;
    setOpenDocument(pendingScriptDocument.document);
  }, [pendingQuestions.length, pendingScriptDocument]);

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
            {conversationBlocks.map((block, index) => {
              if (block.kind === "turn") {
                return (
                  <ProducerTurn
                    key={block.id}
                    block={block}
                    activity={
                      index === conversationBlocks.length - 1 ? activity : null
                    }
                    content={content}
                    artifacts={artifacts}
                    busy={isApproving}
                    onApproval={onApproval}
                    onOpenDocument={setOpenDocument}
                  />
                );
              }
              const event = block.event;
              if (event.kind === "instruction") {
                return (
                  <CreatorMessage
                    key={event.id}
                    event={event}
                    isSending={isSending}
                    onRetry={() => onRetryInstruction(event.id)}
                  />
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
              return null;
            })}
          </div>
        )}
        {activity && conversationBlocks.at(-1)?.kind !== "turn" ? (
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
              onChoose={(voice) =>
                onAnswerQuestion(
                  pending,
                  `Approved. Use ${voice.id} for this production and continue.`,
                )
              }
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
          <div className="relative border-b border-line-subtle">
            <div className="flex h-9 items-center justify-between px-3">
              <span className="font-mono text-[9px] text-ink-caption">
                {liveSelection.length} selected
              </span>
              <button
                type="button"
                aria-label="Clear editor selection"
                title="Clear selection"
                onClick={onClearSelection}
                className="grid size-6 place-items-center rounded-full text-ink-caption hover:bg-hover hover:text-ink"
              >
                <X size={12} />
              </button>
            </div>
            <div
              ref={selectionScrollRef}
              onScroll={(event) => {
                const scroller = event.currentTarget;
                setSelectionHasMore(
                  scroller.scrollTop + scroller.clientHeight <
                    scroller.scrollHeight - 4,
                );
              }}
              className="no-scrollbar flex max-h-36 flex-wrap content-start gap-1.5 overflow-y-auto px-3 pb-3"
            >
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
            {selectionHasMore ? (
              <button
                type="button"
                aria-label="Show more selected items"
                onClick={() => {
                  const scroller = selectionScrollRef.current;
                  if (!scroller) return;
                  scroller.scrollTo({
                    top: scroller.scrollTop + scroller.clientHeight * 0.72,
                    behavior: "smooth",
                  });
                }}
                className="absolute inset-x-0 bottom-0 flex h-10 items-end justify-center bg-[linear-gradient(to_bottom,transparent,var(--color-surface-raised)_72%)] pb-1 text-ink-caption hover:text-ink"
              >
                <ChevronDown size={13} />
              </button>
            ) : null}
          </div>
        ) : null}
        {!conversationPaused ? (
          <div className="flex gap-1.5 border-b border-line-subtle px-3 py-2">
            <button
              type="button"
              aria-expanded={libraryOpen}
              onClick={() => setLibraryOpen((open) => !open)}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-action/40 bg-action-soft px-2.5 py-1.5 text-[10px] font-medium text-action"
            >
              <BookOpen size={11} /> Prompt library
            </button>
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
          </div>
        ) : null}
        {libraryOpen && !conversationPaused ? (
          <PromptLibraryModal
            onClose={() => setLibraryOpen(false)}
            onChoose={(prompt) => {
              setInstruction(prompt);
              setLibraryOpen(false);
            }}
          />
        ) : null}
        <div
          className={cx(
            "flex gap-2 px-3",
            conversationPaused
              ? "min-h-0 items-center py-3"
              : "min-h-[88px] flex-col pt-3",
          )}
        >
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
          {conversationPaused ? (
            <div className="flex min-w-0 flex-1 items-center gap-2.5 text-[11px] text-ink-secondary">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-action-soft text-action">
                <ChevronDown size={12} />
              </span>
              <span className="truncate">
                {pendingQuestions.length > 0
                  ? "Waiting for your answer above"
                  : "Waiting for your decision above"}
              </span>
            </div>
          ) : (
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
                selection ? "Edit this selection…" : "Direct the production…"
              }
              rows={3}
              className="min-w-[180px] flex-1 resize-none border-0 bg-transparent px-1 text-[14px] leading-6 text-ink outline-none placeholder:text-ink-caption"
            />
          )}
        </div>
        <div className="flex items-center px-3 pb-2.5 pt-1">
          <span
            className="mr-auto flex items-center gap-1.5 font-mono text-[9px] text-ink-secondary"
            title="Provider-reported cost for this TrueForge session"
          >
            <TrueForgeIcon className="size-3" />
            {sessionId
              ? isSending
                ? "Refresh-safe"
                : "Durable session"
              : "Starts on send"}
            <span className="text-ink-caption">·</span>
            {formatSessionCost(sessionCostInUsd)}
          </span>
          {!conversationPaused ? (
            <>
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
            </>
          ) : null}
          {!conversationPaused && (canStop || isStopping) ? (
            <button
              type="button"
              aria-label="Stop current run"
              onClick={onStop}
              disabled={isStopping}
              className="ml-1 grid size-8 place-items-center rounded-full border border-line-strong bg-surface text-ink-secondary transition-colors hover:bg-hover hover:text-ink disabled:cursor-wait disabled:opacity-50"
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : !conversationPaused ? (
            <button
              type="submit"
              aria-label="Send instruction"
              disabled={!instruction.trim() || isSending || conversationPaused}
              className="ml-1 grid size-8 place-items-center rounded-full bg-control text-control-ink transition-colors hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp size={15} strokeWidth={2.2} />
            </button>
          ) : null}
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
