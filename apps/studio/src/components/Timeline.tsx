import {
  effectiveAudioTracks,
  effectiveCaptionTracks,
  effectiveVideoTracks,
  MIN_SCENE_DURATION_SECONDS,
  VIDEO_FPS,
  type ContentPackage,
  type EditorPatchOperation,
  type EditorTimelineGap,
  type EditorTimelineItem,
  type EditorTimelineItemKind,
  type EditorTimelineTrack,
} from "@greenlight/contracts";
import {
  Captions,
  ChevronDown,
  Layers3,
  Mic2,
  Plus,
  Redo2,
  Split,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  formatRulerTime,
  formatTime,
  gapItemId,
  sceneOffset,
  sceneTimelineDuration,
  snapToFrame,
  timelineItems,
  timelineGaps,
  timelineTracks,
  timelineTicks,
  totalDuration,
  videoItemId,
} from "../editor/model.js";
import {
  buildTimelineMovePlan,
  buildTimelineTrimPlan,
  maximumTimelineItemDuration,
} from "../editor/operations.js";
import { pointInsideProducer } from "../editor/pointer-target.js";
import { TrackRail, type TrackDraft } from "./TrackRail.js";
import { cx, IconButton } from "./controls.js";

type Marquee = {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
};

type ItemDrag = {
  pointerId: number;
  primaryItemId: string;
  itemIds: string[];
  startX: number;
  startY: number;
  startTime: number;
  deltaSeconds: number;
  targetTrackId: string | null;
  dropIndex: number;
  moved: boolean;
};

type DragPreview = {
  items: EditorTimelineItem[];
  x: number;
  y: number;
  overProducer: boolean;
};

type GapDrag = {
  pointerId: number;
  gapId: string;
  startX: number;
  startY: number;
  additive: boolean;
  moved: boolean;
};

type GapDragPreview = {
  gaps: EditorTimelineGap[];
  x: number;
  y: number;
  overProducer: boolean;
};

const RAIL_WIDTH = 156;
const RULER_HEIGHT = 28;
const LANE_HEIGHT = 32;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.1;

const intersects = (a: DOMRect, b: DOMRect) =>
  a.right >= b.left &&
  a.left <= b.right &&
  a.bottom >= b.top &&
  a.top <= b.bottom;

const ITEM_ICONS = {
  video: Layers3,
  audio: Mic2,
  caption: Captions,
} satisfies Record<EditorTimelineItemKind, LucideIcon>;

const itemIcon = (kind: EditorTimelineItemKind) => ITEM_ICONS[kind];

export const Timeline = ({
  content,
  selectedItemIds,
  selectedTrackIds,
  selectedGapIds,
  previewSceneIds,
  previewing,
  currentTime,
  onSelectItem,
  onSelectTrack,
  onSelectMany,
  onSeek,
  onScrubStart,
  onScrub,
  onScrubEnd,
  onIntent,
  onDirectEdit,
  onDirectItemEdit,
  onDirectTrackEdit,
  onCutAtPlayhead,
  onAttachItemsToProducer,
  onAttachTracksToProducer,
  onAttachGapsToProducer,
  onSelectGap,
  onSelectAll,
  onCollapse,
  canUndo,
  canRedo,
  editing,
  onUndo,
  onRedo,
}: {
  content: ContentPackage;
  selectedItemIds: string[];
  selectedTrackIds: string[];
  selectedGapIds: string[];
  previewSceneIds: string[];
  previewing: boolean;
  currentTime: number;
  onSelectItem: (itemId: string, additive: boolean) => void;
  onSelectTrack: (trackId: string, additive: boolean) => void;
  onSelectMany: (itemIds: string[], gapIds?: string[]) => void;
  onSeek: (seconds: number) => void;
  onScrubStart: () => void;
  onScrub: (seconds: number) => void;
  onScrubEnd: (seconds: number) => void;
  onIntent: (instruction: string) => void;
  onDirectEdit: (
    sceneIds: string[],
    operations: EditorPatchOperation[],
    summary: string,
  ) => void;
  onDirectItemEdit: (
    itemIds: string[],
    operations: EditorPatchOperation[],
    summary: string,
  ) => void;
  onDirectTrackEdit: (
    trackIds: string[],
    operations: EditorPatchOperation[],
    summary: string,
  ) => void;
  onCutAtPlayhead: (sceneId: string) => void;
  onAttachItemsToProducer: (items: EditorTimelineItem[]) => void;
  onAttachTracksToProducer: (tracks: EditorTimelineTrack[]) => void;
  onAttachGapsToProducer: (gaps: EditorTimelineGap[]) => void;
  onSelectGap: (gapId: string, additive: boolean) => void;
  onSelectAll: () => void;
  onCollapse: () => void;
  canUndo: boolean;
  canRedo: boolean;
  editing: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) => {
  const duration = totalDuration(content);
  const audioTracks = effectiveAudioTracks(content);
  const items = useMemo(() => timelineItems(content), [content]);
  const gaps = useMemo(() => timelineGaps(content), [content]);
  const tracks = useMemo(() => timelineTracks(content), [content]);
  const laneIndex = useMemo(
    () => new Map(tracks.map((track, index) => [track.id, index])),
    [tracks],
  );
  const lanesHeight = tracks.length * LANE_HEIGHT;
  const workspaceHeight = Math.max(lanesHeight + RULER_HEIGHT + 44, 190);
  const playhead = (Math.min(currentTime, duration) / duration) * 100;
  const [zoom, setZoom] = useState(1);
  const [trackWidth, setTrackWidth] = useState(1000);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [gapDragPreview, setGapDragPreview] = useState<GapDragPreview | null>(
    null,
  );
  const [draggedItemIds, setDraggedItemIds] = useState<string[]>([]);
  const [dragTransform, setDragTransform] = useState<{
    deltaSeconds: number;
    targetTrackId: string | null;
    primaryTrackId: string;
  } | null>(null);
  const [dropSceneId, setDropSceneId] = useState<string | null>(null);
  const [trim, setTrim] = useState<{
    itemId: string;
    duration: number;
  } | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const marqueeRef = useRef<Marquee | null>(null);
  const itemDragRef = useRef<ItemDrag | null>(null);
  const gapDragRef = useRef<GapDrag | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const timeAxisRef = useRef<HTMLDivElement>(null);

  const addTrack = (draft: TrackDraft) => {
    const id = `track_${draft.kind}_${crypto.randomUUID()}`;
    const ordinal = tracks.filter(
      (track) =>
        track.kind === draft.kind &&
        (draft.kind !== "audio" || track.role === draft.role),
    ).length;
    const name = ordinal === 0 ? draft.name : `${draft.name} ${ordinal + 1}`;
    if (draft.kind === "video") {
      onDirectTrackEdit(
        ["visual", id],
        [
          {
            type: "upsert_video_track",
            track: { id, name, kind: "video", protected: false },
          },
        ],
        `Add ${name}`,
      );
      return;
    }
    if (draft.kind === "caption") {
      onDirectTrackEdit(
        ["caption", id],
        [
          {
            type: "upsert_caption_track",
            track: {
              id,
              name,
              kind: "caption",
              protected: false,
              visible: true,
            },
          },
        ],
        `Add ${name}`,
      );
      return;
    }
    onDirectTrackEdit(
      ["voice", id],
      [
        {
          type: "upsert_audio_track",
          track: {
            id,
            name,
            role: draft.role ?? "narration",
            locale: null,
            voice_label: null,
            muted: false,
            solo: false,
            export_enabled: true,
            gain: 1,
            clips: [],
          },
        },
      ],
      `Add ${name}`,
    );
  };

  const deleteTrack = (track: EditorTimelineTrack) => {
    if (track.protected) return;
    const operation: EditorPatchOperation =
      track.kind === "video"
        ? { type: "remove_video_track", track_id: track.id }
        : track.kind === "caption"
          ? { type: "remove_caption_track", track_id: track.id }
          : { type: "remove_audio_track", track_id: track.id };
    onDirectTrackEdit(
      [
        track.kind === "video"
          ? "visual"
          : track.kind === "caption"
            ? "caption"
            : "voice",
        track.id,
      ],
      [operation],
      `Delete ${track.name}`,
    );
  };

  const updateMarquee = (next: Marquee | null) => {
    marqueeRef.current = next;
    setMarquee(next);
  };

  useEffect(() => {
    const timeAxis = timeAxisRef.current;
    if (!timeAxis) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setTrackWidth(entry.contentRect.width);
    });
    observer.observe(timeAxis);
    return () => observer.disconnect();
  }, []);

  const ruler = useMemo(
    () => timelineTicks(duration, trackWidth),
    [duration, trackWidth],
  );
  const playheadScene = content.scenes.find((scene, index) => {
    const start = sceneOffset(content.scenes, index);
    const local = currentTime - start;
    return (
      local >= MIN_SCENE_DURATION_SECONDS &&
      local <= scene.duration_seconds - MIN_SCENE_DURATION_SECONDS
    );
  });

  const positionInCanvas = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): { x: number; y: number } => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    };
  };

  const timeFromClientX = (clientX: number) => {
    const bounds = timeAxisRef.current?.getBoundingClientRect();
    if (!bounds) return currentTime;
    const ratio =
      Math.max(0, Math.min(bounds.width, clientX - bounds.left)) / bounds.width;
    return ratio * duration;
  };

  const beginPlayheadDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onScrubStart();
    onScrub(timeFromClientX(event.clientX));
  };

  const beginMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || previewing || editing) return;
    const target = event.target as HTMLElement;
    if (
      target.closest("[data-timeline-item-id]") ||
      target.closest("[data-timeline-gap]") ||
      target.closest("button, input, [data-trim-handle]")
    ) {
      return;
    }
    const point = positionInCanvas(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateMarquee({
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      additive: event.shiftKey || event.metaKey || event.ctrlKey,
    });
  };

  const moveMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = marqueeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = positionInCanvas(event);
    updateMarquee({ ...active, currentX: point.x, currentY: point.y });
  };

  const finishMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = marqueeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = positionInCanvas(event);
    const canvasBounds = event.currentTarget.getBoundingClientRect();
    const selectionRect = new DOMRect(
      canvasBounds.left + Math.min(active.startX, point.x),
      canvasBounds.top + Math.min(active.startY, point.y),
      Math.abs(point.x - active.startX),
      Math.abs(point.y - active.startY),
    );
    updateMarquee(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (selectionRect.width < 4 && selectionRect.height < 4) {
      if (!active.additive) onSelectMany([], []);
      return;
    }

    const hitItemIds = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        "[data-timeline-item-id]",
      ),
    ].flatMap((element) => {
      const itemId = element.dataset.timelineItemId;
      return itemId &&
        intersects(selectionRect, element.getBoundingClientRect())
        ? [itemId]
        : [];
    });
    const hitGapIds = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        "[data-timeline-gap]",
      ),
    ].flatMap((element) => {
      const gapId = element.dataset.timelineGap;
      return gapId && intersects(selectionRect, element.getBoundingClientRect())
        ? [gapId]
        : [];
    });
    const nextItemIds = active.additive
      ? [...new Set([...selectedItemIds, ...hitItemIds])]
      : hitItemIds;
    const nextGapIds = active.additive
      ? [...new Set([...selectedGapIds, ...hitGapIds])]
      : hitGapIds;
    if (nextItemIds.length > 0 || nextGapIds.length > 0 || !active.additive) {
      onSelectMany(nextItemIds, nextGapIds);
    }
  };

  const startItemDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    item: EditorTimelineItem,
  ) => {
    event.stopPropagation();
    if (
      event.button !== 0 ||
      previewing ||
      editing ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const dragItems = selectedItemIds.includes(item.id)
      ? items.filter((candidate) => selectedItemIds.includes(candidate.id))
      : [item];
    const sceneIndex = content.scenes.findIndex(
      (scene) => scene.id === item.scene_id,
    );
    itemDragRef.current = {
      pointerId: event.pointerId,
      primaryItemId: item.id,
      itemIds: dragItems.map((candidate) => candidate.id),
      startX: event.clientX,
      startY: event.clientY,
      startTime: timeFromClientX(event.clientX),
      deltaSeconds: 0,
      targetTrackId: null,
      dropIndex: Math.max(0, sceneIndex),
      moved: false,
    };
  };

  const moveItemDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    item: EditorTimelineItem,
  ) => {
    const active = itemDragRef.current;
    if (
      !active ||
      active.pointerId !== event.pointerId ||
      active.primaryItemId !== item.id
    ) {
      return;
    }
    const moved =
      active.moved ||
      Math.hypot(
        event.clientX - active.startX,
        event.clientY - active.startY,
      ) >= 5;
    if (!moved) return;
    const overProducer = pointInsideProducer(event.clientX, event.clientY);
    let dropIndex = active.dropIndex;
    const dragItems = items.filter((candidate) =>
      active.itemIds.includes(candidate.id),
    );
    const rawDelta = snapToFrame(
      timeFromClientX(event.clientX) - active.startTime,
    );
    const minimumStart = Math.min(
      ...dragItems.map((candidate) => candidate.start_seconds),
    );
    const maximumEnd = Math.max(
      ...dragItems.map((candidate) => candidate.end_seconds),
    );
    const deltaSeconds = Math.max(
      -minimumStart,
      Math.min(duration - maximumEnd, rawDelta),
    );
    const axisBounds = timeAxisRef.current?.getBoundingClientRect();
    let targetTrackId: string | null = null;
    if (axisBounds) {
      const row = Math.floor(
        (event.clientY - axisBounds.top - RULER_HEIGHT) / LANE_HEIGHT,
      );
      const targetTrack = tracks[row];
      const primaryItem = items.find(
        (candidate) => candidate.id === active.primaryItemId,
      );
      if (targetTrack && primaryItem && targetTrack.kind === primaryItem.kind) {
        targetTrackId = targetTrack.id;
      }
    }
    const movingSceneIds = new Set(
      dragItems
        .filter((candidate) => candidate.kind === "video")
        .map((candidate) => candidate.scene_id),
    );
    if (movingSceneIds.size > 0) {
      const bounds = timeAxisRef.current?.getBoundingClientRect();
      if (bounds) {
        const seconds =
          (Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)) /
            bounds.width) *
          duration;
        const remaining = content.scenes.filter(
          (scene) => !movingSceneIds.has(scene.id),
        );
        const candidate = remaining.findIndex((scene) => {
          const index = content.scenes.findIndex(
            (current) => current.id === scene.id,
          );
          return (
            seconds <
            sceneOffset(content.scenes, index) +
              sceneTimelineDuration(content.scenes, index) / 2
          );
        });
        dropIndex = candidate < 0 ? remaining.length : candidate;
        setDropSceneId(remaining[dropIndex]?.id ?? "timeline-end");
      }
    }
    itemDragRef.current = {
      ...active,
      deltaSeconds,
      targetTrackId,
      dropIndex,
      moved: true,
    };
    setDraggedItemIds(active.itemIds);
    setDragTransform({
      deltaSeconds,
      targetTrackId,
      primaryTrackId: item.track_id,
    });
    setDragPreview({
      items: dragItems,
      x: event.clientX,
      y: event.clientY,
      overProducer,
    });
  };

  const finishItemDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    item: EditorTimelineItem,
  ) => {
    const active = itemDragRef.current;
    if (
      !active ||
      active.pointerId !== event.pointerId ||
      active.primaryItemId !== item.id
    ) {
      return;
    }
    itemDragRef.current = null;
    setDragPreview(null);
    setDraggedItemIds([]);
    setDragTransform(null);
    setDropSceneId(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!active.moved) {
      onSelectItem(item.id, false);
      onSeek(item.start_seconds);
      return;
    }
    suppressClickRef.current = item.id;
    const dragItems = items.filter((candidate) =>
      active.itemIds.includes(candidate.id),
    );
    if (pointInsideProducer(event.clientX, event.clientY)) {
      onAttachItemsToProducer(dragItems);
      return;
    }
    const plan = buildTimelineMovePlan(content, {
      itemIds: active.itemIds,
      primaryItemId: active.primaryItemId,
      deltaSeconds: active.deltaSeconds,
      targetTrackId: active.targetTrackId,
      dropIndex: active.dropIndex,
    });
    if (plan.operations.length === 0) return;
    const summary =
      dragItems.length === 1
        ? `Move ${dragItems[0]!.label}`
        : `Move ${dragItems.length} timeline items`;
    if (plan.sceneScope === "all") {
      onDirectEdit(
        content.scenes.map((scene) => scene.id),
        plan.operations,
        summary,
      );
    } else {
      onDirectItemEdit(active.itemIds, plan.operations, summary);
    }
  };

  const startGapDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    gapId: string,
  ) => {
    event.stopPropagation();
    if (event.button !== 0 || previewing || editing) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gapDragRef.current = {
      pointerId: event.pointerId,
      gapId,
      startX: event.clientX,
      startY: event.clientY,
      additive: event.shiftKey || event.metaKey || event.ctrlKey,
      moved: false,
    };
  };

  const moveGapDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    gapId: string,
  ) => {
    const active = gapDragRef.current;
    if (
      !active ||
      active.pointerId !== event.pointerId ||
      active.gapId !== gapId
    ) {
      return;
    }
    const moved =
      active.moved ||
      Math.hypot(
        event.clientX - active.startX,
        event.clientY - active.startY,
      ) >= 5;
    if (!moved) return;
    const draggedGapIds = selectedGapIds.includes(gapId)
      ? selectedGapIds
      : [gapId];
    const draggedGaps = gaps.filter((gap) => draggedGapIds.includes(gap.id));
    gapDragRef.current = { ...active, moved: true };
    setGapDragPreview({
      gaps: draggedGaps,
      x: event.clientX,
      y: event.clientY,
      overProducer: pointInsideProducer(event.clientX, event.clientY),
    });
  };

  const finishGapDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    gapId: string,
  ) => {
    const active = gapDragRef.current;
    if (
      !active ||
      active.pointerId !== event.pointerId ||
      active.gapId !== gapId
    ) {
      return;
    }
    gapDragRef.current = null;
    setGapDragPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!active.moved) {
      const gap = gaps.find((candidate) => candidate.id === gapId);
      onSelectGap(gapId, active.additive);
      if (gap) onSeek(gap.start_seconds);
      return;
    }
    if (!pointInsideProducer(event.clientX, event.clientY)) return;
    const draggedGapIds = selectedGapIds.includes(gapId)
      ? selectedGapIds
      : [gapId];
    onAttachGapsToProducer(
      gaps.filter((gap) => draggedGapIds.includes(gap.id)),
    );
  };

  return (
    <section className="isolate flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-10 shrink-0 items-center border-b border-line-subtle px-2.5">
        <IconButton
          Icon={ChevronDown}
          label="Collapse timeline"
          onClick={onCollapse}
          size="sm"
        />
        <button
          type="button"
          onClick={onSelectAll}
          className="ml-1 min-w-0 truncate text-left text-[12px] font-medium hover:text-action"
          title="Select every timeline item"
        >
          {content.headline}
        </button>
        <span className="ml-2 font-mono text-[9px] text-ink-caption">
          {formatTime(duration)} · {VIDEO_FPS} fps
        </span>
        <span className="ml-3 text-[9px] text-ink-tertiary">
          {selectedItemIds.length === items.length &&
          selectedTrackIds.length === 0 &&
          selectedGapIds.length === 0
            ? "Full cut"
            : `${selectedItemIds.length + selectedTrackIds.length + selectedGapIds.length} selected`}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <ZoomOut size={12} className="shrink-0 text-ink-caption" />
          <input
            aria-label="Timeline zoom"
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={ZOOM_STEP}
            value={zoom}
            onChange={(event) => setZoom(Number(event.currentTarget.value))}
            style={
              {
                "--range-progress": `${((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100}%`,
              } as CSSProperties
            }
            className="precision-range w-24"
          />
          <ZoomIn size={12} className="shrink-0 text-ink-caption" />
          <span className="w-10 text-right font-mono text-[8px] text-ink-caption">
            {Math.round(zoom * 100)}%
          </span>
          <span className="mx-1 h-4 w-px bg-line-subtle" />
          <IconButton
            Icon={Undo2}
            label="Undo timeline edit"
            size="sm"
            disabled={!canUndo || editing}
            onClick={onUndo}
          />
          <IconButton
            Icon={Redo2}
            label="Redo timeline edit"
            size="sm"
            disabled={!canRedo || editing}
            onClick={onRedo}
          />
          <span className="mx-1 h-4 w-px bg-line-subtle" />
          <IconButton
            Icon={Split}
            label="Cut video at playhead"
            size="sm"
            disabled={!playheadScene || previewing || editing}
            onClick={() => playheadScene && onCutAtPlayhead(playheadScene.id)}
          />
          <IconButton
            Icon={Plus}
            label="Ask AI to add a scene"
            size="sm"
            onClick={() =>
              onIntent(
                "Add one scene after the current selection. Match this production and show me the plan before creating media.",
              )
            }
          />
        </div>
      </div>

      <div className="scroll-stable min-h-0 flex-1 overflow-auto bg-surface-sunken">
        <div
          className="relative min-h-full"
          style={{
            height: "100%",
            minHeight: workspaceHeight,
            width: `calc(${zoom * 100}% + ${RAIL_WIDTH}px)`,
          }}
        >
          <TrackRail
            tracks={tracks}
            selectedTrackIds={selectedTrackIds}
            onAddTrack={addTrack}
            onAttachTracks={onAttachTracksToProducer}
            onDeleteTrack={deleteTrack}
            onRenameTrack={(track, name) => {
              if (track.kind === "video") {
                const source = effectiveVideoTracks(content).find(
                  (candidate) => candidate.id === track.id,
                );
                if (!source) return;
                onDirectTrackEdit(
                  ["visual", track.id],
                  [
                    {
                      type: "upsert_video_track",
                      track: { ...source, name },
                    },
                  ],
                  `Rename ${track.name} to ${name}`,
                );
                return;
              }
              if (track.kind === "caption") {
                const source = effectiveCaptionTracks(content).find(
                  (candidate) => candidate.id === track.id,
                );
                if (!source) return;
                onDirectTrackEdit(
                  ["caption", track.id],
                  [
                    {
                      type: "upsert_caption_track",
                      track: { ...source, name },
                    },
                  ],
                  `Rename ${track.name} to ${name}`,
                );
                return;
              }
              const source = audioTracks.find(
                (candidate) => candidate.id === track.id,
              );
              if (!source) return;
              onDirectTrackEdit(
                ["voice", track.id],
                [
                  {
                    type: "upsert_audio_track",
                    track: { ...source, name },
                  },
                ],
                `Rename ${track.name} to ${name}`,
              );
            }}
            onReorderTracks={(trackIds) =>
              onDirectTrackEdit(
                trackIds,
                [{ type: "reorder_tracks", track_ids: trackIds }],
                "Reorder tracks",
              )
            }
            onSelectTrack={onSelectTrack}
            onChangeAudioTrack={(track, patch, summary) => {
              const source = audioTracks.find(
                (candidate) => candidate.id === track.id,
              );
              if (!source) return;
              onDirectTrackEdit(
                ["voice", track.id],
                [
                  {
                    type: "upsert_audio_track",
                    track: { ...source, ...patch },
                  },
                ],
                summary,
              );
            }}
            onChangeCaptionTrack={(track, visible) => {
              const source = effectiveCaptionTracks(content).find(
                (candidate) => candidate.id === track.id,
              );
              if (!source) return;
              onDirectTrackEdit(
                ["caption", track.id],
                [
                  {
                    type: "upsert_caption_track",
                    track: { ...source, visible },
                  },
                ],
                `${visible ? "Show" : "Hide"} ${track.name}`,
              );
            }}
          />

          <div
            ref={canvasRef}
            data-testid="timeline-workspace"
            className="absolute bottom-0 right-0 top-0 cursor-crosshair overflow-hidden"
            style={{ left: RAIL_WIDTH }}
            onPointerDown={beginMarquee}
            onPointerMove={moveMarquee}
            onPointerUp={finishMarquee}
            onPointerCancel={() => updateMarquee(null)}
          >
            <div
              ref={timeAxisRef}
              data-testid="timeline-time-axis"
              className="absolute inset-x-3 top-0 overflow-visible"
              style={{ height: RULER_HEIGHT + lanesHeight }}
            >
              <button
                type="button"
                aria-label="Seek timeline"
                className="absolute inset-x-0 top-0 block border-b border-line-subtle"
                style={{ height: RULER_HEIGHT }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  onScrubStart();
                  onScrub(timeFromClientX(event.clientX));
                }}
                onPointerMove={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId))
                    return;
                  onScrub(timeFromClientX(event.clientX));
                }}
                onPointerUp={(event) => {
                  onScrubEnd(timeFromClientX(event.clientX));
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                }}
                onPointerCancel={() => onScrubEnd(currentTime)}
              >
                {ruler.ticks.map((seconds, index) => (
                  <span
                    key={`${seconds}-${index}`}
                    className={cx(
                      "pointer-events-none absolute inset-y-0 border-l border-line-subtle pt-2 font-mono text-[8px] text-ink-caption",
                      index === ruler.ticks.length - 1 && "-translate-x-full",
                    )}
                    style={{ left: `${(seconds / duration) * 100}%` }}
                  >
                    <span className="ml-1 whitespace-nowrap">
                      {formatRulerTime(seconds, ruler.stepSeconds)}
                    </span>
                  </span>
                ))}
              </button>

              <div
                data-testid="timeline-track"
                className="absolute inset-x-0 border-b border-line-subtle bg-surface"
                style={{ top: RULER_HEIGHT, height: lanesHeight }}
              >
                {tracks.map((track, index) => (
                  <div
                    key={track.id}
                    className="pointer-events-none absolute inset-x-0 border-b border-line-subtle"
                    style={{ top: index * LANE_HEIGHT, height: LANE_HEIGHT }}
                  />
                ))}

                {content.scenes.map((scene, index) => {
                  const displayedDuration =
                    trim?.itemId === videoItemId(scene.id)
                      ? trim.duration
                      : scene.duration_seconds;
                  const gap =
                    (scene.gap_after_seconds ?? 0) +
                    (trim?.itemId === videoItemId(scene.id)
                      ? scene.duration_seconds - trim.duration
                      : 0);
                  if (gap <= 0) return null;
                  const gapId = gapItemId(scene.id);
                  const left =
                    ((sceneOffset(content.scenes, index) + displayedDuration) /
                      duration) *
                    100;
                  return (
                    <button
                      type="button"
                      key={gapId}
                      data-timeline-gap={gapId}
                      aria-pressed={selectedGapIds.includes(gapId)}
                      aria-label={`Select ${formatTime(gap)} gap after ${scene.title}`}
                      title="Select or drag this gap to AI Producer"
                      onPointerDown={(event) => startGapDrag(event, gapId)}
                      onPointerMove={(event) => moveGapDrag(event, gapId)}
                      onPointerUp={(event) => finishGapDrag(event, gapId)}
                      onPointerCancel={() => {
                        gapDragRef.current = null;
                        setGapDragPreview(null);
                      }}
                      className={cx(
                        "preview-hatch absolute bottom-0 top-0 z-[1] grid touch-none place-items-center border-x text-[8px] font-medium text-warning focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-warning",
                        selectedGapIds.includes(gapId)
                          ? "border-warning bg-warning/15 ring-1 ring-inset ring-warning"
                          : "border-warning/40 hover:bg-warning/10",
                      )}
                      style={{
                        left: `${left}%`,
                        width: `${(gap / duration) * 100}%`,
                      }}
                    >
                      <span className="truncate px-1">
                        {formatTime(gap)} gap
                      </span>
                    </button>
                  );
                })}

                {items.map((item) => {
                  const scene = content.scenes.find(
                    (candidate) => candidate.id === item.scene_id,
                  );
                  if (!scene) return null;
                  const sceneIndex = content.scenes.findIndex(
                    (candidate) => candidate.id === scene.id,
                  );
                  const displayedEnd =
                    trim?.itemId === item.id
                      ? item.start_seconds + trim.duration
                      : item.end_seconds;
                  const width =
                    ((displayedEnd - item.start_seconds) / duration) * 100;
                  const selected = selectedItemIds.includes(item.id);
                  const proposed = previewSceneIds.includes(item.scene_id);
                  const row = laneIndex.get(item.track_id) ?? 0;
                  const Icon = itemIcon(item.kind);
                  const maximumDuration = maximumTimelineItemDuration(
                    content,
                    item,
                  );
                  const isDropTarget =
                    item.kind === "video" && dropSceneId === item.scene_id;
                  const atTimelineEnd =
                    item.kind === "video" &&
                    dropSceneId === "timeline-end" &&
                    sceneIndex === content.scenes.length - 1;
                  const hasPreviousNeighbor = items.some(
                    (candidate) =>
                      candidate.id !== item.id &&
                      candidate.track_id === item.track_id &&
                      Math.abs(candidate.end_seconds - item.start_seconds) <
                        1 / 1_000,
                  );
                  const hasNextNeighbor = items.some(
                    (candidate) =>
                      candidate.id !== item.id &&
                      candidate.track_id === item.track_id &&
                      Math.abs(candidate.start_seconds - displayedEnd) <
                        1 / 1_000,
                  );
                  return (
                    <button
                      type="button"
                      key={item.id}
                      data-timeline-item-id={item.id}
                      aria-pressed={selected}
                      aria-label={`${item.kind}: ${item.label}`}
                      title={item.label}
                      onPointerDown={(event) => startItemDrag(event, item)}
                      onPointerMove={(event) => moveItemDrag(event, item)}
                      onPointerUp={(event) => finishItemDrag(event, item)}
                      onPointerCancel={() => {
                        itemDragRef.current = null;
                        setDragPreview(null);
                        setDraggedItemIds([]);
                        setDragTransform(null);
                        setDropSceneId(null);
                      }}
                      onClick={(event) => {
                        if (suppressClickRef.current === item.id) {
                          suppressClickRef.current = null;
                          return;
                        }
                        onSelectItem(
                          item.id,
                          event.shiftKey || event.metaKey || event.ctrlKey,
                        );
                      }}
                      className={cx(
                        "group absolute z-10 flex min-w-0 items-center gap-1.5 overflow-hidden border px-2 text-left transition-colors duration-100 focus-visible:outline-none",
                        item.kind === "video" && "bg-track-video text-ink",
                        item.kind === "audio" &&
                          "bg-track-voice text-ink-secondary",
                        item.kind === "caption" &&
                          "bg-track-caption text-ink-secondary",
                        selected
                          ? "border-action ring-1 ring-inset ring-action"
                          : "border-line hover:border-line-strong",
                        proposed && "preview-hatch border-warning/50",
                        !hasPreviousNeighbor && "rounded-l-md",
                        !hasNextNeighbor && "rounded-r-md",
                        draggedItemIds.includes(item.id) && "opacity-40",
                        isDropTarget &&
                          "before:absolute before:inset-y-0 before:left-0 before:z-20 before:w-0.5 before:bg-action",
                        atTimelineEnd &&
                          "after:absolute after:inset-y-0 after:right-0 after:z-20 after:w-0.5 after:bg-action",
                      )}
                      style={{
                        left: `${(item.start_seconds / duration) * 100}%`,
                        top: row * LANE_HEIGHT + 2,
                        width: `${width}%`,
                        height: LANE_HEIGHT - 4,
                        transform:
                          dragTransform && draggedItemIds.includes(item.id)
                            ? `translate(${(dragTransform.deltaSeconds / duration) * trackWidth}px, ${(() => {
                                const primaryIndex =
                                  laneIndex.get(dragTransform.primaryTrackId) ??
                                  0;
                                const targetIndex = dragTransform.targetTrackId
                                  ? (laneIndex.get(
                                      dragTransform.targetTrackId,
                                    ) ?? primaryIndex)
                                  : primaryIndex;
                                const candidate =
                                  tracks[row + (targetIndex - primaryIndex)];
                                return candidate?.kind === item.kind
                                  ? (targetIndex - primaryIndex) * LANE_HEIGHT
                                  : 0;
                              })()}px)`
                            : undefined,
                      }}
                    >
                      <Icon
                        size={10}
                        className={cx(
                          "shrink-0",
                          item.kind === "video" && "text-track-video-strong",
                          item.kind === "audio" && "text-track-voice-strong",
                          item.kind === "caption" &&
                            "text-track-caption-strong",
                        )}
                      />
                      <span className="truncate text-[9px] font-medium">
                        {item.label}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[7px] text-ink-caption">
                        {formatTime(displayedEnd - item.start_seconds)}
                      </span>
                      {selected && !previewing && !editing ? (
                        <span
                          role="slider"
                          tabIndex={0}
                          data-trim-handle
                          aria-label={`Trim ${item.label}`}
                          title="Drag to trim the end"
                          className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-ew-resize bg-action/70 hover:bg-action"
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const startX = event.clientX;
                            const initial =
                              item.end_seconds - item.start_seconds;
                            const minimumDuration =
                              item.kind === "video"
                                ? MIN_SCENE_DURATION_SECONDS
                                : 1 / VIDEO_FPS;
                            const width =
                              timeAxisRef.current?.getBoundingClientRect()
                                .width;
                            if (!width) return;
                            const resolveDuration = (clientX: number) =>
                              Math.max(
                                minimumDuration,
                                Math.min(
                                  maximumDuration,
                                  snapToFrame(
                                    initial +
                                      ((clientX - startX) / width) * duration,
                                  ),
                                ),
                              );
                            const move = (pointer: PointerEvent) =>
                              setTrim({
                                itemId: item.id,
                                duration: resolveDuration(pointer.clientX),
                              });
                            const up = (pointer: PointerEvent) => {
                              const next = resolveDuration(pointer.clientX);
                              setTrim(null);
                              window.removeEventListener("pointermove", move);
                              window.removeEventListener("pointerup", up);
                              if (next === initial) return;
                              const plan = buildTimelineTrimPlan(
                                content,
                                item,
                                next,
                              );
                              if (!plan) return;
                              const summary = `Trim ${item.label} to ${formatTime(next)}`;
                              if (plan.sceneScope === "all") {
                                onDirectEdit(
                                  [scene.id],
                                  plan.operations,
                                  summary,
                                );
                              } else {
                                onDirectItemEdit(
                                  [item.id],
                                  plan.operations,
                                  summary,
                                );
                              }
                            };
                            window.addEventListener("pointermove", move);
                            window.addEventListener("pointerup", up, {
                              once: true,
                            });
                          }}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                aria-label={`Timeline playhead at ${formatTime(currentTime)}`}
                title="Drag to scrub the timeline"
                className="absolute bottom-0 top-0 z-[60] w-3 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-none"
                style={{ left: `${playhead}%` }}
                onPointerDown={beginPlayheadDrag}
                onPointerMove={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId))
                    return;
                  onScrub(timeFromClientX(event.clientX));
                }}
                onPointerUp={(event) => {
                  onScrubEnd(timeFromClientX(event.clientX));
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                }}
                onPointerCancel={(event) => {
                  onScrubEnd(currentTime);
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                }}
              >
                <span
                  className="pointer-events-none absolute bottom-0 left-1/2 w-px -translate-x-1/2 bg-action"
                  style={{ top: RULER_HEIGHT }}
                />
                <span
                  className="pointer-events-none absolute left-1/2 size-3 -translate-x-1/2 rotate-45 rounded-[1px] bg-action ring-2 ring-surface-sunken"
                  style={{ top: RULER_HEIGHT - 6 }}
                />
              </button>
            </div>

            {marquee ? (
              <div
                className="pointer-events-none absolute z-40 border border-action bg-action/10"
                style={{
                  left: Math.min(marquee.startX, marquee.currentX),
                  top: Math.min(marquee.startY, marquee.currentY),
                  width: Math.abs(marquee.currentX - marquee.startX),
                  height: Math.abs(marquee.currentY - marquee.startY),
                }}
              />
            ) : null}

            <div
              className="absolute inset-x-0 text-[9px] text-ink-caption"
              style={{ top: RULER_HEIGHT + lanesHeight }}
            >
              <div className="flex h-8 items-center justify-between px-4">
                <span>
                  {previewing
                    ? "Preview is waiting on the right"
                    : "Drag anywhere empty to select · Shift-click to add"}
                </span>
                <span>Video, audio, and captions select independently</span>
              </div>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 top-0 z-[70] w-px bg-line-strong"
            style={{ left: RAIL_WIDTH - 1 }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 top-0 z-[70] w-px bg-line-strong"
          />
        </div>
      </div>

      {dragPreview
        ? createPortal(
            <div
              className={cx(
                "pointer-events-none fixed z-[100] flex h-9 max-w-[260px] select-none items-center gap-2 rounded-lg border bg-surface-raised px-3 text-[12px] font-medium text-ink shadow-float",
                dragPreview.overProducer
                  ? "border-action bg-action-soft"
                  : "border-line-strong",
              )}
              style={{
                left: dragPreview.x + 14,
                top: dragPreview.y + 14,
              }}
            >
              <span className="flex shrink-0 items-center -space-x-0.5">
                {dragPreview.items.slice(0, 3).map((item) => {
                  const Icon = itemIcon(item.kind);
                  return (
                    <span
                      key={item.id}
                      className="grid size-5 place-items-center rounded-md bg-surface-raised text-action"
                    >
                      <Icon size={12} />
                    </span>
                  );
                })}
              </span>
              <span className="truncate">
                {dragPreview.items.length === 1
                  ? dragPreview.items[0]!.label
                  : `${dragPreview.items.length} timeline items`}
              </span>
              {dragPreview.overProducer ? (
                <span className="shrink-0 font-mono text-[8px] uppercase tracking-[0.08em] text-action">
                  Attach
                </span>
              ) : null}
            </div>,
            document.body,
          )
        : null}
      {gapDragPreview
        ? createPortal(
            <div
              className={cx(
                "pointer-events-none fixed z-[100] flex h-9 max-w-[260px] select-none items-center gap-2 rounded-lg border bg-surface-raised px-3 text-[12px] font-medium text-ink shadow-float",
                gapDragPreview.overProducer
                  ? "border-action bg-action-soft"
                  : "border-line-strong",
              )}
              style={{
                left: gapDragPreview.x + 14,
                top: gapDragPreview.y + 14,
              }}
            >
              <Split size={12} className="shrink-0 text-warning" />
              <span className="truncate">
                {gapDragPreview.gaps.length === 1
                  ? gapDragPreview.gaps[0]!.label
                  : `${gapDragPreview.gaps.length} gaps`}
              </span>
              {gapDragPreview.overProducer ? (
                <span className="shrink-0 font-mono text-[8px] uppercase tracking-[0.08em] text-action">
                  Attach
                </span>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </section>
  );
};
