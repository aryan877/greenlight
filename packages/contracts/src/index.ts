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
  video_track_id: idSchema.optional(),
  caption_track_id: idSchema.optional(),
  title: z.string().trim().min(1).max(90),
  narration: z.string().trim().min(1).max(650),
  narration_artifact_id: idSchema.nullable().default(null),
  captions_artifact_id: idSchema.nullable().default(null),
  transcript_artifact_id: idSchema.nullable().default(null),
  caption_timeline_start_seconds: frameAlignedSecondsSchema
    .nonnegative()
    .max(120)
    .optional(),
  caption_duration_seconds: frameAlignedSecondsSchema
    .min(1 / VIDEO_FPS)
    .max(120)
    .optional(),
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
    timeline_start_seconds: frameAlignedSecondsSchema
      .nonnegative()
      .max(120)
      .optional(),
    source_in_seconds: z.number().nonnegative().default(0),
    source_out_seconds: z.number().positive().nullable().default(null),
    duration_seconds: frameAlignedSecondsSchema
      .min(1 / VIDEO_FPS)
      .max(120)
      .optional(),
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

export const audioClipDurationSeconds = (
  clip: {
    source_in_seconds: number;
    source_out_seconds: number | null;
    start_offset_seconds: number;
    playback_rate: number;
    duration_seconds?: number;
  },
  scene: { duration_seconds: number },
) =>
  clip.duration_seconds ??
  (clip.source_out_seconds === null
    ? scene.duration_seconds - clip.start_offset_seconds
    : (clip.source_out_seconds - clip.source_in_seconds) / clip.playback_rate);

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

const baseTimelineTrackSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  protected: z.boolean().default(false),
});

export const videoTrackSchema = baseTimelineTrackSchema.extend({
  kind: z.literal("video"),
});

export const captionTimelineTrackSchema = baseTimelineTrackSchema.extend({
  kind: z.literal("caption"),
});

export const youtubeMetadataSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(5000),
  tags: z.array(z.string().trim().min(1).max(80)).max(30),
  category_id: z.string().regex(/^\d+$/).default("28"),
  made_for_kids: z.boolean().default(false),
  contains_synthetic_media: z.boolean().default(true),
});

const releasePlanFieldsSchema = z.object({
  thumbnail_artifact_id: idSchema.nullable().default(null),
  destination: z.enum(["unlisted", "public", "scheduled"]).default("unlisted"),
  publish_at: z.string().datetime().nullable().default(null),
});

export const releasePlanSchema = releasePlanFieldsSchema.superRefine(
  (plan, context) => {
    if (plan.destination === "scheduled" && !plan.publish_at) {
      context.addIssue({
        code: "custom",
        message: "Scheduled release requires a publish time",
        path: ["publish_at"],
      });
    }
  },
);

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
    video_tracks: z.array(videoTrackSchema).optional(),
    caption_tracks: z.array(captionTimelineTrackSchema).optional(),
    track_order: z.array(idSchema).optional(),
    metadata: youtubeMetadataSchema,
    release: releasePlanSchema.default(() => ({
      thumbnail_artifact_id: null,
      destination: "unlisted" as const,
      publish_at: null,
    })),
  })
  .superRefine(
    (
      {
        scenes,
        audio_tracks: audioTracks,
        video_tracks: videoTracks,
        caption_tracks: captionTracks,
        track_order: trackOrder,
      },
      context,
    ) => {
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
      scenes.forEach((scene, index) => {
        const captionStart =
          scene.caption_timeline_start_seconds ??
          sceneStartSeconds(scenes, index);
        const captionDuration =
          scene.caption_duration_seconds ?? scene.duration_seconds;
        if (captionStart + captionDuration > seconds + 1 / VIDEO_FPS) {
          context.addIssue({
            code: "custom",
            message: "Caption clip exceeds the production duration",
            path: ["scenes", index, "caption_duration_seconds"],
          });
        }
      });
      const sceneIds = new Set(scenes.map((scene) => scene.id));
      const videoTrackIds = new Set(
        (videoTracks ?? [{ id: "track_video" }]).map((track) => track.id),
      );
      const captionTrackIds = new Set(
        (captionTracks ?? [{ id: "track_captions" }]).map((track) => track.id),
      );
      scenes.forEach((scene, index) => {
        const videoTrackId = scene.video_track_id ?? "track_video";
        const captionTrackId = scene.caption_track_id ?? "track_captions";
        if (!videoTrackIds.has(videoTrackId)) {
          context.addIssue({
            code: "custom",
            message: `Scene references missing video track ${videoTrackId}`,
            path: ["scenes", index, "video_track_id"],
          });
        }
        if (!captionTrackIds.has(captionTrackId)) {
          context.addIssue({
            code: "custom",
            message: `Scene references missing caption track ${captionTrackId}`,
            path: ["scenes", index, "caption_track_id"],
          });
        }
      });
      const trackIds = new Set<string>();
      const clipIds = new Set<string>();
      for (const [trackKind, tracks] of [
        ["video_tracks", videoTracks ?? [{ id: "track_video" }]],
        ["caption_tracks", captionTracks ?? [{ id: "track_captions" }]],
      ] as const) {
        for (const [trackIndex, track] of tracks.entries()) {
          if (trackIds.has(track.id)) {
            context.addIssue({
              code: "custom",
              message: `Duplicate timeline track ${track.id}`,
              path: [trackKind, trackIndex, "id"],
            });
          }
          trackIds.add(track.id);
        }
      }
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
              path: [
                "audio_tracks",
                trackIndex,
                "clips",
                clipIndex,
                "scene_id",
              ],
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
          const timelineStart =
            clip.timeline_start_seconds ??
            (scene
              ? sceneStartSeconds(
                  scenes,
                  scenes.findIndex((candidate) => candidate.id === scene.id),
                ) + clip.start_offset_seconds
              : 0);
          if (timelineStart >= seconds) {
            context.addIssue({
              code: "custom",
              message: "Audio clip starts outside the production",
              path: [
                "audio_tracks",
                trackIndex,
                "clips",
                clipIndex,
                "timeline_start_seconds",
              ],
            });
          }
          if (scene) {
            const clipDuration = audioClipDurationSeconds(clip, scene);
            const availableDuration =
              clip.source_out_seconds === null
                ? scene.duration_seconds - clip.start_offset_seconds
                : (clip.source_out_seconds - clip.source_in_seconds) /
                  clip.playback_rate;
            if (clipDuration > availableDuration + 1 / VIDEO_FPS) {
              context.addIssue({
                code: "custom",
                message: "Audio clip duration exceeds its source range",
                path: [
                  "audio_tracks",
                  trackIndex,
                  "clips",
                  clipIndex,
                  "duration_seconds",
                ],
              });
            }
            if (timelineStart + clipDuration > seconds + 1 / VIDEO_FPS) {
              context.addIssue({
                code: "custom",
                message: "Audio clip exceeds the production duration",
                path: [
                  "audio_tracks",
                  trackIndex,
                  "clips",
                  clipIndex,
                  "source_out_seconds",
                ],
              });
            }
          }
        }
      }
      if (!audioTracks) {
        if (trackIds.has("track_narration")) {
          context.addIssue({
            code: "custom",
            message: "Duplicate timeline track track_narration",
            path: ["audio_tracks"],
          });
        }
        trackIds.add("track_narration");
      }
      const effectiveAudioIds = audioTracks?.map((track) => track.id) ?? [
        "track_narration",
      ];
      const allTrackIds = [
        ...(videoTracks?.map((track) => track.id) ?? ["track_video"]),
        ...effectiveAudioIds,
        ...(captionTracks?.map((track) => track.id) ?? ["track_captions"]),
      ];
      if (
        trackOrder &&
        (trackOrder.length !== allTrackIds.length ||
          new Set(trackOrder).size !== allTrackIds.length ||
          trackOrder.some((trackId) => !allTrackIds.includes(trackId)))
      ) {
        context.addIssue({
          code: "custom",
          message: "Track order must contain every timeline track exactly once",
          path: ["track_order"],
        });
      }
    },
  );

export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type VideoTrack = z.infer<typeof videoTrackSchema>;
export type CaptionTimelineTrack = z.infer<typeof captionTimelineTrackSchema>;

export const effectiveVideoTracks = (content: ContentPackage): VideoTrack[] =>
  content.video_tracks ?? [
    { id: "track_video", name: "Video", kind: "video", protected: true },
  ];

export const effectiveCaptionTracks = (
  content: ContentPackage,
): CaptionTimelineTrack[] =>
  content.caption_tracks ?? [
    {
      id: "track_captions",
      name: "Captions",
      kind: "caption",
      protected: true,
    },
  ];

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
  id: "track_narration",
  name: "Narration",
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

export const editorTimelineItemKindSchema = z.enum([
  "video",
  "audio",
  "caption",
]);

const timelineItemIdPrefix = (
  kind: z.infer<typeof editorTimelineItemKindSchema>,
) => `${kind}_`;

const timelineItemId = (
  kind: z.infer<typeof editorTimelineItemKindSchema>,
  stableId: string,
) => `${timelineItemIdPrefix(kind)}${stableId.slice(-(79 - kind.length))}`;

export const videoTimelineItemId = (sceneId: string) =>
  timelineItemId(editorTimelineItemKindSchema.enum.video, sceneId);

export const audioTimelineItemId = (clipId: string) =>
  timelineItemId(editorTimelineItemKindSchema.enum.audio, clipId);

export const captionTimelineItemId = (sceneId: string) =>
  timelineItemId(editorTimelineItemKindSchema.enum.caption, sceneId);

export const editorTimelineTrackSchema = z.object({
  id: editorTrackIdSchema,
  kind: editorTimelineItemKindSchema,
  name: z.string().trim().min(1).max(80),
  protected: z.boolean(),
  role: audioTrackRoleSchema.nullable().default(null),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  export_enabled: z.boolean().default(true),
  gain: z.number().min(0).max(2).default(1),
});

export const editorTimelineItemSchema = z
  .object({
    id: idSchema,
    kind: editorTimelineItemKindSchema,
    track_id: editorTrackIdSchema,
    scene_id: idSchema,
    label: z.string().trim().min(1).max(160),
    start_seconds: frameAlignedSecondsSchema.nonnegative(),
    end_seconds: frameAlignedSecondsSchema.positive(),
    artifact_ids: z.array(idSchema).default([]),
  })
  .superRefine((item, context) => {
    if (!item.id.startsWith(timelineItemIdPrefix(item.kind))) {
      context.addIssue({
        code: "custom",
        message: "Timeline item ID must match its kind",
        path: ["id"],
      });
    }
    if (item.end_seconds <= item.start_seconds) {
      context.addIssue({
        code: "custom",
        message: "Timeline item end must be after start",
        path: ["end_seconds"],
      });
    }
  });

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
    item_ids: z.array(idSchema).default([]),
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
  tracks: z.array(editorTimelineTrackSchema),
  items: z.array(editorTimelineItemSchema),
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
      video_track_id: idSchema.optional(),
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
  z
    .object({
      type: z.literal("update_audio_clip"),
      item_id: idSchema,
      clip_id: audioClipIdSchema,
      target_track_id: idSchema.optional(),
      timeline_start_seconds: frameAlignedSecondsSchema
        .nonnegative()
        .max(120)
        .optional(),
      source_in_seconds: z.number().nonnegative().optional(),
      source_out_seconds: z.number().positive().nullable().optional(),
      duration_seconds: frameAlignedSecondsSchema
        .min(1 / VIDEO_FPS)
        .max(120)
        .optional(),
      playback_rate: z.number().min(0.5).max(3).optional(),
    })
    .refine(
      ({ type: _type, item_id: _itemId, clip_id: _clipId, ...patch }) =>
        Object.values(patch).some((value) => value !== undefined),
      { message: "Audio clip patch must change at least one field" },
    ),
  z.object({
    type: z.literal("upsert_video_track"),
    track: videoTrackSchema,
  }),
  z.object({
    type: z.literal("remove_video_track"),
    track_id: idSchema,
  }),
  z.object({
    type: z.literal("upsert_caption_track"),
    track: captionTimelineTrackSchema,
  }),
  z.object({
    type: z.literal("remove_caption_track"),
    track_id: idSchema,
  }),
  z
    .object({
      type: z.literal("update_caption_clip"),
      item_id: idSchema,
      scene_id: idSchema,
      target_track_id: idSchema.optional(),
      timeline_start_seconds: frameAlignedSecondsSchema
        .nonnegative()
        .max(120)
        .optional(),
      duration_seconds: frameAlignedSecondsSchema
        .min(1 / VIDEO_FPS)
        .max(120)
        .optional(),
    })
    .refine(
      ({ type: _type, item_id: _itemId, scene_id: _sceneId, ...patch }) =>
        Object.values(patch).some((value) => value !== undefined),
      { message: "Caption clip patch must change at least one field" },
    ),
  z.object({
    type: z.literal("reorder_tracks"),
    track_ids: z.array(idSchema).min(3),
  }),
  z
    .object({
      type: z.literal("update_release"),
      metadata: youtubeMetadataSchema.partial().optional(),
      release: releasePlanFieldsSchema.partial().optional(),
    })
    .refine(
      ({ type: _type, ...patch }) =>
        Object.values(patch).some((value) => value !== undefined),
      { message: "Release patch must change at least one field" },
    ),
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
export type ReleasePlan = z.infer<typeof releasePlanSchema>;
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
export type CorrectTranscriptInput = z.infer<
  typeof correctTranscriptInputSchema
>;
export type RenderVideoInput = z.infer<typeof renderVideoInputSchema>;
export type GetArtifactInput = z.infer<typeof getArtifactInputSchema>;
export type QualityCheckInput = z.infer<typeof qualityCheckInputSchema>;
export type StageVideoInput = z.infer<typeof stageVideoInputSchema>;
export type EditorSelection = z.infer<typeof editorSelectionSchema>;
export type EditorTimelineItemKind = z.infer<
  typeof editorTimelineItemKindSchema
>;
export type EditorTimelineItem = z.infer<typeof editorTimelineItemSchema>;
export type EditorTimelineTrack = z.infer<typeof editorTimelineTrackSchema>;
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
          operation.video_track_id !== undefined ||
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
        if (
          operation.video_track_id !== undefined &&
          !effectiveVideoTracks(next).some(
            (track) => track.id === operation.video_track_id,
          )
        ) {
          throw new Error("video_track_not_found");
        }
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
          ...(operation.video_track_id === undefined
            ? {}
            : { video_track_id: operation.video_track_id }),
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
        const narrationTrack = next.audio_tracks?.find(
          (track) => track.role === "narration",
        );
        const narrationClipIndex = narrationTrack?.clips.findIndex(
          (clip) => clip.scene_id === operation.scene_id,
        );
        if (
          narrationTrack &&
          narrationClipIndex !== undefined &&
          narrationClipIndex >= 0
        ) {
          const currentClip = narrationTrack.clips[narrationClipIndex]!;
          narrationTrack.clips[narrationClipIndex] = {
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
        if (index === -1) {
          next.audio_tracks.push(operation.track);
          if (next.track_order) next.track_order.push(operation.track.id);
        } else next.audio_tracks[index] = operation.track;
        break;
      }
      case "remove_audio_track": {
        requireOneTrack("voice", operation.track_id);
        next.audio_tracks ??= effectiveAudioTracks(next);
        const index = next.audio_tracks.findIndex(
          (track) => track.id === operation.track_id,
        );
        if (index === -1) throw new Error("audio_track_not_found");
        const firstNarrationIndex = next.audio_tracks.findIndex(
          (track) => track.role === "narration",
        );
        if (
          next.audio_tracks[index]!.id === "track_narration" ||
          (next.audio_tracks[index]!.role === "narration" &&
            index === firstNarrationIndex)
        ) {
          throw new Error("protected_track");
        }
        for (const clip of next.audio_tracks[index]!.clips) {
          requireSelectedScene(selectedSceneIds, clip.scene_id);
        }
        next.audio_tracks.splice(index, 1);
        next.track_order = next.track_order?.filter(
          (trackId) => trackId !== operation.track_id,
        );
        break;
      }
      case "update_audio_clip": {
        if (!selection.item_ids.includes(operation.item_id)) {
          throw new Error(`item_outside_selection:${operation.item_id}`);
        }
        if (operation.item_id !== audioTimelineItemId(operation.clip_id)) {
          throw new Error("audio_item_clip_mismatch");
        }
        next.audio_tracks ??= effectiveAudioTracks(next);
        const sourceTrack = next.audio_tracks.find((track) =>
          track.clips.some((clip) => clip.id === operation.clip_id),
        );
        const targetTrack = operation.target_track_id
          ? next.audio_tracks.find(
              (track) => track.id === operation.target_track_id,
            )
          : sourceTrack;
        if (!sourceTrack) throw new Error("audio_clip_not_found");
        if (!targetTrack) throw new Error("audio_track_not_found");
        requireOneTrack("voice", sourceTrack.id);
        const clipIndex = sourceTrack.clips.findIndex(
          (clip) => clip.id === operation.clip_id,
        );
        const [clip] = sourceTrack.clips.splice(clipIndex, 1);
        if (!clip) throw new Error("audio_clip_not_found");
        targetTrack.clips.push({
          ...clip,
          ...(operation.timeline_start_seconds === undefined
            ? {}
            : { timeline_start_seconds: operation.timeline_start_seconds }),
          ...(operation.source_in_seconds === undefined
            ? {}
            : { source_in_seconds: operation.source_in_seconds }),
          ...(operation.source_out_seconds === undefined
            ? {}
            : { source_out_seconds: operation.source_out_seconds }),
          ...(operation.duration_seconds === undefined
            ? {}
            : { duration_seconds: operation.duration_seconds }),
          ...(operation.playback_rate === undefined
            ? {}
            : { playback_rate: operation.playback_rate }),
        });
        break;
      }
      case "upsert_video_track": {
        requireOneTrack("visual", operation.track.id);
        next.video_tracks ??= effectiveVideoTracks(next);
        const index = next.video_tracks.findIndex(
          (track) => track.id === operation.track.id,
        );
        if (index === -1) {
          next.video_tracks.push(operation.track);
          if (next.track_order) next.track_order.push(operation.track.id);
        } else next.video_tracks[index] = operation.track;
        break;
      }
      case "remove_video_track": {
        requireOneTrack("visual", operation.track_id);
        next.video_tracks ??= effectiveVideoTracks(next);
        const index = next.video_tracks.findIndex(
          (track) => track.id === operation.track_id,
        );
        if (index === -1) throw new Error("video_track_not_found");
        if (next.video_tracks[index]!.protected) {
          throw new Error("protected_track");
        }
        if (
          next.scenes.some(
            (scene) =>
              (scene.video_track_id ?? "track_video") === operation.track_id,
          )
        ) {
          throw new Error("track_not_empty");
        }
        next.video_tracks.splice(index, 1);
        next.track_order = next.track_order?.filter(
          (trackId) => trackId !== operation.track_id,
        );
        break;
      }
      case "upsert_caption_track": {
        requireOneTrack("caption", operation.track.id);
        next.caption_tracks ??= effectiveCaptionTracks(next);
        const index = next.caption_tracks.findIndex(
          (track) => track.id === operation.track.id,
        );
        if (index === -1) {
          next.caption_tracks.push(operation.track);
          if (next.track_order) next.track_order.push(operation.track.id);
        } else next.caption_tracks[index] = operation.track;
        break;
      }
      case "remove_caption_track": {
        requireOneTrack("caption", operation.track_id);
        next.caption_tracks ??= effectiveCaptionTracks(next);
        const index = next.caption_tracks.findIndex(
          (track) => track.id === operation.track_id,
        );
        if (index === -1) throw new Error("caption_track_not_found");
        if (next.caption_tracks[index]!.protected) {
          throw new Error("protected_track");
        }
        if (
          next.scenes.some(
            (scene) =>
              (scene.caption_track_id ?? "track_captions") ===
              operation.track_id,
          )
        ) {
          throw new Error("track_not_empty");
        }
        next.caption_tracks.splice(index, 1);
        next.track_order = next.track_order?.filter(
          (trackId) => trackId !== operation.track_id,
        );
        break;
      }
      case "update_caption_clip": {
        if (!selection.item_ids.includes(operation.item_id)) {
          throw new Error(`item_outside_selection:${operation.item_id}`);
        }
        if (operation.item_id !== captionTimelineItemId(operation.scene_id)) {
          throw new Error("caption_item_scene_mismatch");
        }
        requireSelectedScene(selectedSceneIds, operation.scene_id);
        requireOneTrack(
          "caption",
          operation.target_track_id ?? "track_captions",
        );
        const sceneIndex = requireScene(next.scenes, operation.scene_id);
        if (
          operation.target_track_id !== undefined &&
          !effectiveCaptionTracks(next).some(
            (track) => track.id === operation.target_track_id,
          )
        ) {
          throw new Error("caption_track_not_found");
        }
        const current = next.scenes[sceneIndex]!;
        next.scenes[sceneIndex] = {
          ...current,
          ...(operation.target_track_id === undefined
            ? {}
            : { caption_track_id: operation.target_track_id }),
          ...(operation.timeline_start_seconds === undefined
            ? {}
            : {
                caption_timeline_start_seconds:
                  operation.timeline_start_seconds,
              }),
          ...(operation.duration_seconds === undefined
            ? {}
            : { caption_duration_seconds: operation.duration_seconds }),
        };
        break;
      }
      case "reorder_tracks": {
        const currentTrackIds = [
          ...effectiveVideoTracks(next).map((track) => track.id),
          ...effectiveAudioTracks(next).map((track) => track.id),
          ...effectiveCaptionTracks(next).map((track) => track.id),
        ];
        if (
          operation.track_ids.length !== currentTrackIds.length ||
          new Set(operation.track_ids).size !== currentTrackIds.length ||
          operation.track_ids.some(
            (trackId) => !currentTrackIds.includes(trackId),
          )
        ) {
          throw new Error("reorder_track_set_mismatch");
        }
        for (const trackId of operation.track_ids) requireTrack(trackId);
        next.track_order = operation.track_ids;
        break;
      }
      case "update_release": {
        requireTrack("release");
        if (operation.metadata) {
          next.metadata = { ...next.metadata, ...operation.metadata };
        }
        if (operation.release) {
          next.release = { ...next.release, ...operation.release };
        }
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
