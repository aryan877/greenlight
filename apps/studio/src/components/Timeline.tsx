import {
  effectiveAudioTracks,
  MIN_SCENE_DURATION_SECONDS,
  VIDEO_FPS,
  type ContentPackage,
  type EditorPatchOperation,
  type Scene,
} from "@greenlight/contracts";
import {
  Captions,
  ChevronDown,
  Layers3,
  Mic2,
  Plus,
  Split,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  formatRulerTime,
  formatTime,
  sceneOffset,
  sceneTimelineDuration,
  snapTimelineSeconds,
  totalDuration,
  timelineTicks,
} from "../editor/model.js";
import { AudioTrackRail } from "./AudioTrackRail.js";
import { cx, IconButton } from "./controls.js";

type Marquee = {
  pointerId: number;
  startX: number;
  currentX: number;
  originSceneId: string | null;
  additive: boolean;
};

type ClipDrag = {
  pointerId: number;
  sceneId: string;
  startX: number;
  currentX: number;
  dropIndex: number;
  moved: boolean;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.1;

export const Timeline = ({
  content,
  selectedSceneIds,
  selectedGapAfterSceneIds,
  previewSceneIds,
  previewing,
  currentTime,
  onSelect,
  onSelectMany,
  onSeek,
  onIntent,
  onPreviewEdit,
  onSelectGap,
  onSelectAll,
  onCollapse,
}: {
  content: ContentPackage;
  selectedSceneIds: string[];
  selectedGapAfterSceneIds: string[];
  previewSceneIds: string[];
  previewing: boolean;
  currentTime: number;
  onSelect: (scene: Scene, additive: boolean) => void;
  onSelectMany: (sceneIds: string[], gapAfterSceneIds?: string[]) => void;
  onSeek: (seconds: number) => void;
  onIntent: (instruction: string) => void;
  onPreviewEdit: (
    sceneIds: string[],
    operations: EditorPatchOperation[],
    summary: string,
  ) => void;
  onSelectGap: (sceneId: string, additive: boolean) => void;
  onSelectAll: () => void;
  onCollapse: () => void;
}) => {
  const duration = totalDuration(content);
  const audioTracks = effectiveAudioTracks(content);
  const laneCount = 2 + audioTracks.length;
  const laneHeight = 32;
  const trackHeight = laneCount * laneHeight + 8;
  const playhead = (Math.min(currentTime, duration) / duration) * 100;
  const [zoom, setZoom] = useState(1);
  const [trackWidth, setTrackWidth] = useState(1000);
  const [draggedSceneId, setDraggedSceneId] = useState<string | null>(null);
  const [dropSceneId, setDropSceneId] = useState<string | null>(null);
  const [trim, setTrim] = useState<{
    sceneId: string;
    duration: number;
  } | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const marqueeRef = useRef<Marquee | null>(null);
  const clipDragRef = useRef<ClipDrag | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const updateMarquee = (next: Marquee | null) => {
    marqueeRef.current = next;
    setMarquee(next);
  };
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setTrackWidth(entry.contentRect.width);
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, []);
  const ruler = useMemo(
    () => timelineTicks(duration, trackWidth),
    [duration, trackWidth],
  );

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
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
          title="Select the whole cut"
        >
          {content.headline}
        </button>
        <span className="ml-2 font-mono text-[9px] text-ink-caption">
          {formatTime(duration)} · {VIDEO_FPS} fps
        </span>
        <span className="ml-3 text-[9px] text-ink-tertiary">
          {selectedSceneIds.length === content.scenes.length
            ? "Full cut"
            : `${selectedSceneIds.length} selected`}
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
            Icon={Split}
            label="Split selected scene with Producer"
            size="sm"
            onClick={() =>
              onIntent(
                "Split the attached scene into two clean beats. Preserve its total duration, meaning, sources, and media provenance. Show me the scoped patch before applying it.",
              )
            }
          />
          <IconButton
            Icon={Plus}
            label="Add a scene with Producer"
            size="sm"
            onClick={() =>
              onIntent(
                "Add one scene after the attached selection. Match this production's visual system and create its visual, voice, and captions as one scene bundle. Show me the plan before creating media.",
              )
            }
          />
        </div>
      </div>

      <div className="scroll-stable min-h-0 flex-1 overflow-auto bg-surface-sunken">
        <div
          className="relative min-h-full"
          style={{
            minHeight: trackHeight + 60,
            width: `calc(${zoom * 100}% + 168px)`,
          }}
        >
          <AudioTrackRail
            audioTracks={audioTracks}
            height={trackHeight + 28}
            onEditorCommand={(_sceneIds, instruction) => onIntent(instruction)}
            scenes={content.scenes}
          />
          <div className="absolute left-36 right-0 top-0">
            <button
              type="button"
              aria-label="Seek timeline"
              className="relative mx-3 block h-7 border-b border-line-subtle"
              style={{ width: "calc(100% - 24px)" }}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                onSeek(
                  ((event.clientX - bounds.left) / bounds.width) * duration,
                );
              }}
            >
              {ruler.ticks.map((seconds, index) => (
                <span
                  key={`${seconds}-${index}`}
                  className={cx(
                    "pointer-events-none absolute inset-y-0 border-l border-line-subtle pt-2 font-mono text-[8px] text-ink-caption",
                    index === 0
                      ? "translate-x-0"
                      : index === ruler.ticks.length - 1
                        ? "-translate-x-full"
                        : "translate-x-0",
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
              ref={trackRef}
              data-testid="timeline-track"
              className="relative mx-3 cursor-crosshair border-b border-line-subtle bg-surface"
              style={{ width: "calc(100% - 24px)", height: trackHeight }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                const target = event.target as HTMLElement;
                if (target.closest("[data-trim-handle]")) {
                  return;
                }
                const bounds = event.currentTarget.getBoundingClientRect();
                const startX = Math.max(
                  0,
                  Math.min(bounds.width, event.clientX - bounds.left),
                );
                event.currentTarget.setPointerCapture(event.pointerId);
                updateMarquee({
                  pointerId: event.pointerId,
                  startX,
                  currentX: startX,
                  originSceneId:
                    target.closest<HTMLElement>("[data-scene-clip]")?.dataset
                      .sceneId ?? null,
                  additive: event.shiftKey || event.metaKey || event.ctrlKey,
                });
              }}
              onPointerMove={(event) => {
                const active = marqueeRef.current;
                if (!active || active.pointerId !== event.pointerId) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                updateMarquee({
                  ...active,
                  currentX: Math.max(
                    0,
                    Math.min(bounds.width, event.clientX - bounds.left),
                  ),
                });
              }}
              onPointerUp={(event) => {
                const active = marqueeRef.current;
                if (!active || active.pointerId !== event.pointerId) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                const endX = Math.max(
                  0,
                  Math.min(bounds.width, event.clientX - bounds.left),
                );
                const left = Math.min(active.startX, endX);
                const right = Math.max(active.startX, endX);
                updateMarquee(null);
                event.currentTarget.releasePointerCapture(event.pointerId);
                if (right - left < 4) {
                  if (!active.originSceneId) return;
                  const sceneIndex = content.scenes.findIndex(
                    (scene) => scene.id === active.originSceneId,
                  );
                  const scene = content.scenes[sceneIndex];
                  if (!scene) return;
                  onSelect(scene, active.additive);
                  onSeek(sceneOffset(content.scenes, sceneIndex));
                  return;
                }
                const selected = content.scenes.flatMap((scene, index) => {
                  const sceneLeft =
                    (sceneOffset(content.scenes, index) / duration) *
                    bounds.width;
                  const sceneRight =
                    sceneLeft +
                    (scene.duration_seconds / duration) * bounds.width;
                  return sceneRight >= left && sceneLeft <= right
                    ? [scene.id]
                    : [];
                });
                const selectedGaps = content.scenes.flatMap((scene, index) => {
                  const gap = scene.gap_after_seconds ?? 0;
                  if (gap <= 0) return [];
                  const gapLeft =
                    ((sceneOffset(content.scenes, index) +
                      scene.duration_seconds) /
                      duration) *
                    bounds.width;
                  const gapRight = gapLeft + (gap / duration) * bounds.width;
                  return gapRight >= left && gapLeft <= right ? [scene.id] : [];
                });
                if (selected.length > 0 || selectedGaps.length > 0) {
                  onSelectMany(
                    active.additive
                      ? Array.from(new Set([...selectedSceneIds, ...selected]))
                      : selected,
                    active.additive
                      ? Array.from(
                          new Set([
                            ...selectedGapAfterSceneIds,
                            ...selectedGaps,
                          ]),
                        )
                      : selectedGaps,
                  );
                }
              }}
              onPointerCancel={() => updateMarquee(null)}
            >
              {content.scenes.map((scene, index) => {
                const left =
                  (sceneOffset(content.scenes, index) / duration) * 100;
                const displayedDuration =
                  trim?.sceneId === scene.id
                    ? trim.duration
                    : scene.duration_seconds;
                const width = (displayedDuration / duration) * 100;
                const selected = selectedSceneIds.includes(scene.id);
                const proposed = previewSceneIds.includes(scene.id);
                const currentGap = scene.gap_after_seconds ?? 0;
                const sourceMaximum = scene.source_clip
                  ? (scene.source_clip.source_duration_seconds -
                      scene.source_clip.in_seconds) /
                    scene.playback_rate
                  : scene.duration_seconds;
                const maximumDuration = Math.max(
                  scene.duration_seconds,
                  Math.min(sourceMaximum, scene.duration_seconds + currentGap),
                );
                const audioClips = audioTracks.map((track) => ({
                  track,
                  clips: track.clips.filter(
                    (clip) => clip.scene_id === scene.id,
                  ),
                }));
                const hasCaptions = audioClips.some(({ clips }) =>
                  clips.some((clip) => clip.captions_artifact_id),
                );
                return (
                  <div
                    key={scene.id}
                    data-scene-clip
                    data-scene-id={scene.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    title={scene.title}
                    onPointerDown={(event) => {
                      if (
                        event.button !== 0 ||
                        previewing ||
                        event.shiftKey ||
                        event.metaKey ||
                        event.ctrlKey
                      ) {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      clipDragRef.current = {
                        pointerId: event.pointerId,
                        sceneId: scene.id,
                        startX: event.clientX,
                        currentX: event.clientX,
                        dropIndex: index,
                        moved: false,
                      };
                    }}
                    onPointerMove={(event) => {
                      const active = clipDragRef.current;
                      if (
                        !active ||
                        active.pointerId !== event.pointerId ||
                        active.sceneId !== scene.id
                      ) {
                        return;
                      }
                      const moved =
                        active.moved ||
                        Math.abs(event.clientX - active.startX) >= 5;
                      if (!moved) return;
                      const bounds = trackRef.current?.getBoundingClientRect();
                      if (!bounds) return;
                      const seconds =
                        (Math.max(
                          0,
                          Math.min(bounds.width, event.clientX - bounds.left),
                        ) /
                          bounds.width) *
                        duration;
                      const remaining = content.scenes.filter(
                        (item) => item.id !== scene.id,
                      );
                      const dropIndex = remaining.findIndex((item) => {
                        const itemIndex = content.scenes.findIndex(
                          (candidate) => candidate.id === item.id,
                        );
                        return (
                          seconds <
                          sceneOffset(content.scenes, itemIndex) +
                            sceneTimelineDuration(content.scenes, itemIndex) / 2
                        );
                      });
                      const resolvedIndex =
                        dropIndex < 0 ? remaining.length : dropIndex;
                      clipDragRef.current = {
                        ...active,
                        currentX: event.clientX,
                        dropIndex: resolvedIndex,
                        moved: true,
                      };
                      setDraggedSceneId(scene.id);
                      setDropSceneId(
                        remaining[resolvedIndex]?.id ?? "timeline-end",
                      );
                    }}
                    onPointerUp={(event) => {
                      const active = clipDragRef.current;
                      if (
                        !active ||
                        active.pointerId !== event.pointerId ||
                        active.sceneId !== scene.id
                      ) {
                        return;
                      }
                      clipDragRef.current = null;
                      if (
                        event.currentTarget.hasPointerCapture(event.pointerId)
                      ) {
                        event.currentTarget.releasePointerCapture(
                          event.pointerId,
                        );
                      }
                      if (!active.moved) {
                        onSelect(scene, false);
                        onSeek(sceneOffset(content.scenes, index));
                        return;
                      }
                      const order = content.scenes
                        .filter((item) => item.id !== scene.id)
                        .map((item) => item.id);
                      order.splice(active.dropIndex, 0, scene.id);
                      setDraggedSceneId(null);
                      setDropSceneId(null);
                      if (
                        order.every(
                          (sceneId, sceneIndex) =>
                            sceneId === content.scenes[sceneIndex]?.id,
                        )
                      ) {
                        return;
                      }
                      onPreviewEdit(
                        content.scenes.map((item) => item.id),
                        [{ type: "reorder_scenes", scene_ids: order }],
                        `Move “${scene.title}” in the timeline`,
                      );
                    }}
                    onPointerCancel={() => {
                      clipDragRef.current = null;
                      setDraggedSceneId(null);
                      setDropSceneId(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onSelect(
                        scene,
                        event.shiftKey || event.metaKey || event.ctrlKey,
                      );
                      onSeek(sceneOffset(content.scenes, index));
                    }}
                    className={cx(
                      "group absolute bottom-1 top-1 grid min-w-0 cursor-grab select-none gap-px active:cursor-grabbing focus-visible:outline-none focus-visible:[&>span]:ring-1 focus-visible:[&>span]:ring-inset focus-visible:[&>span]:ring-action",
                      draggedSceneId === scene.id && "opacity-40",
                      dropSceneId === scene.id &&
                        "before:absolute before:inset-y-0 before:left-0 before:z-20 before:w-0.5 before:bg-action",
                      dropSceneId === "timeline-end" &&
                        index === content.scenes.length - 1 &&
                        "after:absolute after:inset-y-0 after:right-0 after:z-20 after:w-0.5 after:bg-action",
                    )}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      gridTemplateRows: `repeat(${laneCount}, minmax(0, 1fr))`,
                    }}
                  >
                    <span
                      className={cx(
                        "flex min-w-0 items-center gap-1.5 overflow-hidden border-y border-r bg-track-video px-2 text-[9px] text-ink transition-colors duration-100",
                        index === 0 && "border-l",
                        selected
                          ? "border-line ring-1 ring-inset ring-action"
                          : "border-line group-hover:border-line-strong",
                        proposed && "preview-hatch border-warning/50",
                      )}
                    >
                      <span
                        title="Drag the scene to reorder it"
                        className="grid size-4 shrink-0 place-items-center rounded-sm text-track-video-strong"
                      >
                        <Layers3 size={10} className="pointer-events-none" />
                      </span>
                      <span className="truncate font-medium">
                        {scene.title}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[7px] text-ink-caption">
                        {formatTime(displayedDuration)}
                        {scene.playback_rate !== 1
                          ? ` · ${scene.playback_rate.toFixed(2)}×`
                          : ""}
                      </span>
                    </span>
                    {audioClips.map(({ clips, track }) => (
                      <span
                        key={track.id}
                        className={cx(
                          "flex min-w-0 items-center gap-1.5 overflow-hidden border-y border-r px-2 text-[8px] text-ink-secondary transition-colors duration-100",
                          index === 0 && "border-l",
                          clips.some((clip) => clip.artifact_id)
                            ? "bg-track-voice"
                            : "bg-surface-sunken",
                          track.muted && "opacity-45",
                          selected
                            ? "border-line ring-1 ring-inset ring-action"
                            : "border-line group-hover:border-line-strong",
                          proposed && "preview-hatch border-warning/50",
                        )}
                        title={`${track.name}: ${clips.map((clip) => clip.script ?? clip.label).join(" · ") || "No clip"}`}
                      >
                        <Mic2
                          size={9}
                          className="shrink-0 text-track-voice-strong"
                        />
                        <span className="truncate">
                          {clips
                            .map((clip) => clip.script ?? clip.label)
                            .join(" · ") || "No clip"}
                        </span>
                      </span>
                    ))}
                    <span
                      className={cx(
                        "flex min-w-0 items-center gap-1.5 overflow-hidden border-y border-r px-2 text-[8px] text-ink-secondary transition-colors duration-100",
                        index === 0 && "border-l",
                        scene.captions_artifact_id || hasCaptions
                          ? "bg-track-caption"
                          : "bg-surface-sunken",
                        selected
                          ? "border-line ring-1 ring-inset ring-action"
                          : "border-line group-hover:border-line-strong",
                        proposed && "preview-hatch border-warning/50",
                      )}
                    >
                      <Captions
                        size={9}
                        className="shrink-0 text-track-caption-strong"
                      />
                      <span className="truncate">{scene.narration}</span>
                    </span>
                    {selected && !previewing ? (
                      <button
                        type="button"
                        data-trim-handle
                        aria-label={`Trim ${scene.title}`}
                        title="Drag to trim the end"
                        className="absolute inset-y-1 right-0 z-20 w-1.5 cursor-ew-resize rounded-full bg-action opacity-70 transition-opacity hover:opacity-100 focus:opacity-100"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const startX = event.clientX;
                          const initial = scene.duration_seconds;
                          const trackWidth =
                            trackRef.current?.getBoundingClientRect().width;
                          if (!trackWidth) return;
                          const move = (pointer: PointerEvent) => {
                            const rawSeconds =
                              initial +
                              ((pointer.clientX - startX) / trackWidth) *
                                duration;
                            const seconds = snapTimelineSeconds(
                              rawSeconds,
                              trackWidth / duration,
                              [
                                MIN_SCENE_DURATION_SECONDS,
                                initial,
                                maximumDuration,
                              ],
                            );
                            setTrim({
                              sceneId: scene.id,
                              duration: Math.max(
                                MIN_SCENE_DURATION_SECONDS,
                                Math.min(maximumDuration, seconds),
                              ),
                            });
                          };
                          const up = (pointer: PointerEvent) => {
                            const rawSeconds =
                              initial +
                              ((pointer.clientX - startX) / trackWidth) *
                                duration;
                            const seconds = snapTimelineSeconds(
                              rawSeconds,
                              trackWidth / duration,
                              [
                                MIN_SCENE_DURATION_SECONDS,
                                initial,
                                maximumDuration,
                              ],
                            );
                            const next = Math.max(
                              MIN_SCENE_DURATION_SECONDS,
                              Math.min(maximumDuration, seconds),
                            );
                            setTrim(null);
                            window.removeEventListener("pointermove", move);
                            window.removeEventListener("pointerup", up);
                            if (next === initial) return;
                            const nextGap = Math.max(
                              0,
                              currentGap + initial - next,
                            );
                            const sourceClip = scene.source_clip
                              ? {
                                  ...scene.source_clip,
                                  out_seconds:
                                    scene.source_clip.in_seconds +
                                    next * scene.playback_rate,
                                }
                              : undefined;
                            onPreviewEdit(
                              [scene.id],
                              [
                                {
                                  type: "update_scene",
                                  scene_id: scene.id,
                                  duration_seconds: next,
                                  gap_after_seconds: nextGap,
                                  ...(sourceClip
                                    ? { source_clip: sourceClip }
                                    : {}),
                                },
                              ],
                              `Trim “${scene.title}” to ${formatTime(next)}`,
                            );
                          };
                          window.addEventListener("pointermove", move);
                          window.addEventListener("pointerup", up, {
                            once: true,
                          });
                        }}
                      />
                    ) : null}
                  </div>
                );
              })}
              {content.scenes.map((scene, index) => {
                const displayedDuration =
                  trim?.sceneId === scene.id
                    ? trim.duration
                    : scene.duration_seconds;
                const gap =
                  (scene.gap_after_seconds ?? 0) +
                  (trim?.sceneId === scene.id
                    ? scene.duration_seconds - trim.duration
                    : 0);
                if (gap <= 0) return null;
                const left =
                  ((sceneOffset(content.scenes, index) + displayedDuration) /
                    duration) *
                  100;
                return (
                  <button
                    type="button"
                    key={`${scene.id}-gap`}
                    aria-pressed={selectedGapAfterSceneIds.includes(scene.id)}
                    aria-label={`Select ${formatTime(gap)} gap after ${scene.title}`}
                    title="Select this gap and ask Producer what should fill it"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectGap(
                        scene.id,
                        event.shiftKey || event.metaKey || event.ctrlKey,
                      );
                    }}
                    className={cx(
                      "preview-hatch absolute bottom-1 top-1 z-10 grid place-items-center border-x text-[8px] font-medium text-warning hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-warning",
                      selectedGapAfterSceneIds.includes(scene.id)
                        ? "border-warning bg-warning/15 ring-1 ring-inset ring-warning"
                        : "border-warning/40",
                    )}
                    style={{
                      left: `${left}%`,
                      width: `${(gap / duration) * 100}%`,
                    }}
                  >
                    <span className="truncate px-1">{formatTime(gap)} gap</span>
                  </button>
                );
              })}
              {marquee ? (
                <div
                  className="pointer-events-none absolute inset-y-1 z-30 rounded-sm border border-action bg-action/10"
                  style={{
                    left: Math.min(marquee.startX, marquee.currentX),
                    width: Math.abs(marquee.currentX - marquee.startX),
                  }}
                />
              ) : null}
              <div
                className="pointer-events-none absolute -top-7 bottom-0 z-20 w-px bg-action"
                style={{ left: `${playhead}%` }}
              >
                <span className="absolute -left-[4px] top-0 size-[9px] rotate-45 rounded-[1px] bg-action" />
              </div>
            </div>

            <div className="flex h-8 items-center justify-between px-4 text-[9px] text-ink-caption">
              <span>
                {previewing
                  ? "Preview · approve or reject on the right"
                  : "Drag to select · Shift-click to add"}
              </span>
              <span>Scene selection keeps every lane aligned</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
