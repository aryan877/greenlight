import type {
  EvidenceLedger,
  Scene,
  VisualLookPreset,
} from "@greenlight/contracts";
import {
  CircleAlert,
  Clock3,
  ExternalLink,
  Gauge,
  MessageSquareText,
  Palette,
  RotateCcw,
  ShieldCheck,
  WandSparkles,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { formatTime } from "../editor/model.js";

export const InspectorPanel = ({
  scene,
  evidence,
  editing,
  onChangeLook,
  onChangeSpeed,
  onEdit,
}: {
  scene: Scene | null;
  evidence: EvidenceLedger | null;
  editing: boolean;
  onChangeLook: (scene: Scene, look: VisualLookPreset) => void;
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
  const sceneClaims = scene
    ? (evidence?.claims.filter((claim) => scene.claim_ids.includes(claim.id)) ??
      [])
    : [];
  const sourcesById = new Map(
    evidence?.sources.map((source) => [source.id, source]) ?? [],
  );
  const looks: Array<{ id: VisualLookPreset; label: string }> = [
    { id: "neutral", label: "Neutral" },
    { id: "warm", label: "Warm" },
    { id: "punchy", label: "Punchy" },
    { id: "monochrome", label: "Mono" },
  ];

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
              <Palette size={12} className="text-ink-tertiary" />
              Look
              <span className="ml-auto text-[9px] text-ink-caption">
                deterministic
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 border border-line-subtle">
              {looks.map((look) => (
                <button
                  key={look.id}
                  type="button"
                  disabled={editing}
                  aria-pressed={scene.visual.look === look.id}
                  onClick={() => onChangeLook(scene, look.id)}
                  className={`h-8 border-b border-r border-line-subtle text-[9px] last:border-b-0 hover:bg-hover ${
                    scene.visual.look === look.id
                      ? "bg-action-soft font-medium text-action"
                      : "text-ink-secondary"
                  }`}
                >
                  {look.label}
                </button>
              ))}
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

          <section className="mt-5 border-t border-line-subtle pt-4">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-ink">
              <ShieldCheck size={12} className="text-action" />
              Evidence lens
              <span className="ml-auto font-mono text-[9px] text-ink-caption">
                {
                  sceneClaims.filter((claim) => claim.status === "supported")
                    .length
                }
                /{sceneClaims.length}
              </span>
            </div>
            {sceneClaims.length > 0 ? (
              <div className="mt-2 divide-y divide-line-subtle border-y border-line-subtle">
                {sceneClaims.map((claim) => (
                  <div key={claim.id} className="py-2.5">
                    <div className="flex items-start gap-2">
                      {claim.status === "supported" ? (
                        <ShieldCheck
                          size={12}
                          className="mt-0.5 shrink-0 text-success"
                        />
                      ) : (
                        <CircleAlert
                          size={12}
                          className="mt-0.5 shrink-0 text-warning"
                        />
                      )}
                      <p className="text-[10px] leading-4 text-ink-secondary">
                        {claim.text}
                      </p>
                    </div>
                    <div className="ml-5 mt-1.5 space-y-1">
                      {claim.source_ids.flatMap((sourceId) => {
                        const source = sourcesById.get(sourceId);
                        return source
                          ? [
                              <a
                                key={source.id}
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 truncate text-[9px] text-action hover:underline"
                              >
                                <ExternalLink size={9} className="shrink-0" />
                                <span className="truncate">
                                  {source.publisher} · {source.title}
                                </span>
                              </a>,
                            ]
                          : [];
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[10px] leading-4 text-ink-tertiary">
                No factual claim is attached to this scene.
              </p>
            )}
            <button
              type="button"
              onClick={() =>
                onEdit(
                  `Audit every factual claim in the attached scene “${scene.title}”. Use current-web primary sources, update the evidence ledger, and do not change the cut.`,
                )
              }
              className="mt-2 text-[9px] font-medium text-action hover:underline"
            >
              Ask Producer to verify this scene
            </button>
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
