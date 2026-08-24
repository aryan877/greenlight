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
import { useRef, useState } from "react";

import { formatTime, sceneOffset, totalDuration } from "../editor/model.js";
import { cx, IconButton } from "./controls.js";

type Marquee = {
  pointerId: number;
  startX: number;
  currentX: number;
};

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
  const updateZoom = (delta: number) =>
    setZoom((current) => Math.min(4, Math.max(1, current + delta)));

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
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            Icon={ZoomOut}
            label="Zoom timeline out"
            size="sm"
            disabled={zoom === 1}
            onClick={() => updateZoom(-0.5)}
          />
          <span className="w-9 text-center font-mono text-[8px] text-ink-caption">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton
            Icon={ZoomIn}
            label="Zoom timeline in"
            size="sm"
            disabled={zoom === 4}
            onClick={() => updateZoom(0.5)}
          />
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
          className="relative h-full min-w-full"
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
            {Array.from({ length: 7 }, (_, index) => (
              <span
                key={index}
                className={cx(
                  "pointer-events-none absolute top-2 font-mono text-[8px] text-ink-caption",
                  index === 0
                    ? "translate-x-0"
                    : index === 6
                      ? "-translate-x-full"
                      : "-translate-x-1/2",
                )}
                style={{ left: `${(index / 6) * 100}%` }}
              >
                {formatTime((index / 6) * duration)}
              </span>
            ))}
          </button>

          <div
            ref={trackRef}
            data-testid="timeline-track"
            className="relative mx-3 h-[112px] cursor-crosshair border-b border-line-subtle bg-surface"
            style={{ width: "calc(100% - 24px)" }}
            onPointerDown={(event) => {
              if (
                event.button !== 0 ||
                (event.target as HTMLElement).closest("[data-scene-clip]")
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
              if (right - left < 4) return;
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
              if (selected.length > 0) onSelectMany(selected);
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
              return (
                <div
                  key={scene.id}
                  data-scene-clip
                  draggable={!previewing && !marquee}
                  onDragStart={(event) => {
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
                  className={cx(
                    "group absolute bottom-1 top-5 min-w-0 cursor-default overflow-hidden rounded-md border bg-surface-raised transition-[border-color,background-color,box-shadow] duration-100",
                    selected
                      ? "z-10 border-action bg-action-soft/45 ring-1 ring-action/20"
                      : "border-line hover:border-line-strong hover:bg-hover",
                    proposed && "preview-hatch border-warning/50",
                    draggedSceneId === scene.id && "opacity-40",
                    dropSceneId === scene.id &&
                      "before:absolute before:-left-1 before:inset-y-0 before:w-0.5 before:bg-action",
                  )}
                  style={{ left: `${left}%`, width: `calc(${width}% - 3px)` }}
                >
                  <button
                    type="button"
                    title={scene.title}
                    aria-pressed={selected}
                    onClick={(event) => {
                      onSelect(
                        scene,
                        event.shiftKey || event.metaKey || event.ctrlKey,
                      );
                      onSeek(sceneOffset(content.scenes, index));
                    }}
                    className="grid size-full grid-rows-3 overflow-hidden rounded-[inherit] text-left"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 bg-track-video px-2.5 text-[9px] text-ink">
                      <Layers3
                        size={10}
                        className="shrink-0 text-track-video-strong"
                      />
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
                    <span
                      className={cx(
                        "flex min-w-0 items-center gap-1.5 border-t border-white/80 px-2.5 text-[8px] text-ink-secondary",
                        scene.narration_artifact_id
                          ? "bg-track-voice"
                          : "bg-surface-sunken",
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
                        "flex min-w-0 items-center gap-1.5 border-t border-white/80 px-2.5 text-[8px] text-ink-secondary",
                        scene.captions_artifact_id
                          ? "bg-track-caption"
                          : "bg-surface-sunken",
                      )}
                    >
                      <Captions
                        size={9}
                        className="shrink-0 text-track-caption-strong"
                      />
                      <span className="truncate">{scene.narration}</span>
                    </span>
                  </button>
                  {selected && !previewing ? (
                    <button
                      type="button"
                      aria-label={`Trim ${scene.title}`}
                      title="Drag to trim the end"
                      className="absolute -right-0.5 inset-y-2 z-20 w-2 cursor-ew-resize rounded-full bg-action opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const startX = event.clientX;
                        const initial = scene.duration_seconds;
                        const trackWidth =
                          trackRef.current?.getBoundingClientRect().width;
                        if (!trackWidth) return;
                        const move = (pointer: PointerEvent) => {
                          const seconds =
                            initial +
                            ((pointer.clientX - startX) / trackWidth) *
                              duration;
                          setTrim({
                            sceneId: scene.id,
                            duration: Math.max(
                              MIN_SCENE_DURATION_SECONDS,
                              Math.min(initial, Math.round(seconds * 10) / 10),
                            ),
                          });
                        };
                        const up = (pointer: PointerEvent) => {
                          const seconds =
                            initial +
                            ((pointer.clientX - startX) / trackWidth) *
                              duration;
                          const next = Math.max(
                            MIN_SCENE_DURATION_SECONDS,
                            Math.min(initial, Math.round(seconds * 10) / 10),
                          );
                          setTrim(null);
                          window.removeEventListener("pointermove", move);
                          window.removeEventListener("pointerup", up);
                          if (next === initial) return;
                          onEditorCommand(
                            [scene.id],
                            `Trim the end of scene ${scene.id} from ${initial.toFixed(1)} seconds to exactly ${next.toFixed(1)} seconds. Keep its start, media, sources, and wording unchanged. Show the preview before applying it.`,
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
