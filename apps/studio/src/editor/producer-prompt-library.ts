export const producerPromptTemplates = [
  {
    group: "Evidence",
    label: "Verify selected scene",
    description: "Primary sources into the scene evidence lens.",
    prompt:
      "Audit every factual claim in the current scene. Use current-web primary sources, update the evidence ledger, and do not change the cut.",
  },
  {
    group: "Edit",
    label: "Tighten with preview",
    description: "Measured, word-accurate cuts with review first.",
    prompt:
      "Tighten the current selection using measured word boundaries. Preserve other lanes and show the typed edit preview before Apply.",
  },
  {
    group: "Edit",
    label: "Match the look",
    description: "One restrained deterministic look across scenes.",
    prompt:
      "Review the current cut and propose one restrained look preset per scene. Keep captions readable and show the patch before applying it.",
  },
  {
    group: "Audio",
    label: "Mix narration",
    description: "Normalize dialogue and duck the music bed.",
    prompt:
      "Normalize narration for consistent perceived loudness, enable -12 dB ducking on music under narration, then run the audio quality check.",
  },
  {
    group: "Release",
    label: "Three thumbnails",
    description: "Create three truthful 16:9 test candidates.",
    prompt:
      "Create three distinct, accurate 16:9 YouTube thumbnail candidates for the locked cut. Attach all three to the release test set and leave the final choice to me.",
  },
  {
    group: "Release",
    label: "Readiness pass",
    description: "Fill only missing release checks.",
    prompt:
      "Inspect release readiness. Run only missing evidence, caption, audio, black-frame, metadata, render, and disclosure checks. Stop before upload.",
  },
  {
    group: "TrueForge",
    label: "Refresh-safe research",
    description: "A durable child thread for the reconnect demo.",
    prompt:
      "Start a bounded research thread for the strongest unsupported claim, save meaningful progress, and continue through a browser refresh. Pause when sources are ready for my review.",
  },
  {
    group: "TrueForge",
    label: "Stage unlisted",
    description: "Lock hashes and request exact approval.",
    prompt:
      "Lock the current render, evidence, metadata, thumbnail, and disclosure snapshot. Run final checks, then request exact approval before staging an unlisted YouTube review.",
  },
] as const;
