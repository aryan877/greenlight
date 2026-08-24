import { z } from "zod";

export const VIDEO_FPS = 30;
export const VIDEO_TRANSITION_FRAMES = 10;
export const VIDEO_TRANSITION_SECONDS = VIDEO_TRANSITION_FRAMES / VIDEO_FPS;
export const MIN_SCENE_DURATION_SECONDS = VIDEO_TRANSITION_SECONDS * 2;

export const sceneStartSeconds = (
  scenes: ReadonlyArray<{ duration_seconds: number }>,
  index: number,
) =>
  scenes
    .slice(0, index)
    .reduce((sum, scene) => sum + scene.duration_seconds, 0) -
  Math.max(0, index) * VIDEO_TRANSITION_SECONDS;

export const productionDurationSeconds = (
  scenes: ReadonlyArray<{ duration_seconds: number }>,
) =>
  scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0) -
  Math.max(0, scenes.length - 1) * VIDEO_TRANSITION_SECONDS;

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

export const sceneSchema = z.object({
  id: idSchema,
  kind: sceneKindSchema,
  title: z.string().trim().min(1).max(90),
  narration: z.string().trim().min(1).max(650),
  narration_artifact_id: idSchema.nullable().default(null),
  captions_artifact_id: idSchema.nullable().default(null),
  transcript_artifact_id: idSchema.nullable().default(null),
  claim_ids: z.array(idSchema),
  duration_seconds: z.number().min(MIN_SCENE_DURATION_SECONDS).max(120),
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
    metadata: youtubeMetadataSchema,
  })
  .superRefine(({ scenes }, context) => {
    const seconds = scenes.reduce(
      (total, scene) => total + scene.duration_seconds,
      0,
    );
    if (seconds < 30 || seconds > 120) {
      context.addIssue({
        code: "custom",
        message: `Scene duration total must be 30–120 seconds; received ${seconds}`,
        path: ["scenes"],
      });
    }
  });

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
  script: z.string().trim().min(1).max(5000),
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
    name: z.literal("openai"),
    transcription_model: z.string().min(1),
    timing_model: z.string().min(1),
  }),
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
      duration_seconds: z
        .number()
        .min(MIN_SCENE_DURATION_SECONDS)
        .max(120)
        .optional(),
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
          operation.duration_seconds !== undefined
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
        if (
          operation.duration_seconds !== undefined &&
          operation.duration_seconds > current.duration_seconds
        ) {
          throw new Error("scene_extension_not_allowed");
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
          ...(operation.playback_rate === undefined
            ? {}
            : { playback_rate: operation.playback_rate }),
          ...(operation.visual === undefined
            ? {}
            : { visual: { ...current.visual, ...operation.visual } }),
        };
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
          operation.first.duration_seconds + operation.second.duration_seconds >
          current.duration_seconds
        ) {
          throw new Error("split_scene_extension_not_allowed");
        }
        next.scenes.splice(index, 1, operation.first, operation.second);
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
    }
  }

  const validated = contentPackageSchema.parse(next);
  if (JSON.stringify(validated) === JSON.stringify(base)) {
    throw new Error("no_op_patch");
  }
  return validated;
};
