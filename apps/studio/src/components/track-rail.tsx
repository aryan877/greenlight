import type {
  AudioTrackRole,
  EditorTimelineTrack,
} from "@greenlight/contracts";
import {
  Blend,
  Captions,
  Eye,
  EyeOff,
  Film,
  GripVertical,
  Languages,
  Mic2,
  Music2,
  Plus,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { pointInsideProducer } from "../editor/pointer-target.js";
import { cx } from "./controls.js";

export type TrackDraft = {
  kind: EditorTimelineTrack["kind"];
  name: string;
  role: AudioTrackRole | null;
};

const trackIcon = (track: Pick<EditorTimelineTrack, "kind" | "role">) => {
  if (track.kind === "video") return Film;
  if (track.kind === "caption") return Captions;
  if (track.kind === "transition") return Blend;
  if (track.role === "dub") return Languages;
  if (track.role === "music") return Music2;
  if (track.role === "effects") return Sparkles;
  return Mic2;
};

const RailAction = ({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={active}
    title={label}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => {
      event.stopPropagation();
      onClick();
    }}
    className={cx(
      "grid size-5 shrink-0 place-items-center rounded-full text-ink-tertiary transition-colors duration-100 hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-action",
      active && "bg-action-soft text-action ring-1 ring-inset ring-action/45",
    )}
  >
    {children}
  </button>
);

const trackChoices: Array<TrackDraft & { Icon: typeof Film }> = [
  { kind: "video", name: "Video", role: null, Icon: Film },
  { kind: "audio", name: "Narration", role: "narration", Icon: Mic2 },
  { kind: "audio", name: "Dub", role: "dub", Icon: Languages },
  { kind: "audio", name: "Music", role: "music", Icon: Music2 },
  { kind: "audio", name: "Effects", role: "effects", Icon: Sparkles },
  { kind: "caption", name: "Captions", role: null, Icon: Captions },
  { kind: "transition", name: "Transitions", role: null, Icon: Blend },
];

type TrackDrag = {
  pointerId: number;
  tracks: EditorTimelineTrack[];
  primaryTrackId: string;
  startX: number;
  startY: number;
  moved: boolean;
};

export const TrackRail = ({
  tracks,
  selectedTrackIds,
  onAddTrack,
  onAttachTracks,
  onChangeAudioTrack,
  onChangeCaptionTrack,
  onDeleteTrack,
  onRenameTrack,
  onReorderTracks,
  onSelectTrack,
}: {
  tracks: EditorTimelineTrack[];
  selectedTrackIds: string[];
  onAddTrack: (track: TrackDraft) => void;
  onAttachTracks: (tracks: EditorTimelineTrack[]) => void;
  onChangeAudioTrack: (
    track: EditorTimelineTrack,
    patch: Pick<EditorTimelineTrack, "muted" | "solo" | "export_enabled">,
    summary: string,
  ) => void;
  onChangeCaptionTrack: (track: EditorTimelineTrack, visible: boolean) => void;
  onDeleteTrack: (track: EditorTimelineTrack) => void;
  onRenameTrack: (track: EditorTimelineTrack, name: string) => void;
  onReorderTracks: (trackIds: string[]) => void;
  onSelectTrack: (trackId: string, additive: boolean) => void;
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    tracks: EditorTimelineTrack[];
    x: number;
    y: number;
    overProducer: boolean;
  } | null>(null);
  const dragRef = useRef<TrackDrag | null>(null);

  const startDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    track: EditorTimelineTrack,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const dragTracks = selectedTrackIds.includes(track.id)
      ? tracks.filter((candidate) => selectedTrackIds.includes(candidate.id))
      : [track];
    dragRef.current = {
      pointerId: event.pointerId,
      tracks: dragTracks,
      primaryTrackId: track.id,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const moved =
      active.moved ||
      Math.hypot(
        event.clientX - active.startX,
        event.clientY - active.startY,
      ) >= 5;
    if (!moved) return;
    dragRef.current = { ...active, moved: true };
    setDragPreview({
      tracks: active.tracks,
      x: event.clientX,
      y: event.clientY,
      overProducer: pointInsideProducer(event.clientX, event.clientY),
    });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!active.moved) {
      onSelectTrack(
        active.primaryTrackId,
        event.shiftKey || event.metaKey || event.ctrlKey,
      );
      return;
    }
    if (pointInsideProducer(event.clientX, event.clientY)) {
      onAttachTracks(active.tracks);
      return;
    }
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const targetTrackId = target?.closest<HTMLElement>(
      "[data-timeline-track-id]",
    )?.dataset.timelineTrackId;
    if (
      !targetTrackId ||
      active.tracks.some((track) => track.id === targetTrackId)
    ) {
      return;
    }
    const movingIds = new Set(active.tracks.map((track) => track.id));
    const next = tracks.filter((track) => !movingIds.has(track.id));
    const targetIndex = next.findIndex((track) => track.id === targetTrackId);
    next.splice(
      targetIndex < 0 ? next.length : targetIndex,
      0,
      ...active.tracks,
    );
    onReorderTracks(next.map((track) => track.id));
  };

  return (
    <div className="sticky left-0 top-0 z-40 h-full w-[156px] bg-surface">
      <div className="relative flex h-7 items-center justify-between border-b border-line-subtle px-2.5 text-[9px] font-medium text-ink-tertiary">
        <span>Tracks</span>
        <button
          type="button"
          aria-label="Add track"
          title="Add track"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((open) => !open)}
          className={cx(
            "grid size-5 place-items-center rounded-full text-ink-tertiary transition-colors duration-100 hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-action",
            pickerOpen && "bg-action-soft text-action",
          )}
        >
          {pickerOpen ? <X size={12} /> : <Plus size={12} />}
        </button>
        {pickerOpen ? (
          <div className="absolute left-2 right-2 top-7 z-[80] rounded-xl border border-line-strong bg-surface-raised p-1 shadow-float">
            {trackChoices.map(({ Icon, ...choice }) => (
              <button
                key={`${choice.kind}-${choice.role ?? "plain"}`}
                type="button"
                onClick={() => {
                  onAddTrack(choice);
                  setPickerOpen(false);
                }}
                className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-[10px] text-ink-secondary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-action"
              >
                <Icon size={12} className="text-action" />
                {choice.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {tracks.map((track) => {
        const Icon = trackIcon(track);
        const selected = selectedTrackIds.includes(track.id);
        return (
          <div
            key={track.id}
            role="button"
            tabIndex={0}
            aria-label={`Select ${track.name} track`}
            aria-pressed={selected}
            data-timeline-track-id={track.id}
            onPointerDown={(event) => startDrag(event, track)}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerCancel={() => {
              dragRef.current = null;
              setDragPreview(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onSelectTrack(
                track.id,
                event.shiftKey || event.metaKey || event.ctrlKey,
              );
            }}
            className={cx(
              "group flex h-8 cursor-grab select-none items-center gap-1 border-b border-line-subtle px-2 text-[9px] active:cursor-grabbing focus-visible:bg-hover focus-visible:outline-none",
              selected && "bg-action-soft",
            )}
          >
            <GripVertical
              size={10}
              className="shrink-0 text-ink-caption opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100"
            />
            <Icon
              size={11}
              className={cx(
                "shrink-0",
                track.kind === "video" && "text-track-video-strong",
                track.kind === "audio" && "text-track-voice-strong",
                track.kind === "caption" && "text-track-caption-strong",
                track.kind === "transition" && "text-action",
              )}
            />
            {renamingTrackId === track.id ? (
              <input
                autoFocus
                aria-label={`Rename ${track.name} track`}
                defaultValue={track.name}
                maxLength={80}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setRenamingTrackId(null);
                    return;
                  }
                  if (event.key !== "Enter") return;
                  const name = event.currentTarget.value.trim();
                  if (name && name !== track.name) onRenameTrack(track, name);
                  setRenamingTrackId(null);
                }}
                onBlur={(event) => {
                  const name = event.currentTarget.value.trim();
                  if (name && name !== track.name) onRenameTrack(track, name);
                  setRenamingTrackId(null);
                }}
                className="h-5 min-w-0 flex-1 rounded-md border border-action bg-surface-raised px-1 text-[9px] text-ink outline-none"
              />
            ) : (
              <span
                className="min-w-0 flex-1 truncate text-left"
                title={`${track.name}. Double-click to rename.`}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  setRenamingTrackId(track.id);
                }}
              >
                {track.name}
              </span>
            )}
            {track.kind === "audio" ? (
              <RailAction
                active={track.muted}
                label={
                  track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`
                }
                onClick={() =>
                  onChangeAudioTrack(
                    track,
                    {
                      muted: !track.muted,
                      solo: track.solo,
                      export_enabled: track.export_enabled,
                    },
                    track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`,
                  )
                }
              >
                {track.muted ? <VolumeX size={10} /> : <Volume2 size={10} />}
              </RailAction>
            ) : null}
            {track.kind === "caption" ? (
              <RailAction
                active={!track.visible}
                label={
                  track.visible ? `Hide ${track.name}` : `Show ${track.name}`
                }
                onClick={() => onChangeCaptionTrack(track, !track.visible)}
              >
                {track.visible ? <Eye size={10} /> : <EyeOff size={10} />}
              </RailAction>
            ) : null}
            {!track.protected ? (
              <RailAction
                label={`Delete ${track.name} track`}
                onClick={() => onDeleteTrack(track)}
              >
                <Trash2 size={10} />
              </RailAction>
            ) : null}
          </div>
        );
      })}

      {dragPreview
        ? createPortal(
            <div
              className={cx(
                "pointer-events-none fixed z-[100] flex h-8 max-w-[230px] items-center gap-2 rounded-lg border bg-surface-raised px-2.5 text-[11px] font-medium text-ink shadow-float",
                dragPreview.overProducer
                  ? "border-action bg-action-soft"
                  : "border-line-strong",
              )}
              style={{ left: dragPreview.x + 14, top: dragPreview.y + 14 }}
            >
              {(() => {
                const Icon = trackIcon(dragPreview.tracks[0]!);
                return <Icon size={12} className="text-action" />;
              })()}
              <span className="truncate">
                {dragPreview.tracks.length === 1
                  ? dragPreview.tracks[0]!.name
                  : `${dragPreview.tracks.length} tracks`}
              </span>
              {dragPreview.overProducer ? (
                <span className="ml-auto font-mono text-[8px] text-action">
                  Add
                </span>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
