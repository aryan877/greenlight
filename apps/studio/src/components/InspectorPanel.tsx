import type { Scene } from "@greenlight/contracts";
import {
  Clock3,
  Gauge,
  MessageSquareText,
  RotateCcw,
  WandSparkles,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { formatTime } from "../editor/model.js";

export const InspectorPanel = ({
  scene,
  editing,
  onChangeSpeed,
  onEdit,
}: {
  scene: Scene | null;
  editing: boolean;
  onChangeSpeed: (scene: Scene, playbackRate: number) => void;
  onEdit: (instruction: string) => void;
}) => {
  const [speed, setSpeed] = useState(scene?.playback_rate ?? 1);
  const lastCommittedSpeed = useRef(scene?.playback_rate ?? 1);

  useEffect(() => {
    const next = scene?.playback_rate ?? 1;
    setSpeed(next);
    lastCommittedSpeed.current = next;
  }, [scene?.id, scene?.playback_rate]);

  const commitSpeed = () => {
    if (!scene || editing || speed === lastCommittedSpeed.current) return;
    lastCommittedSpeed.current = speed;
    onChangeSpeed(scene, speed);
  };

  return (
    <div className="scroll-stable h-full overflow-y-auto px-4 py-4">
      {scene ? (
        <div>
          <h3 className="text-[13px] font-medium leading-5 text-ink">
            {scene.title}
          </h3>

          <div className="mt-4 flex gap-4 border-y border-line-subtle py-3 text-[10px] text-ink-tertiary">
            <span className="flex items-center gap-1.5">
              <Clock3 size={11} /> {formatTime(scene.duration_seconds)}
            </span>
            <span className="flex items-center gap-1.5">
              <Gauge size={11} /> {scene.playback_rate.toFixed(2)}×
            </span>
          </div>

          <section className="mt-5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-ink">
              <Gauge size={12} className="text-ink-tertiary" />
              Speed
              <span className="ml-auto font-mono text-[10px] text-ink-secondary">
                {speed.toFixed(2)}×
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input
                aria-label={`Speed for ${scene.title}`}
                type="range"
                min={0.5}
                max={3}
                step={0.05}
                value={speed}
                disabled={editing}
                onChange={(event) =>
                  setSpeed(Number(event.currentTarget.value))
                }
                onPointerUp={commitSpeed}
                onKeyUp={(event) => {
                  if (event.key.startsWith("Arrow")) commitSpeed();
                }}
                onBlur={commitSpeed}
                style={
                  {
                    "--range-progress": `${((speed - 0.5) / 2.5) * 100}%`,
                  } as CSSProperties
                }
                className="precision-range min-w-0 flex-1"
              />
              <button
                type="button"
                aria-label="Reset speed"
                title="Reset to normal speed"
                disabled={editing || speed === 1}
                onClick={() => {
                  if (!scene) return;
                  setSpeed(1);
                  lastCommittedSpeed.current = 1;
                  onChangeSpeed(scene, 1);
                }}
                className="grid size-7 shrink-0 place-items-center text-ink-tertiary hover:bg-hover hover:text-ink disabled:opacity-25"
              >
                <RotateCcw size={12} />
              </button>
            </div>
            <div className="mt-2 flex justify-between font-mono text-[8px] text-ink-caption">
              <span>0.50×</span>
              <span>1.00×</span>
              <span>3.00×</span>
            </div>
          </section>

          <section className="mt-5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-ink">
              <MessageSquareText size={12} className="text-ink-tertiary" />
              Script
            </div>
            <p className="mt-2 text-[11px] leading-5 text-ink-secondary">
              {scene.narration}
            </p>
          </section>

          <button
            type="button"
            onClick={() =>
              onEdit(
                `Revise the attached scene “${scene.title}”. Keep the rest of the cut unchanged and show me the proposed version before applying it.`,
              )
            }
            className="mt-5 flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[10px] font-medium text-ink-secondary hover:border-line-strong hover:bg-hover hover:text-ink"
          >
            <WandSparkles size={12} /> Revise with AI
          </button>
        </div>
      ) : (
        <p className="text-[10px] text-ink-tertiary">
          Select a scene to inspect it.
        </p>
      )}
    </div>
  );
};
