import {
  soundEffectPresetRegistry,
  type GenerateSoundEffectInput,
} from "@greenlight/contracts";

import { generateSoundEffect } from "../providers/sound-design.js";
import type { ArtifactStore } from "../storage/artifacts.js";
import type { GreenlightStore } from "../storage/store.js";

export const generateSoundEffectArtifact = async ({
  artifacts,
  input,
  store,
}: {
  artifacts: ArtifactStore;
  input: GenerateSoundEffectInput;
  store: GreenlightStore;
}) => {
  if (!store.getProject(input.project_id)) throw new Error("project_not_found");

  const durationSeconds =
    input.duration_seconds ??
    soundEffectPresetRegistry[input.preset_id].default_duration_seconds;
  const cached = store.listArtifacts(input.project_id).find((artifact) => {
    const provenance = artifact.provenance;
    return (
      artifact.kind === "audio" &&
      provenance.source === "generated_sound_effect" &&
      provenance.preset_id === input.preset_id &&
      provenance.duration_seconds === durationSeconds &&
      provenance.intensity === input.intensity &&
      provenance.variant === input.variant
    );
  });
  if (cached) return { artifact: cached, cached: true };

  const generated = generateSoundEffect(input);
  const artifact = await artifacts.importBuffer({
    projectId: input.project_id,
    kind: "audio",
    filename: `${input.preset_id}-${input.variant}.wav`,
    bytes: generated.bytes,
    provenance: {
      producer: "greenlight_sound_design",
      source: "generated_sound_effect",
      preset_id: input.preset_id,
      duration_seconds: durationSeconds,
      measured_duration_seconds: generated.durationSeconds,
      intensity: input.intensity,
      variant: input.variant,
      sample_rate_hz: generated.sampleRate,
      license: "generated_for_project",
    },
  });
  return { artifact, cached: false };
};
