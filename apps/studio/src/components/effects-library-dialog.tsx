import {
  soundEffectPresetIds,
  soundEffectPresetRegistry,
  transitionPresetIds,
  transitionPresetRegistry,
  type Artifact,
  type SoundEffectPresetId,
  type TransitionPresetId,
} from "@greenlight/contracts";
import { Blend, Check, Play, Volume2, X } from "lucide-react";
import { useState } from "react";

import { greenlightApi } from "../api/greenlight.js";
import { useGenerateSoundEffect } from "../hooks/use-greenlight-queries.js";
import { cx } from "./controls.js";

type EffectsTab = "transitions" | "sounds";

const TransitionSwatch = ({
  preset,
  playing,
}: {
  preset: TransitionPresetId;
  playing: boolean;
}) => (
  <div
    data-preset={preset}
    data-playing={playing || undefined}
    className="transition-preview relative h-20 overflow-hidden rounded-xl bg-canvas"
  >
    <div className="transition-preview__from absolute inset-0 grid place-items-center bg-action-soft text-[10px] font-medium text-action">
      A
    </div>
    <div className="transition-preview__to absolute inset-0 grid place-items-center bg-track-caption-soft text-[10px] font-medium text-track-caption-strong">
      B
    </div>
    <span className="transition-preview__cut absolute inset-y-3 left-1/2 w-px bg-ink/30" />
    <span className="absolute bottom-1.5 left-2 rounded-full bg-surface/80 px-1.5 py-0.5 text-[7px] text-ink-caption backdrop-blur-sm">
      {playing ? "Previewing" : "Preview here"}
    </span>
  </div>
);

export const EffectsLibraryDialog = ({
  open,
  projectId,
  previewPreset,
  selectedPreset,
  onApplySound,
  onApplyTransition,
  onClose,
  onPreviewTransition,
}: {
  open: boolean;
  projectId: string;
  previewPreset: TransitionPresetId | null;
  selectedPreset: TransitionPresetId | null;
  onApplySound: (input: {
    artifact: Artifact;
    durationSeconds: number;
    presetId: SoundEffectPresetId;
  }) => Promise<void> | void;
  onApplyTransition: (preset: TransitionPresetId) => Promise<void> | void;
  onClose: () => void;
  onPreviewTransition: (preset: TransitionPresetId | null) => void;
}) => {
  const [tab, setTab] = useState<EffectsTab>("transitions");
  const [generated, setGenerated] = useState<
    Partial<Record<SoundEffectPresetId, Artifact>>
  >({});
  const [busyPreset, setBusyPreset] = useState<SoundEffectPresetId | null>(
    null,
  );
  const generate = useGenerateSoundEffect(projectId);
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Transitions and sound effects"
      className="fixed inset-0 z-[120] grid place-items-center bg-ink/35 p-5 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-float">
        <header className="flex shrink-0 items-center gap-3 border-b border-line-subtle px-4 py-3">
          <span className="grid size-9 place-items-center rounded-full bg-action-soft text-action">
            <Blend size={16} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-medium text-ink">
              {tab === "transitions" ? "Transitions" : "Sound effects"}
            </h2>
            <p className="text-[10px] text-ink-tertiary">
              Preview inside this picker, then place an editable timeline item.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close transitions and sound effects"
            onClick={onClose}
            className="ml-auto grid size-8 place-items-center rounded-full text-ink-tertiary hover:bg-hover hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex shrink-0 gap-1 border-b border-line-subtle px-4 py-3">
          {(
            [
              ["transitions", "Transitions"],
              ["sounds", "Sound effects"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cx(
                "h-8 rounded-full px-3 text-[11px] text-ink-tertiary",
                tab === id && "bg-surface-sunken text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="scroll-stable min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "transitions" ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {transitionPresetIds.map((preset) => {
                const definition = transitionPresetRegistry[preset];
                const selected = previewPreset === preset;
                return (
                  <article
                    key={preset}
                    className={cx(
                      "overflow-hidden rounded-2xl border bg-surface-raised p-2",
                      selected ? "border-action" : "border-line",
                    )}
                  >
                    <button
                      type="button"
                      aria-label={`${selected ? "Stop" : "Play"} ${definition.label} preview`}
                      onClick={() =>
                        onPreviewTransition(selected ? null : preset)
                      }
                      className="block w-full text-left"
                    >
                      <TransitionSwatch preset={preset} playing={selected} />
                    </button>
                    <div className="flex items-center gap-2 px-1 pb-1 pt-2">
                      <span className="min-w-0 flex-1 text-[11px] font-medium text-ink">
                        {definition.label}
                      </span>
                      {selectedPreset === preset ? (
                        <span className="rounded-full bg-action-soft px-1.5 py-0.5 text-[7px] font-medium text-action">
                          Selected
                        </span>
                      ) : null}
                      <span className="font-mono text-[8px] text-ink-caption">
                        {definition.default_duration_seconds.toFixed(2)}s
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onPreviewTransition(selected ? null : preset)
                        }
                        className="h-8 rounded-full border border-line text-[10px] text-ink-secondary hover:bg-hover"
                      >
                        {selected ? "Stop" : "Preview"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onApplyTransition(preset)}
                        className="h-8 rounded-full bg-control text-[10px] font-medium text-control-ink"
                      >
                        {selectedPreset ? "Replace" : "Apply"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {soundEffectPresetIds.map((preset) => {
                const definition = soundEffectPresetRegistry[preset];
                const artifact = generated[preset];
                const busy = busyPreset === preset;
                return (
                  <article
                    key={preset}
                    className="rounded-2xl border border-line bg-surface-raised p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-sunken text-track-voice-strong">
                        <Volume2 size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[11px] font-medium text-ink">
                          {definition.label}
                        </h3>
                        <p className="font-mono text-[8px] text-ink-caption">
                          {definition.default_duration_seconds.toFixed(2)}s
                        </p>
                      </div>
                      {artifact ? (
                        <span className="flex items-center gap-1 text-[9px] text-action">
                          <Check size={11} /> Ready
                        </span>
                      ) : null}
                    </div>
                    {artifact ? (
                      <audio
                        src={greenlightApi.artifactUrl(artifact.id)}
                        controls
                        preload="metadata"
                        className="mt-3 h-8 w-full"
                      />
                    ) : null}
                    <div className="mt-3 grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        disabled={generate.isPending}
                        onClick={() => {
                          setBusyPreset(preset);
                          void generate
                            .mutateAsync({
                              preset_id: preset,
                              intensity: 0.75,
                              variant: 0,
                            })
                            .then(({ artifact: next }) =>
                              setGenerated((current) => ({
                                ...current,
                                [preset]: next,
                              })),
                            )
                            .finally(() => setBusyPreset(null));
                        }}
                        className="flex h-8 items-center justify-center gap-1 rounded-full border border-line text-[10px] text-ink-secondary hover:bg-hover disabled:opacity-40"
                      >
                        <Play size={11} /> {busy ? "Making…" : "Make sample"}
                      </button>
                      <button
                        type="button"
                        disabled={!artifact}
                        onClick={() =>
                          artifact
                            ? void onApplySound({
                                artifact,
                                durationSeconds:
                                  definition.default_duration_seconds,
                                presetId: preset,
                              })
                            : undefined
                        }
                        className="h-8 rounded-full bg-control text-[10px] font-medium text-control-ink disabled:opacity-35"
                      >
                        Place on timeline
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
