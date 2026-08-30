export const producerPromptTemplates = [
  {
    group: "Start",
    label: "Research and script",
    description: "Build an evidence-backed script before touching the cut.",
    prompt:
      "Research this topic with primary or authoritative sources, write a concise YouTube script, and leave the completed script open for my approval before production.",
  },
  {
    group: "Evidence",
    label: "Verify this scene",
    description: "Check every factual claim and attach its sources.",
    prompt:
      "Audit every factual claim in the selected scene, use current primary sources, update its evidence ledger, and do not change the cut.",
  },
  {
    group: "Edit",
    label: "Tighten pacing",
    description: "Remove dead air with measured, reviewable cuts.",
    prompt:
      "Tighten the selected section using measured word boundaries. Preserve every other lane and show the edit preview before applying it.",
  },
  {
    group: "Edit",
    label: "Match the look",
    description: "Apply one restrained visual treatment across scenes.",
    prompt:
      "Propose one restrained look across the current cut, keep skin tones and captions readable, and show the visual patch before applying it.",
  },
  {
    group: "Audio",
    label: "Mix dialogue and music",
    description: "Normalize speech and duck music underneath it.",
    prompt:
      "Normalize the dialogue, enable music ducking under speech, preserve intentional silence, and run the audio quality check.",
  },
  {
    group: "Audio",
    label: "Dub this video",
    description: "Audition a voice before creating the timed dub.",
    prompt:
      "Dub the current video. Ask for the target language, audition one voice sample, and wait for my choice before generating or placing the dub track.",
  },
  {
    group: "Captions",
    label: "Create captions",
    description: "Add timed captions from measured speech boundaries.",
    prompt:
      "Create accurate timed captions for the current dialogue, keep them inside YouTube-safe areas, and show the caption track before applying it.",
  },
  {
    group: "YouTube",
    label: "Create three thumbnails",
    description: "Generate three genuinely different 16:9 concepts.",
    prompt:
      "Generate exactly three distinct 16:9 YouTube thumbnails for this cut with GPT Image 2: one human or subject-led concept, one object or detail-led concept, and one bold graphic concept. Use different compositions, not minor variants, and leave the final choice to me.",
  },
] as const;
