import type { ContentPackage, Scene } from "@greenlight/contracts";
import { ChevronDown, Plus, Split, ZoomIn, ZoomOut } from "lucide-react";
import { useRef, useState } from "react";

import { formatTime, sceneOffset, totalDuration } from "../editor/model.js";
import { cx, IconButton } from "./controls.js";

export const Timeline = ({
  content,
  selectedSceneIds,
  previewSceneIds,
  previewing,
  currentTime,
  onSelect,
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
  const trackRef = useRef<HTMLDivElement>(null);
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
          {formatTime(duration)} · 30 fps
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
          style={{ width: `${zoom * 100}%` }}
        >
          <button
            type="button"
            aria-label="Seek timeline"
            className="relative block h-7 w-full border-b border-line-subtle"
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              onSeek(((event.clientX - bounds.left) / bounds.width) * duration);
            }}
          >
            {Array.from({ length: 7 }, (_, index) => (
              <span
                key={index}
                className="pointer-events-none absolute top-2 -translate-x-1/2 font-mono text-[8px] text-ink-caption"
                style={{ left: `${(index / 6) * 100}%` }}
              >
                {formatTime((index / 6) * duration)}
              </span>
            ))}
          </button>

          <div
            ref={trackRef}
            className="relative h-[76px] border-b border-line-subtle bg-surface"
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
                  draggable={!previewing}
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
                    "group absolute inset-y-1.5 min-w-0 rounded-md border bg-surface-raised transition-[border-color,background-color,box-shadow] duration-100",
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
                    className="size-full overflow-hidden rounded-[inherit] px-3 text-left"
                  >
                    <span className="block truncate text-[10px] font-medium text-ink">
                      {scene.title}
                    </span>
                    <span className="mt-1 block font-mono text-[8px] text-ink-caption">
                      {formatTime(displayedDuration)}
                      {scene.playback_rate !== 1
                        ? ` · ${scene.playback_rate.toFixed(2)}×`
                        : ""}
                    </span>
                    <span className="absolute inset-x-2 bottom-2 flex h-1 gap-1">
                      <i
                        className="min-w-0 flex-1 rounded-full bg-track-video-strong not-italic"
                        title="Visual"
                      />
                      <i
                        className={cx(
                          "min-w-0 flex-1 rounded-full not-italic",
                          scene.narration_artifact_id
                            ? "bg-track-voice-strong"
                            : "bg-line-strong",
                        )}
                        title="Voice"
                      />
                      <i
                        className={cx(
                          "min-w-0 flex-1 rounded-full not-italic",
                          scene.captions_artifact_id
                            ? "bg-track-caption-strong"
                            : "bg-line-strong",
                        )}
                        title="Captions"
                      />
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
                              0.1,
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
                            0.1,
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
            <div
              className="pointer-events-none absolute -top-7 bottom-0 z-20 w-px bg-action"
              style={{ left: `${playhead}%` }}
            >
              <span className="absolute -left-[4px] top-0 size-[9px] rotate-45 rounded-[1px] bg-action" />
            </div>
          </div>

          <div className="flex h-8 items-center justify-between px-3 text-[9px] text-ink-caption">
            <span>
              {previewing
                ? "Preview · approve or reject on the right"
                : "Click a scene · Shift-click to add more"}
            </span>
            <span>Visual · Voice · Captions stay together</span>
          </div>
        </div>
      </div>
    </section>
  );
};
