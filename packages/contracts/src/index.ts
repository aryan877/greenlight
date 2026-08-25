import { z } from "zod";

export const VIDEO_FPS = 30;
export const MIN_SCENE_DURATION_SECONDS = 0.5;
const FRAME_EPSILON_SECONDS = 1e-6;
const snapSecondsToFrame = (seconds: number) =>
  Math.round(seconds * VIDEO_FPS) / VIDEO_FPS;

const frameAlignedSecondsSchema = z
  .number()
  .refine(
    (seconds) =>
      Math.abs(seconds * VIDEO_FPS - Math.round(seconds * VIDEO_FPS)) <=
      FRAME_EPSILON_SECONDS,
    "Time must align to the production frame rate",
  );

type TimedScene = {
  duration_seconds: number;
  gap_after_seconds?: number;
};

export const sceneStartSeconds = (
  scenes: ReadonlyArray<TimedScene>,
  index: number,
) =>
  scenes
    .slice(0, index)
    .reduce(
      (sum, scene) =>
        sum + scene.duration_seconds + (scene.gap_after_seconds ?? 0),
      0,
    );

export const scenePresentationDurationSeconds = (
  scenes: ReadonlyArray<TimedScene>,
  index: number,
) => Math.max(0, scenes[index]?.duration_seconds ?? 0);

export const productionDurationSeconds = (scenes: ReadonlyArray<TimedScene>) =>
  scenes.reduce(
    (sum, scene) =>
      sum + scene.duration_seconds + (scene.gap_after_seconds ?? 0),
    0,
  );

export const idSchema = z
  .string()
  .min(8)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9_-]+$/i);

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const projectStageSchema = z.enum([
  "brief",
  "researching",
  "blocked",
  "drafted",
  "verified",
  "packaged",
  "rendering",
  "render_failed",
  "rendered",
  "uploading",
  "upload_failed",
  "unlisted",
  "awaiting_approval",
  "released",
]);

export const projectBriefSchema = z.object({
  topic: z.string().trim().min(8).max(240),
  audience: z.string().trim().min(3).max(160),
  goal: z.string().trim().min(8).max(300),
  target_duration_seconds: z.number().int().min(30).max(120).default(60),
  tone: z.string().trim().min(2).max(80).default("clear, curious, cinematic"),
});

export const projectSchema = z.object({
  id: idSchema,
  brief: projectBriefSchema,
  stage: projectStageSchema,
  blocker: z.string().nullable().default(null),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const sourceSchema = z.object({
  id: idSchema,
  url: z.string().url(),
  title: z.string().min(1).max(300),
  publisher: z.string().min(1).max(160),
  accessed_at: z.string().datetime(),
  excerpt: z.string().max(800),
  license: z.string().max(120).nullable().default(null),
});

export const claimSchema = z.object({
  id: idSchema,
  text: z.string().trim().min(8).max(500),
  source_ids: z.array(idSchema).min(1),
  status: z.enum(["supported", "conflicted", "unsupported"]),
  note: z.string().max(500).nullable().default(null),
});

export const evidenceLedgerSchema = z
  .object({
    project_id: idSchema,
    sources: z.array(sourceSchema).min(1),
    claims: z.array(claimSchema).min(1),
  })
  .superRefine(({ sources, claims }, context) => {
    const sourceIds = new Set(sources.map((source) => source.id));
    for (const claim of claims) {
      for (const sourceId of claim.source_ids) {
        if (!sourceIds.has(sourceId)) {
          context.addIssue({
            code: "custom",
            message: `Claim ${claim.id} references missing source ${sourceId}`,
            path: ["claims", claims.indexOf(claim), "source_ids"],
          });
        }
      }
    }
  });

export const sceneKindSchema = z.enum([
  "hook",
  "evidence",
  "explanation",
  "contrast",
  "resolution",
  "cta",
]);

export const sourceClipSchema = z
  .object({
    artifact_id: idSchema,
    in_seconds: z.number().nonnegative(),
    out_seconds: z.number().positive(),
    source_duration_seconds: z.number().positive(),
  })
  .superRefine((source, context) => {
    if (source.out_seconds <= source.in_seconds) {
      context.addIssue({
        code: "custom",
        message: "Source out must be after source in",
        path: ["out_seconds"],
      });
    }
    if (source.out_seconds > source.source_duration_seconds) {
      context.addIssue({
        code: "custom",
        message: "Source out exceeds available media",
        path: ["out_seconds"],
      });
    }
  });

export const sceneSchema = z.object({
  id: idSchema,
  kind: sceneKindSchema,
  title: z.string().trim().min(1).max(90),
  narration: z.string().trim().min(1).max(650),
  narration_artifact_id: idSchema.nullable().default(null),
  captions_artifact_id: idSchema.nullable().default(null),
  transcript_artifact_id: idSchema.nullable().default(null),
  claim_ids: z.array(idSchema),
  duration_seconds: frameAlignedSecondsSchema
    .min(MIN_SCENE_DURATION_SECONDS)
    .max(120),
  gap_after_seconds: frameAlignedSecondsSchema
    .nonnegative()
    .max(120)
    .optional(),
  source_clip: sourceClipSchema.nullable().optional(),
  playback_rate: z.number().min(0.5).max(3).default(1),
  visual: z.object({
    treatment: z.enum([
      "type",
      "quote",
      "number",
      "image",
      "timeline",
      "openmoji",
    ]),
    prompt: z.string().max(900).nullable().default(null),
    artifact_ids: z.array(idSchema).max(4).default([]),
    accent: z.enum(["signal", "ink", "ember"]).default("signal"),
  }),
});

export const localizedNarrationTrackSchema = z.object({
  id: idSchema,
  scene_id: idSchema,
  locale: z.string().trim().min(2).max(35),
  script: z.string().trim().min(1).max(650),
  narration_artifact_id: idSchema.nullable().default(null),
  captions_artifact_id: idSchema.nullable().default(null),
  transcript_artifact_id: idSchema.nullable().default(null),
  status: z.enum(["draft", "generated", "reviewed"]).default("draft"),
});

export const audioTrackRoleSchema = z.enum([
  "narration",
  "dub",
  "music",
  "effects",
]);

const audioClipIdSchema = z
  .string()
  .min(8)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]+$/i);

export const audioTrackClipSchema = z
  .object({
    id: audioClipIdSchema,
    scene_id: idSchema,
    label: z.string().trim().min(1).max(90),
    artifact_id: idSchema.nullable().default(null),
    script: z.string().trim().min(1).max(650).nullable().default(null),
    transcript_artifact_id: idSchema.nullable().default(null),
    captions_artifact_id: idSchema.nullable().default(null),
    start_offset_seconds: frameAlignedSecondsSchema
      .nonnegative()
      .max(120)
      .default(0),
    source_in_seconds: z.number().nonnegative().default(0),
    source_out_seconds: z.number().positive().nullable().default(null),
    playback_rate: z.number().min(0.5).max(3).default(1),
    status: z.enum(["draft", "generated", "reviewed"]).default("draft"),
  })
  .superRefine((clip, context) => {
    if (
      clip.source_out_seconds !== null &&
      clip.source_out_seconds <= clip.source_in_seconds
    ) {
      context.addIssue({
        code: "custom",
        message: "Audio source out must be after source in",
        path: ["source_out_seconds"],
      });
    }
  });

export const audioTrackSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  role: audioTrackRoleSchema,
  locale: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i, "Use a BCP-47 locale")
    .nullable()
    .default(null),
  voice_label: z.string().trim().min(1).max(80).nullable().default(null),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  export_enabled: z.boolean().default(true),
  gain: z.number().min(0).max(2).default(1),
  clips: z.array(audioTrackClipSchema).default([]),
});

export const youtubeMetadataSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(5000),
  tags: z.array(z.string().trim().min(1).max(80)).max(30),
  category_id: z.string().regex(/^\d+$/).default("28"),
  made_for_kids: z.boolean().default(false),
  contains_synthetic_media: z.boolean().default(true),
});

export const contentPackageSchema = z
  .object({
    version: z.literal(1),
    project_id: idSchema,
    headline: z.string().trim().min(4).max(100),
    dek: z.string().trim().min(8).max(180),
    scenes: z.array(sceneSchema).min(1),
    localized_narration_tracks: z
      .array(localizedNarrationTrackSchema)
      .optional(),
    audio_tracks: z.array(audioTrackSchema).optional(),
    metadata: youtubeMetadataSchema,
  })
  .superRefine(({ scenes, audio_tracks: audioTracks }, context) => {
    const seconds = productionDurationSeconds(scenes);
    if (seconds < 30 || seconds > 120) {
      context.addIssue({
        code: "custom",
        message: `Scene duration total must be 30–120 seconds; received ${seconds}`,
        path: ["scenes"],
      });
    }
    scenes.forEach((scene, index) => {
      const source = scene.source_clip;
      if (!source) return;
      if (!scene.visual.artifact_ids.includes(source.artifact_id)) {
        context.addIssue({
          code: "custom",
          message: "Source clip must be one of the scene's visual artifacts",
          path: ["scenes", index, "source_clip", "artifact_id"],
        });
      }
      const sourceSpan =
        (source.out_seconds - source.in_seconds) / scene.playback_rate;
      if (Math.abs(sourceSpan - scene.duration_seconds) > 1 / VIDEO_FPS) {
        context.addIssue({
          code: "custom",
          message: "Scene duration must match its source in/out range",
          path: ["scenes", index, "duration_seconds"],
        });
      }
    });
    const sceneIds = new Set(scenes.map((scene) => scene.id));
    const trackIds = new Set<string>();
    const clipIds = new Set<string>();
    for (const [trackIndex, track] of (audioTracks ?? []).entries()) {
      if (trackIds.has(track.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate audio track ${track.id}`,
          path: ["audio_tracks", trackIndex, "id"],
        });
      }
      trackIds.add(track.id);
      for (const [clipIndex, clip] of track.clips.entries()) {
        if (!sceneIds.has(clip.scene_id)) {
          context.addIssue({
            code: "custom",
            message: `Audio clip references missing scene ${clip.scene_id}`,
            path: ["audio_tracks", trackIndex, "clips", clipIndex, "scene_id"],
          });
        }
        if (clipIds.has(clip.id)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate audio clip ${clip.id}`,
            path: ["audio_tracks", trackIndex, "clips", clipIndex, "id"],
          });
        }
        clipIds.add(clip.id);
        const scene = scenes.find(
          (candidate) => candidate.id === clip.scene_id,
        );
        if (scene && clip.start_offset_seconds >= scene.duration_seconds) {
          context.addIssue({
            code: "custom",
            message: "Audio clip offset must be inside its scene",
            path: [
              "audio_tracks",
              trackIndex,
              "clips",
              clipIndex,
              "start_offset_seconds",
            ],
          });
        }
      }
    }
  });

export type AudioTrack = z.infer<typeof audioTrackSchema>;

const primaryAudioClip = (scene: Scene): AudioTrack["clips"][number] => ({
  id: `voice_${scene.id}`,
  scene_id: scene.id,
  label: scene.title,
  artifact_id: scene.narration_artifact_id,
  script: scene.narration,
  transcript_artifact_id: scene.transcript_artifact_id,
  captions_artifact_id: scene.captions_artifact_id,
  start_offset_seconds: 0,
  source_in_seconds: 0,
  source_out_seconds: null,
  playback_rate: 1,
  status: scene.narration_artifact_id ? "generated" : "draft",
});

const splitAudioClip = (
  clip: AudioTrack["clips"][number],
  first: Scene,
  second: Scene,
  originalDuration: number,
): AudioTrack["clips"] => {
  const splitAt = first.duration_seconds;
  const startsAt = clip.start_offset_seconds;
  const sourceDuration =
    clip.source_out_seconds === null
      ? originalDuration - startsAt
      : (clip.source_out_seconds - clip.source_in_seconds) / clip.playback_rate;
  const endsAt = startsAt + sourceDuration;
  const secondId = `${clip.id.slice(0, 58)}_${second.id.slice(-32)}`;
  if (startsAt >= splitAt) {
    return [
      {
        ...clip,
        id: secondId,
        scene_id: second.id,
        start_offset_seconds: snapSecondsToFrame(startsAt - splitAt),
      },
    ];
  }
  if (endsAt <= splitAt + 1 / VIDEO_FPS) return [clip];
  const boundary =
    clip.source_in_seconds + (splitAt - startsAt) * clip.playback_rate;
  return [
    { ...clip, source_out_seconds: boundary },
    {
      ...clip,
      id: secondId,
      scene_id: second.id,
      start_offset_seconds: 0,
      source_in_seconds: boundary,
    },
  ];
};

const primaryAudioTrack = (content: { scenes: Scene[] }): AudioTrack => ({
  id: "track_primary_voice",
  name: "Primary voice",
  role: "narration",
  locale: null,
  voice_label: null,
  muted: false,
  solo: false,
  export_enabled: true,
  gain: 1,
  clips: content.scenes.map(primaryAudioClip),
});

export const effectiveAudioTracks = (content: ContentPackage): AudioTrack[] => {
  if (content.audio_tracks) return content.audio_tracks;
  const grouped = new Map<string, LocalizedNarrationTrack[]>();
  for (const track of content.localized_narration_tracks ?? []) {
    const existing = grouped.get(track.locale) ?? [];
    existing.push(track);
    grouped.set(track.locale, existing);
  }
  return [
    primaryAudioTrack(content),
    ...[...grouped.entries()].map(([locale, tracks]) => ({
      id: `track_dub_${locale.replace(/[^a-z0-9]+/gi, "_")}`.slice(0, 80),
      name: `${locale} dub`,
      role: "dub" as const,
      locale,
      voice_label: null,
      muted: false,
      solo: false,
      export_enabled: true,
      gain: 1,
      clips: tracks.map((track) => ({
        id: track.id,
        scene_id: track.scene_id,
        label: track.script.slice(0, 90),
        artifact_id: track.narration_artifact_id,
        script: track.script,
        transcript_artifact_id: track.transcript_artifact_id,
        captions_artifact_id: track.captions_artifact_id,
        start_offset_seconds: 0,
        source_in_seconds: 0,
        source_out_seconds: null,
        playback_rate: 1,
        status: track.status,
      })),
    })),
  ];
};

export const audibleAudioTracks = (content: ContentPackage): AudioTrack[] => {
  const exportable = effectiveAudioTracks(content).filter(
    (track) => track.export_enabled,
  );
  const hasSolo = exportable.some((track) => track.solo);
  return exportable.filter((track) => !track.muted && (!hasSolo || track.solo));
};

export const artifactKindSchema = z.enum([
  "evidence_ledger",
  "content_package",
  "image",
  "narration",
  "video",
  "thumbnail",
  "caption",
  "transcript",
  "edit_patch",
  "quality_report",
  "release_report",
]);

export const artifactSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  kind: artifactKindSchema,
  sha256: sha256Schema,
  relative_path: z.string().min(1).max(600),
  mime_type: z.string().min(3).max(120),
  byte_size: z.number().int().nonnegative(),
  provenance: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime(),
});

export const qualityCheckSchema = z.object({
  name: z.string().min(1).max(100),
  passed: z.boolean(),
  detail: z.string().max(500),
  measured: z
    .union([z.string(), z.number(), z.boolean()])
    .nullable()
    .default(null),
});

export const qualityReportSchema = z.object({
  project_id: idSchema,
  video_artifact_id: idSchema,
  content_package_artifact_id: idSchema,
  evidence_ledger_artifact_id: idSchema,
  passed: z.boolean(),
  checks: z.array(qualityCheckSchema).min(1),
  created_at: z.string().datetime(),
});

export const releaseSnapshotSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  youtube_video_id: z.string().min(6).max(32),
  channel_id: z.string().min(6).max(64),
  video_sha256: sha256Schema,
  content_package_sha256: sha256Schema,
  metadata_sha256: sha256Schema,
  quality_report_sha256: sha256Schema,
  evidence_ledger_sha256: sha256Schema,
  privacy: z.literal("unlisted"),
  created_at: z.string().datetime(),
});

export const publishVideoInputSchema = z.object({
  project_id: idSchema,
  youtube_release_id: idSchema,
  release_snapshot_sha256: sha256Schema,
  idempotency_key: z.string().min(16).max(160),
});

export const scheduleVideoInputSchema = publishVideoInputSchema.extend({
  publish_at: z.string().datetime(),
});

export const generateImageInputSchema = z.object({
  project_id: idSchema,
  scene_id: idSchema.nullable().default(null),
  kind: z.enum(["image", "thumbnail"]).default("image"),
  prompt: z.string().trim().min(20).max(2400),
  aspect_ratio: z.enum(["16:9", "1:1", "9:16"]).default("16:9"),
});

export const generateVoiceInputSchema = z.object({
  project_id: idSchema,
  scene_id: idSchema,
  track_id: idSchema.optional(),
  script: z.string().trim().min(1).max(5000),
  locale: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i, "Use a BCP-47 locale")
    .optional(),
  voice_id: z.string().trim().min(1).max(80).optional(),
});

export const transcriptWordSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string().trim().min(1).max(120),
  start_seconds: z.number().nonnegative(),
  end_seconds: z.number().positive(),
});

export const transcriptSchema = z.object({
  version: z.literal(1),
  project_id: idSchema,
  scene_id: idSchema,
  audio_artifact_id: idSchema,
  locale: z.string().trim().min(2).max(35),
  text: z.string().trim().min(1),
  reference_text: z.string().trim().min(1),
  words: z.array(transcriptWordSchema).min(1),
  provider: z.object({
    name: z.literal("openrouter+whisper.cpp"),
    transcription_model: z.string().min(1),
    timing_model: z.string().min(1),
    usage_cost_usd: z.number().nonnegative().nullable(),
  }),
});

export const captionCueSchema = z
  .object({
    text: z.string().min(1).max(240),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    timestampMs: z.number().int().nonnegative().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
  })
  .refine((cue) => cue.endMs > cue.startMs, {
    message: "Caption end must be after its start",
    path: ["endMs"],
  });

export const captionTrackSchema = z
  .object({
    version: z.literal(1),
    project_id: idSchema,
    scene_id: idSchema,
    locale: z.string().trim().min(2).max(35),
    transcript_artifact_id: idSchema,
    cues: z.array(captionCueSchema).min(1),
  })
  .superRefine(({ cues }, context) => {
    for (let index = 1; index < cues.length; index += 1) {
      if (cues[index]!.startMs < cues[index - 1]!.startMs) {
        context.addIssue({
          code: "custom",
          message: "Caption cues must be ordered by start time",
          path: ["cues", index, "startMs"],
        });
      }
    }
  });

export const transcribeAudioInputSchema = z.object({
  project_id: idSchema,
  scene_id: idSchema,
  audio_artifact_id: idSchema,
  locale: z.string().trim().min(2).max(35).default("en"),
  prompt: z.string().trim().max(500).nullable().default(null),
});

export const findSpokenPhraseInputSchema = z.object({
  project_id: idSchema,
  transcript_artifact_id: idSchema,
  phrase: z.string().trim().min(1).max(500),
});

export const correctTranscriptInputSchema = z.object({
  project_id: idSchema,
  transcript_artifact_id: idSchema,
  replacements: z
    .array(
      z.object({
        word_index: z.number().int().nonnegative(),
        text: z.string().trim().min(1).max(120),
      }),
    )
    .min(1)
    .max(100),
  note: z.string().trim().min(3).max(500),
});

export const renderVideoInputSchema = z.object({
  project_id: idSchema,
  content_package_artifact_id: idSchema,
  idempotency_key: z.string().min(16).max(160),
});

export const getArtifactInputSchema = z.object({
  project_id: idSchema,
  artifact_id: idSchema,
});

export const qualityCheckInputSchema = z.object({
  project_id: idSchema,
  video_artifact_id: idSchema,
  content_package_artifact_id: idSchema,
  evidence_ledger_artifact_id: idSchema,
});

export const stageVideoInputSchema = qualityCheckInputSchema.extend({
  thumbnail_artifact_id: idSchema.nullable().default(null),
  quality_report_artifact_id: idSchema,
  idempotency_key: z.string().min(16).max(160),
});

export const editorTrackIdSchema = z.union([
  z.enum([
    "visual",
    "voice",
    "caption",
    "transcript",
    "evidence",
    "music",
    "release",
  ]),
  idSchema,
]);

export const searchOpenMojiInputSchema = z.object({
  query: z.string().trim().min(2).max(100),
  limit: z.number().int().min(1).max(12).default(6),
});

export const attachOpenMojiInputSchema = z.object({
  project_id: idSchema,
  scene_id: idSchema,
  hexcode: z
    .string()
    .trim()
    .regex(/^[A-F0-9]+(?:-[A-F0-9]+)*$/i),
});

export const editorSelectionSchema = z
  .object({
    project_id: idSchema,
    base_content_package_artifact_id: idSchema,
    scene_ids: z.array(idSchema).default([]),
    track_ids: z.array(editorTrackIdSchema).default([]),
    artifact_ids: z.array(idSchema).default([]),
    playhead_seconds: frameAlignedSecondsSchema
      .nonnegative()
      .nullable()
      .default(null),
    time_range_seconds: z
      .object({
        start: z.number().nonnegative(),
        end: z.number().positive(),
      })
      .nullable()
      .default(null),
  })
  .superRefine((selection, context) => {
    if (
      selection.time_range_seconds &&
      selection.time_range_seconds.end <= selection.time_range_seconds.start
    ) {
      context.addIssue({
        code: "custom",
        message: "Selection end must be after start",
        path: ["time_range_seconds", "end"],
      });
    }
  });

export const editorTimelineContextSchema = z.object({
  project_id: idSchema,
  content_package_artifact_id: idSchema,
  headline: z.string().trim().min(1).max(100),
  duration_seconds: frameAlignedSecondsSchema.nonnegative(),
  playhead_seconds: frameAlignedSecondsSchema.nonnegative(),
  scenes: z.array(
    z.object({
      id: idSchema,
      title: z.string().trim().min(1).max(90),
      start_seconds: frameAlignedSecondsSchema.nonnegative(),
      end_seconds: frameAlignedSecondsSchema.nonnegative(),
      gap_after_seconds: frameAlignedSecondsSchema.nonnegative(),
      playback_rate: z.number().min(0.5).max(3),
    }),
  ),
});

export const editorFocusInputSchema = z.object({
  selection: editorSelectionSchema,
  reason: z.string().trim().min(1).max(240),
});

const sceneVisualPatchSchema = z
  .object({
    treatment: z
      .enum(["type", "quote", "number", "image", "timeline", "openmoji"])
      .optional(),
    prompt: z.string().max(900).nullable().optional(),
    artifact_ids: z.array(idSchema).max(4).optional(),
    accent: z.enum(["signal", "ink", "ember"]).optional(),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    {
      message: "Visual patch must change at least one field",
    },
  );

export const editorPatchOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("update_scene"),
      scene_id: idSchema,
      kind: sceneKindSchema.optional(),
      title: z.string().trim().min(1).max(90).optional(),
      narration: z.string().trim().min(1).max(650).optional(),
      narration_artifact_id: idSchema.nullable().optional(),
      captions_artifact_id: idSchema.nullable().optional(),
      transcript_artifact_id: idSchema.nullable().optional(),
      claim_ids: z.array(idSchema).optional(),
      duration_seconds: frameAlignedSecondsSchema
        .min(MIN_SCENE_DURATION_SECONDS)
        .max(120)
        .optional(),
      gap_after_seconds: frameAlignedSecondsSchema
        .nonnegative()
        .max(120)
        .optional(),
      source_clip: sourceClipSchema.nullable().optional(),
      playback_rate: z.number().min(0.5).max(3).optional(),
      visual: sceneVisualPatchSchema.optional(),
    })
    .refine(
      ({ type: _type, scene_id: _sceneId, ...patch }) =>
        Object.values(patch).some((value) => value !== undefined),
      { message: "Scene patch must change at least one field" },
    ),
  z.object({
    type: z.literal("split_scene"),
    scene_id: idSchema,
    first: sceneSchema,
    second: sceneSchema,
  }),
  z.object({
    type: z.literal("remove_scene"),
    scene_id: idSchema,
  }),
  z.object({
    type: z.literal("reorder_scenes"),
    scene_ids: z.array(idSchema).min(1),
  }),
  z.object({
    type: z.literal("upsert_localized_track"),
    track: localizedNarrationTrackSchema,
  }),
  z.object({
    type: z.literal("remove_localized_track"),
    track_id: idSchema,
  }),
  z.object({
    type: z.literal("upsert_audio_track"),
    track: audioTrackSchema,
  }),
  z.object({
    type: z.literal("remove_audio_track"),
    track_id: idSchema,
  }),
]);

export const editorPatchInputSchema = z.object({
  selection: editorSelectionSchema,
  instruction_summary: z.string().trim().min(3).max(500),
  operations: z.array(editorPatchOperationSchema).min(1).max(20),
});

export type ProjectStage = z.infer<typeof projectStageSchema>;
export type ProjectBrief = z.infer<typeof projectBriefSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type EvidenceLedger = z.infer<typeof evidenceLedgerSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type ContentPackage = z.infer<typeof contentPackageSchema>;
export type LocalizedNarrationTrack = z.infer<
  typeof localizedNarrationTrackSchema
>;
export type AudioTrackRole = z.infer<typeof audioTrackRoleSchema>;
export type AudioTrackClip = z.infer<typeof audioTrackClipSchema>;
export type YoutubeMetadata = z.infer<typeof youtubeMetadataSchema>;
export type ArtifactKind = z.infer<typeof artifactKindSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type QualityReport = z.infer<typeof qualityReportSchema>;
export type QualityCheck = z.infer<typeof qualityCheckSchema>;
export type ReleaseSnapshot = z.infer<typeof releaseSnapshotSchema>;
export type PublishVideoInput = z.infer<typeof publishVideoInputSchema>;
export type ScheduleVideoInput = z.infer<typeof scheduleVideoInputSchema>;
export type GenerateImageInput = z.infer<typeof generateImageInputSchema>;
export type GenerateVoiceInput = z.infer<typeof generateVoiceInputSchema>;
export type TranscriptWord = z.infer<typeof transcriptWordSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
export type CaptionCue = z.infer<typeof captionCueSchema>;
export type CaptionTrack = z.infer<typeof captionTrackSchema>;
export type TranscribeAudioInput = z.infer<typeof transcribeAudioInputSchema>;
export type FindSpokenPhraseInput = z.infer<typeof findSpokenPhraseInputSchema>;
export type CorrectTranscriptInput = z.infer<
  typeof correctTranscriptInputSchema
>;
export type RenderVideoInput = z.infer<typeof renderVideoInputSchema>;
export type GetArtifactInput = z.infer<typeof getArtifactInputSchema>;
export type QualityCheckInput = z.infer<typeof qualityCheckInputSchema>;
export type StageVideoInput = z.infer<typeof stageVideoInputSchema>;
export type EditorSelection = z.infer<typeof editorSelectionSchema>;
export type EditorFocusInput = z.infer<typeof editorFocusInputSchema>;
export type SearchOpenMojiInput = z.infer<typeof searchOpenMojiInputSchema>;
export type AttachOpenMojiInput = z.infer<typeof attachOpenMojiInputSchema>;
export type EditorPatchOperation = z.infer<typeof editorPatchOperationSchema>;
export type EditorTimelineContext = z.infer<typeof editorTimelineContextSchema>;
export type EditorPatchInput = z.infer<typeof editorPatchInputSchema>;

const requireScene = (scenes: Scene[], sceneId: string): number => {
  const index = scenes.findIndex((scene) => scene.id === sceneId);
  if (index === -1) throw new Error(`scene_not_found:${sceneId}`);
  return index;
};

const requireSelectedScene = (
  selectedSceneIds: Set<string>,
  sceneId: string,
): void => {
  if (selectedSceneIds.size > 0 && !selectedSceneIds.has(sceneId)) {
    throw new Error(`scene_outside_selection:${sceneId}`);
  }
};

export const applyEditorPatch = (
  baseInput: ContentPackage,
  patchInput: EditorPatchInput,
): ContentPackage => {
  const base = contentPackageSchema.parse(baseInput);
  const patch = editorPatchInputSchema.parse(patchInput);
  const { selection } = patch;
  if (selection.project_id !== base.project_id) {
    throw new Error("selection_project_mismatch");
  }

  const selectedSceneIds = new Set(selection.scene_ids);
  const selectedTrackIds = new Set(selection.track_ids);
  for (const sceneId of selectedSceneIds) requireScene(base.scenes, sceneId);
  const totalDuration = productionDurationSeconds(base.scenes);
  if (
    selection.time_range_seconds &&
    selection.time_range_seconds.end > totalDuration
  ) {
    throw new Error("selection_time_range_outside_production");
  }
  if (selection.time_range_seconds && selectedSceneIds.size > 0) {
    const selectedIndexes = [...selectedSceneIds].map((sceneId) =>
      requireScene(base.scenes, sceneId),
    );
    const selectedStart = Math.min(
      ...selectedIndexes.map((index) => sceneStartSeconds(base.scenes, index)),
    );
    const selectedEnd = Math.max(
      ...selectedIndexes.map(
        (index) =>
          sceneStartSeconds(base.scenes, index) +
          base.scenes[index]!.duration_seconds,
      ),
    );
    const epsilon = 1 / VIDEO_FPS;
    if (
      selection.time_range_seconds.start > selectedStart + epsilon ||
      selection.time_range_seconds.end < selectedEnd - epsilon
    ) {
      throw new Error("selection_time_range_excludes_scene");
    }
  }

  const requireTrack = (trackId: string): void => {
    if (!selectedTrackIds.has(trackId)) {
      throw new Error(`track_outside_selection:${trackId}`);
    }
  };

  const requireOneTrack = (...trackIds: string[]): void => {
    if (!trackIds.some((trackId) => selectedTrackIds.has(trackId))) {
      throw new Error(`track_outside_selection:${trackIds.join("|")}`);
    }
  };

  const next = structuredClone(base);
  next.localized_narration_tracks ??= [];

  for (const operation of patch.operations) {
    switch (operation.type) {
      case "update_scene": {
        requireSelectedScene(selectedSceneIds, operation.scene_id);
        if (
          operation.kind !== undefined ||
          operation.title !== undefined ||
          operation.claim_ids !== undefined ||
          operation.visual !== undefined ||
          operation.duration_seconds !== undefined ||
          operation.gap_after_seconds !== undefined ||
          operation.source_clip !== undefined
        ) {
          requireTrack("visual");
        }
        if (
          operation.narration !== undefined ||
          operation.narration_artifact_id !== undefined ||
          operation.playback_rate !== undefined
        ) {
          requireTrack("voice");
        }
        if (operation.captions_artifact_id !== undefined) {
          requireTrack("caption");
        }
        if (operation.transcript_artifact_id !== undefined) {
          requireTrack("transcript");
        }
        const index = requireScene(next.scenes, operation.scene_id);
        const current = next.scenes[index]!;
        const requestedDuration =
          operation.duration_seconds ?? current.duration_seconds;
        const durationRemoved = Math.max(
          0,
          current.duration_seconds - requestedDuration,
        );
        const requestedGap =
          operation.gap_after_seconds ??
          (current.gap_after_seconds ?? 0) + durationRemoved;
        const rateStretch =
          operation.playback_rate !== undefined &&
          operation.duration_seconds !== undefined;
        if (requestedDuration > current.duration_seconds && !rateStretch) {
          const source = operation.source_clip ?? current.source_clip;
          if (!source) throw new Error("scene_extension_has_no_source");
          const availableDuration =
            (source.source_duration_seconds - source.in_seconds) /
            (operation.playback_rate ?? current.playback_rate);
          if (requestedDuration > availableDuration + 1 / VIDEO_FPS) {
            throw new Error("scene_extension_exceeds_source");
          }
          const extension = requestedDuration - current.duration_seconds;
          if (extension > (current.gap_after_seconds ?? 0) + 1 / VIDEO_FPS) {
            throw new Error("scene_extension_exceeds_gap");
          }
          if (
            requestedGap >
            (current.gap_after_seconds ?? 0) - extension + 1 / VIDEO_FPS
          ) {
            throw new Error("scene_extension_must_consume_gap");
          }
        }
        next.scenes[index] = {
          ...current,
          ...(operation.kind === undefined ? {} : { kind: operation.kind }),
          ...(operation.title === undefined ? {} : { title: operation.title }),
          ...(operation.narration === undefined
            ? {}
            : { narration: operation.narration }),
          ...(operation.narration_artifact_id === undefined
            ? {}
            : { narration_artifact_id: operation.narration_artifact_id }),
          ...(operation.captions_artifact_id === undefined
            ? {}
            : { captions_artifact_id: operation.captions_artifact_id }),
          ...(operation.transcript_artifact_id === undefined
            ? {}
            : { transcript_artifact_id: operation.transcript_artifact_id }),
          ...(operation.claim_ids === undefined
            ? {}
            : { claim_ids: operation.claim_ids }),
          ...(operation.duration_seconds === undefined
            ? {}
            : { duration_seconds: operation.duration_seconds }),
          ...(operation.gap_after_seconds === undefined &&
          operation.duration_seconds === undefined
            ? {}
            : { gap_after_seconds: requestedGap }),
          ...(operation.source_clip === undefined
            ? {}
            : { source_clip: operation.source_clip }),
          ...(operation.playback_rate === undefined
            ? {}
            : { playback_rate: operation.playback_rate }),
          ...(operation.visual === undefined
            ? {}
            : { visual: { ...current.visual, ...operation.visual } }),
        };
        const primaryTrack = next.audio_tracks?.find(
          (track) => track.id === "track_primary_voice",
        );
        const primaryClipIndex = primaryTrack?.clips.findIndex(
          (clip) => clip.scene_id === operation.scene_id,
        );
        if (
          primaryTrack &&
          primaryClipIndex !== undefined &&
          primaryClipIndex >= 0
        ) {
          const currentClip = primaryTrack.clips[primaryClipIndex]!;
          primaryTrack.clips[primaryClipIndex] = {
            ...currentClip,
            ...(operation.title === undefined
              ? {}
              : { label: operation.title }),
            ...(operation.narration === undefined
              ? {}
              : { script: operation.narration }),
            ...(operation.narration_artifact_id === undefined
              ? {}
              : { artifact_id: operation.narration_artifact_id }),
            ...(operation.captions_artifact_id === undefined
              ? {}
              : { captions_artifact_id: operation.captions_artifact_id }),
            ...(operation.transcript_artifact_id === undefined
              ? {}
              : { transcript_artifact_id: operation.transcript_artifact_id }),
          };
        }
        break;
      }
      case "split_scene": {
        requireSelectedScene(selectedSceneIds, operation.scene_id);
        requireTrack("visual");
        requireTrack("voice");
        requireTrack("caption");
        const index = requireScene(next.scenes, operation.scene_id);
        const current = next.scenes[index]!;
        if (operation.first.id !== operation.scene_id) {
          throw new Error("split_first_scene_must_preserve_id");
        }
        if (
          operation.second.id === operation.scene_id ||
          next.scenes.some((scene) => scene.id === operation.second.id)
        ) {
          throw new Error("split_second_scene_id_conflict");
        }
        if (
          Math.abs(
            operation.first.duration_seconds +
              operation.second.duration_seconds -
              current.duration_seconds,
          ) >
          1 / VIDEO_FPS
        ) {
          throw new Error("split_scene_must_preserve_duration");
        }
        next.scenes.splice(index, 1, operation.first, operation.second);
        if (next.audio_tracks) {
          next.audio_tracks = next.audio_tracks.map((track) => ({
            ...track,
            clips: track.clips.flatMap((clip) =>
              clip.scene_id === operation.scene_id
                ? splitAudioClip(
                    clip,
                    operation.first,
                    operation.second,
                    current.duration_seconds,
                  )
                : [clip],
            ),
          }));
        }
        break;
      }
      case "remove_scene": {
        requireSelectedScene(selectedSceneIds, operation.scene_id);
        requireTrack("visual");
        const index = requireScene(next.scenes, operation.scene_id);
        next.scenes.splice(index, 1);
        next.localized_narration_tracks =
          next.localized_narration_tracks.filter(
            (track) => track.scene_id !== operation.scene_id,
          );
        if (next.audio_tracks) {
          next.audio_tracks = next.audio_tracks.map((track) => ({
            ...track,
            clips: track.clips.filter(
              (clip) => clip.scene_id !== operation.scene_id,
            ),
          }));
        }
        break;
      }
      case "reorder_scenes": {
        requireTrack("visual");
        if (
          selectedSceneIds.size > 0 &&
          selectedSceneIds.size !== next.scenes.length
        ) {
          throw new Error("whole_production_selection_required");
        }
        if (
          new Set(operation.scene_ids).size !== next.scenes.length ||
          operation.scene_ids.some(
            (sceneId) => !next.scenes.some((scene) => scene.id === sceneId),
          )
        ) {
          throw new Error("reorder_scene_set_mismatch");
        }
        next.scenes = operation.scene_ids.map((sceneId) => {
          const scene = next.scenes[requireScene(next.scenes, sceneId)];
          if (!scene) throw new Error(`scene_not_found:${sceneId}`);
          return scene;
        });
        break;
      }
      case "upsert_localized_track": {
        requireTrack("voice");
        requireSelectedScene(selectedSceneIds, operation.track.scene_id);
        requireScene(next.scenes, operation.track.scene_id);
        const index = next.localized_narration_tracks.findIndex(
          (track) => track.id === operation.track.id,
        );
        if (index === -1) next.localized_narration_tracks.push(operation.track);
        else next.localized_narration_tracks[index] = operation.track;
        break;
      }
      case "remove_localized_track": {
        requireTrack("voice");
        const index = next.localized_narration_tracks.findIndex(
          (track) => track.id === operation.track_id,
        );
        if (index === -1) throw new Error("localized_track_not_found");
        requireSelectedScene(
          selectedSceneIds,
          next.localized_narration_tracks[index]!.scene_id,
        );
        next.localized_narration_tracks.splice(index, 1);
        break;
      }
      case "upsert_audio_track": {
        requireOneTrack("voice", operation.track.id);
        for (const clip of operation.track.clips) {
          requireSelectedScene(selectedSceneIds, clip.scene_id);
          requireScene(next.scenes, clip.scene_id);
        }
        next.audio_tracks ??= effectiveAudioTracks(next);
        const index = next.audio_tracks.findIndex(
          (track) => track.id === operation.track.id,
        );
        if (index === -1) next.audio_tracks.push(operation.track);
        else next.audio_tracks[index] = operation.track;
        break;
      }
      case "remove_audio_track": {
        requireOneTrack("voice", operation.track_id);
        next.audio_tracks ??= effectiveAudioTracks(next);
        const index = next.audio_tracks.findIndex(
          (track) => track.id === operation.track_id,
        );
        if (index === -1) throw new Error("audio_track_not_found");
        for (const clip of next.audio_tracks[index]!.clips) {
          requireSelectedScene(selectedSceneIds, clip.scene_id);
        }
        next.audio_tracks.splice(index, 1);
        break;
      }
    }
  }

  const validated = contentPackageSchema.parse(next);
  if (JSON.stringify(validated) === JSON.stringify(base)) {
    throw new Error("no_op_patch");
  }
  return validated;
};
