import {
  MIN_SCENE_DURATION_SECONDS,
  VIDEO_FPS,
  type ContentPackage,
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
import { cx, IconButton } from "./controls.js";

type Marquee = {
  pointerId: number;
  startX: number;
  currentX: number;
  originSceneId: string | null;
  additive: boolean;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.1;

export const Timeline = ({
  content,
  selectedSceneIds,
  previewSceneIds,
  previewing,
  currentTime,
  onSelect,
  onSelectMany,
  onSeek,
  onIntent,
  onEditorCommand,
  onSelectAll,
  onCollapse,
}: {
  content: ContentPackage;
  selectedSceneIds: string[];
  previewSceneIds: string[];
  previewing: boolean;
  currentTime: number;
  onSelect: (scene: Scene, additive: boolean) => void;
  onSelectMany: (sceneIds: string[]) => void;
  onSeek: (seconds: number) => void;
  onIntent: (instruction: string) => void;
  onEditorCommand: (sceneIds: string[], instruction: string) => void;
  onSelectAll: () => void;
  onCollapse: () => void;
}) => {
  const duration = totalDuration(content);
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

      <div className="scroll-stable min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-surface-sunken">
        <div
          className="relative h-full"
          style={{ width: `calc(${zoom * 100}% + 24px)` }}
        >
          <button
            type="button"
            aria-label="Seek timeline"
            className="relative mx-3 block h-7 border-b border-line-subtle"
            style={{ width: "calc(100% - 24px)" }}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              onSeek(((event.clientX - bounds.left) / bounds.width) * duration);
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
            className="relative mx-3 h-[112px] cursor-crosshair border-b border-line-subtle bg-surface"
            style={{ width: "calc(100% - 24px)" }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              const target = event.target as HTMLElement;
              if (
                target.closest("[data-reorder-handle]") ||
                target.closest("[data-trim-handle]")
              ) {
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
                  (sceneTimelineDuration(content.scenes, index) / duration) *
                    bounds.width;
                return sceneRight >= left && sceneLeft <= right
                  ? [scene.id]
                  : [];
              });
              if (selected.length > 0) {
                onSelectMany(
                  active.additive
                    ? Array.from(new Set([...selectedSceneIds, ...selected]))
                    : selected,
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
              return (
                <div
                  key={scene.id}
                  data-scene-clip
                  data-scene-id={scene.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  title={scene.title}
                  onDragStart={(event) => {
                    if (
                      !(event.target as HTMLElement).closest(
                        "[data-reorder-handle]",
                      )
                    ) {
                      event.preventDefault();
                      return;
                    }
                    setDraggedSceneId(scene.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", scene.id);
                  }}
                  onDragEnd={() => {
                    setDraggedSceneId(null);
                    setDropSceneId(null);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (draggedSceneId && draggedSceneId !== scene.id) {
                      setDropSceneId(scene.id);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceId =
                      draggedSceneId ||
                      event.dataTransfer.getData("text/plain");
                    if (!sourceId || sourceId === scene.id) return;
                    const order = content.scenes.map((item) => item.id);
                    const from = order.indexOf(sourceId);
                    const to = order.indexOf(scene.id);
                    if (from < 0 || to < 0) return;
                    order.splice(from, 1);
                    order.splice(to, 0, sourceId);
                    setDraggedSceneId(null);
                    setDropSceneId(null);
                    onEditorCommand(
                      content.scenes.map((item) => item.id),
                      `Reorder the full cut to this exact scene order: ${order.join(", ")}. Change only scene order and show the preview before applying it.`,
                    );
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
                    "group absolute bottom-1 top-3 grid min-w-0 select-none grid-rows-3 gap-1 focus-visible:outline-none focus-visible:[&>span]:ring-1 focus-visible:[&>span]:ring-inset focus-visible:[&>span]:ring-action",
                    draggedSceneId === scene.id && "opacity-40",
                    dropSceneId === scene.id &&
                      "before:absolute before:inset-y-0 before:left-0 before:z-20 before:w-0.5 before:bg-action",
                  )}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
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
                      data-reorder-handle
                      draggable={!previewing && !marquee}
                      title="Drag to reorder this scene"
                      className="grid size-4 shrink-0 cursor-grab place-items-center rounded-sm text-track-video-strong hover:bg-white/70 active:cursor-grabbing"
                    >
                      <Layers3 size={10} className="pointer-events-none" />
                    </span>
                    <span className="truncate font-medium">{scene.title}</span>
                    <span className="ml-auto shrink-0 font-mono text-[7px] text-ink-caption">
                      {formatTime(displayedDuration)}
                      {scene.playback_rate !== 1
                        ? ` · ${scene.playback_rate.toFixed(2)}×`
                        : ""}
                    </span>
                  </span>
                  <span
                    className={cx(
                      "flex min-w-0 items-center gap-1.5 overflow-hidden border-y border-r px-2 text-[8px] text-ink-secondary transition-colors duration-100",
                      index === 0 && "border-l",
                      scene.narration_artifact_id
                        ? "bg-track-voice"
                        : "bg-surface-sunken",
                      selected
                        ? "border-line ring-1 ring-inset ring-action"
                        : "border-line group-hover:border-line-strong",
                      proposed && "preview-hatch border-warning/50",
                    )}
                  >
                    <Mic2
                      size={9}
                      className="shrink-0 text-track-voice-strong"
                    />
                    <span className="truncate">{scene.narration}</span>
                  </span>
                  <span
                    className={cx(
                      "flex min-w-0 items-center gap-1.5 overflow-hidden border-y border-r px-2 text-[8px] text-ink-secondary transition-colors duration-100",
                      index === 0 && "border-l",
                      scene.captions_artifact_id
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
                      className="absolute inset-y-1 right-0 z-20 w-1.5 cursor-ew-resize rounded-full bg-action opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
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
                          const sourceInstruction = scene.source_clip
                            ? ` Move the source out point to ${(scene.source_clip.in_seconds + next * scene.playback_rate).toFixed(3)} seconds; its measured source ends at ${scene.source_clip.source_duration_seconds.toFixed(3)} seconds.`
                            : " This scene has no recorded unused source handles, so do not extend it beyond its current duration.";
                          onEditorCommand(
                            [scene.id],
                            `Set scene ${scene.id} to exactly ${next.toFixed(3)} seconds and set its gap after to exactly ${nextGap.toFixed(3)} seconds. Keep its start, media, captions, sources, and wording unchanged.${sourceInstruction} Show the frame-accurate preview before applying it.`,
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
                <div
                  key={`${scene.id}-gap`}
                  className="preview-hatch pointer-events-none absolute bottom-1 top-3 z-10 grid place-items-center border-x border-warning/40 text-[8px] font-medium text-warning"
                  style={{
                    left: `${left}%`,
                    width: `${(gap / duration) * 100}%`,
                  }}
                >
                  <span className="truncate px-1">{formatTime(gap)} gap</span>
                </div>
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
            <span>Visual · Voice · Captions stay together</span>
          </div>
        </div>
      </div>
    </section>
  );
};
