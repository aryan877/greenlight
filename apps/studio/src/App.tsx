import {
  applyEditorPatch,
  editorPatchInputSchema,
  effectiveAudioTracks,
  effectiveCaptionTracks,
  effectiveTransitionTracks,
  effectiveVideoTracks,
  soundEffectPresetRegistry,
  transitionPresetRegistry,
  VIDEO_FPS,
  type Artifact,
  type ContentPackage,
  type EditorPatchInput,
  type EditorPatchOperation,
  type EditorFocusInput,
  type EditorSelection,
  type SoundEffectPresetId,
  type TransitionPresetId,
  type TransitionTimelineClip,
} from "@greenlight/contracts";
import {
  LockKeyhole,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useProducerAgent } from "./api/trueforge.js";
import { greenlightApi } from "./api/greenlight.js";
import {
  useContentPackage,
  useApplyEditorPatch,
  useCreateProject,
  useImageGenerationCapabilities,
  useProject,
  useProjects,
  useRestoreContentRevision,
  useUploadAsset,
  useYouTubeConnection,
} from "./api/queries.js";
import {
  GeminiIcon,
  GreenlightMark,
  RemotionIcon,
  TrueForgeIcon,
  YouTubeIcon,
} from "./brand-icons.js";
import { IconButton, ResizeHandle, cx } from "./components/controls.js";
import { CodexConnectionStatus } from "./components/CodexConnectionStatus.js";
import { InspectorPanel } from "./components/InspectorPanel.js";
import {
  ProducerPanel,
  type ProducerReference,
} from "./components/ProducerPanel.js";
import { ProgramMonitor } from "./components/ProgramMonitor.js";
import { ProjectSwitcher } from "./components/ProjectSwitcher.js";
import { MediaBrowser } from "./components/MediaBrowser.js";
import type { PlacedLibraryAsset } from "./components/MediaLibraryDialog.js";
import { ReleasePanel } from "./components/ReleasePanel.js";
import { Timeline } from "./components/Timeline.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import {
  artifactDurationSeconds,
  audioItemId,
  changeSceneSpeed,
  createSelection,
  createTimelineContext,
  fitSourceDurationToFrames,
  timelineGaps,
  timelineItems,
  timelineTracks,
  transitionItemId,
  videoItemId,
  sceneAtTimelineTime,
  sceneOffset,
  splitSceneAtPlayhead,
  snapToFrame,
  trackOperationSceneIds,
  totalDuration,
} from "./editor/model.js";
import { buildTransitionTrackEdit } from "./editor/effects.js";
import {
  BROLL_TRACK_ID,
  buildBrollPlacementOperation,
  buildTimelineDeletePlan,
} from "./editor/operations.js";
import type { ProducerDraftIntent } from "./editor/producer-draft.js";
import {
  appendProducerReferences,
  removeProducerReference,
  type ProducerReferenceId,
} from "./editor/producer-references.js";
import { useMediaController } from "./editor/use-media-controller.js";
import { timelineAudioSources } from "./editor/timeline-audio.js";
import { useWorkspaceLayout } from "./editor/use-workspace-layout.js";

type DirectRevision = {
  artifactId: string;
  content: ContentPackage;
};

type HistoryEntry = {
  beforeArtifactId: string;
  beforeContent: ContentPackage;
  afterArtifactId: string;
  afterContent: ContentPackage;
  summary: string;
};

const emptyProducerReferences = (): ProducerReferenceId[] => [];

export const App = () => {
  const projects = useProjects();
  const createProject = useCreateProject();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [selectedGapIds, setSelectedGapIds] = useState<string[]>([]);
  const [directRevision, setDirectRevision] = useState<DirectRevision | null>(
    null,
  );
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const lastDirectArtifactId = useRef<string | null>(null);
  const previousContentArtifactId = useRef<string | null>(null);
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });
  const [rightTab, setRightTab] = useState<"producer" | "details" | "release">(
    "producer",
  );
  const [attachedArtifactIds, setAttachedArtifactIds] = useState<string[]>([]);
  const [producerReferences, setProducerReferences] = useState<
    ProducerReferenceId[]
  >(emptyProducerReferences);
  const [importError, setImportError] = useState<string | null>(null);
  const [draftIntent, setDraftIntent] = useState<ProducerDraftIntent | null>(
    null,
  );
  const [previewTransitionPreset, setPreviewTransitionPreset] =
    useState<TransitionPresetId | null>(null);
  const layout = useWorkspaceLayout();
  const media = useMediaController();

  useEffect(() => {
    if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id);
  }, [projectId, projects.data]);

  const project = useProject(projectId);
  const youtubeConnection = useYouTubeConnection();
  const imageGeneration = useImageGenerationCapabilities();
  const uploadAsset = useUploadAsset(projectId);
  const applyDirectPatch = useApplyEditorPatch(projectId);
  const restoreRevision = useRestoreContentRevision(projectId);
  const contentArtifact =
    project.data?.artifacts.find(
      (artifact) =>
        artifact.id ===
        project.data?.project.current_content_package_artifact_id,
    ) ??
    project.data?.artifacts
      .filter((artifact) => artifact.kind === "content_package")
      .at(-1) ??
    null;
  const evidenceArtifact =
    project.data?.artifacts
      .filter((artifact) => artifact.kind === "evidence_ledger")
      .at(-1) ?? null;
  const videoArtifact =
    project.data?.artifacts
      .filter(
        (artifact) =>
          artifact.kind === "video" &&
          artifact.provenance.content_package_artifact_id ===
            contentArtifact?.id,
      )
      .at(-1) ?? null;
  const thumbnailArtifact =
    project.data?.artifacts
      .filter(
        (artifact) =>
          artifact.kind === "thumbnail" &&
          artifact.provenance.content_package_artifact_id ===
            videoArtifact?.provenance.content_package_artifact_id,
      )
      .at(-1) ?? null;
  const content = useContentPackage(contentArtifact?.id ?? null);
  const editorArtifactId =
    directRevision?.artifactId ?? contentArtifact?.id ?? null;
  const editorContent =
    directRevision?.content ?? content.data?.content ?? null;
  const editorItems = useMemo(
    () => (editorContent ? timelineItems(editorContent) : []),
    [editorContent],
  );
  const editorTracks = useMemo(
    () => (editorContent ? timelineTracks(editorContent) : []),
    [editorContent],
  );
  const editorGaps = useMemo(
    () => (editorContent ? timelineGaps(editorContent) : []),
    [editorContent],
  );
  const liveSelectedItemIds = useMemo(
    () =>
      selectedItemIds.filter((itemId) =>
        editorItems.some((item) => item.id === itemId),
      ),
    [editorItems, selectedItemIds],
  );
  const liveSelectedTrackIds = useMemo(
    () =>
      selectedTrackIds.filter((trackId) =>
        editorTracks.some((track) => track.id === trackId),
      ),
    [editorTracks, selectedTrackIds],
  );
  const liveSelectedGapIds = useMemo(
    () =>
      selectedGapIds.filter((gapId) =>
        editorGaps.some((gap) => gap.id === gapId),
      ),
    [editorGaps, selectedGapIds],
  );
  const selectedTransitionPreset = useMemo(() => {
    if (!editorContent) return null;
    const selectedId = liveSelectedItemIds.at(-1);
    if (!selectedId) return null;
    return (
      effectiveTransitionTracks(editorContent)
        .flatMap((track) => track.clips)
        .find((clip) => transitionItemId(clip.id) === selectedId)?.preset_id ??
      null
    );
  }, [editorContent, liveSelectedItemIds]);
  const resolvedProducerReferences = useMemo(
    () =>
      producerReferences.flatMap<ProducerReference>((reference) => {
        if (reference.type === "item") {
          const item = editorItems.find(
            (candidate) => candidate.id === reference.id,
          );
          return item ? [{ type: "item", value: item }] : [];
        }
        if (reference.type === "gap") {
          const gap = editorGaps.find(
            (candidate) => candidate.id === reference.id,
          );
          return gap ? [{ type: "gap", value: gap }] : [];
        }
        const track = editorTracks.find(
          (candidate) => candidate.id === reference.id,
        );
        return track ? [{ type: "track", value: track }] : [];
      }),
    [editorGaps, editorItems, editorTracks, producerReferences],
  );
  const liveSelection = useMemo<ProducerReference[]>(
    () => [
      ...editorItems
        .filter((item) => selectedItemIds.includes(item.id))
        .map((item) => ({ type: "item" as const, value: item })),
      ...editorTracks
        .filter((track) => selectedTrackIds.includes(track.id))
        .map((track) => ({ type: "track" as const, value: track })),
      ...editorGaps
        .filter((gap) => selectedGapIds.includes(gap.id))
        .map((gap) => ({ type: "gap" as const, value: gap })),
    ],
    [
      editorGaps,
      editorItems,
      editorTracks,
      selectedGapIds,
      selectedItemIds,
      selectedTrackIds,
    ],
  );
  const producerReferencedItems = resolvedProducerReferences.flatMap(
    (reference) => (reference.type === "item" ? [reference.value] : []),
  );
  const producerReferencedTracks = resolvedProducerReferences.flatMap(
    (reference) => (reference.type === "track" ? [reference.value] : []),
  );
  const producerReferencedGaps = resolvedProducerReferences.flatMap(
    (reference) => (reference.type === "gap" ? [reference.value] : []),
  );
  const selectedSceneIds = useMemo(
    () => [
      ...new Set([
        ...editorItems
          .filter((item) => selectedItemIds.includes(item.id))
          .map((item) => item.scene_id),
        ...editorGaps
          .filter((gap) => selectedGapIds.includes(gap.id))
          .map((gap) => gap.after_scene_id),
      ]),
    ],
    [editorGaps, editorItems, selectedGapIds, selectedItemIds],
  );
  const releaseThumbnailArtifact =
    project.data?.artifacts.find(
      (artifact) =>
        artifact.id === editorContent?.release.thumbnail_artifact_id,
    ) ?? thumbnailArtifact;

  const updateHistorySize = useCallback(() => {
    setHistorySize({
      undo: undoStack.current.length,
      redo: redoStack.current.length,
    });
  }, []);

  useEffect(() => {
    const nextId = contentArtifact?.id ?? null;
    const previousId = previousContentArtifactId.current;
    const changed = nextId !== previousId;
    const externalChange =
      Boolean(nextId && previousId && changed) &&
      nextId !== lastDirectArtifactId.current;

    if (changed) previousContentArtifactId.current = nextId;
    if (externalChange) {
      undoStack.current = [];
      redoStack.current = [];
      updateHistorySize();
    }

    // A direct edit is already an authoritative, server-confirmed revision. Keep
    // displaying it while the project and artifact queries catch up. Only hand
    // display ownership back to a revision created outside this editor after
    // that exact artifact has hydrated.
    if (
      directRevision &&
      nextId &&
      nextId !== lastDirectArtifactId.current &&
      content.data?.artifactId === nextId
    ) {
      setDirectRevision(null);
    }
  }, [
    content.data,
    contentArtifact?.id,
    directRevision?.artifactId,
    updateHistorySize,
  ]);

  useEffect(() => {
    if (
      selectedItemIds.some(
        (itemId) => !editorItems.some((item) => item.id === itemId),
      )
    ) {
      setSelectedItemIds((current) =>
        current.filter((itemId) =>
          editorItems.some((item) => item.id === itemId),
        ),
      );
    }
  }, [editorItems, selectedItemIds]);

  useEffect(() => {
    if (
      selectedGapIds.some(
        (gapId) => !editorGaps.some((gap) => gap.id === gapId),
      )
    ) {
      setSelectedGapIds((current) =>
        current.filter((gapId) => editorGaps.some((gap) => gap.id === gapId)),
      );
    }
  }, [editorGaps, selectedGapIds]);

  useEffect(() => {
    if (liveSelectedTrackIds.length !== selectedTrackIds.length) {
      setSelectedTrackIds(liveSelectedTrackIds);
    }
  }, [liveSelectedTrackIds, selectedTrackIds.length]);

  const selectedScene =
    editorContent?.scenes.find(
      (scene) =>
        scene.id ===
        editorItems.find((item) => item.id === liveSelectedItemIds.at(-1))
          ?.scene_id,
    ) ?? null;

  const selection = useMemo<EditorSelection | null>(() => {
    if (
      !projectId ||
      !editorArtifactId ||
      !editorContent ||
      (liveSelectedItemIds.length === 0 &&
        liveSelectedTrackIds.length === 0 &&
        liveSelectedGapIds.length === 0)
    ) {
      return null;
    }
    return createSelection({
      projectId,
      contentArtifactId: editorArtifactId,
      content: editorContent,
      itemIds: liveSelectedItemIds,
      trackIds: liveSelectedTrackIds,
      gapIds: liveSelectedGapIds,
      playheadSeconds: media.currentTime,
      sourceLedgerArtifact: evidenceArtifact,
      extraArtifactIds: attachedArtifactIds,
    });
  }, [
    editorContent,
    editorArtifactId,
    evidenceArtifact,
    projectId,
    liveSelectedItemIds,
    liveSelectedTrackIds,
    liveSelectedGapIds,
    attachedArtifactIds,
    media.currentTime,
  ]);

  const timelineContext = useMemo(() => {
    if (!projectId || !editorArtifactId || !editorContent) return null;
    return createTimelineContext({
      projectId,
      contentArtifactId: editorArtifactId,
      content: editorContent,
      playheadSeconds: media.currentTime,
    });
  }, [editorArtifactId, editorContent, media.currentTime, projectId]);

  const producerReferenceSelection = useMemo<EditorSelection | null>(() => {
    if (
      !projectId ||
      !editorArtifactId ||
      !editorContent ||
      (producerReferencedItems.length === 0 &&
        producerReferencedTracks.length === 0 &&
        producerReferencedGaps.length === 0 &&
        attachedArtifactIds.length === 0)
    ) {
      return null;
    }
    return createSelection({
      projectId,
      contentArtifactId: editorArtifactId,
      content: editorContent,
      itemIds: producerReferencedItems.map((item) => item.id),
      trackIds: producerReferencedTracks.map((track) => track.id),
      gapIds: producerReferencedGaps.map((gap) => gap.id),
      playheadSeconds: media.currentTime,
      sourceLedgerArtifact: evidenceArtifact,
      extraArtifactIds: attachedArtifactIds,
    });
  }, [
    attachedArtifactIds,
    editorArtifactId,
    editorContent,
    evidenceArtifact,
    media.currentTime,
    producerReferencedItems,
    producerReferencedGaps,
    producerReferencedTracks,
    projectId,
  ]);

  useEffect(() => {
    setAttachedArtifactIds([]);
    setProducerReferences(emptyProducerReferences());
    setImportError(null);
  }, [projectId]);

  const focusFromAgent = useCallback(
    (focus: EditorFocusInput) => {
      if (
        focus.selection.project_id === projectId &&
        focus.selection.track_ids.includes("release")
      ) {
        setRightTab("release");
        layout.setRightOpen(true);
        return;
      }
      if (
        focus.selection.project_id !== projectId ||
        !editorContent ||
        (!focus.selection.item_ids[0] &&
          !focus.selection.scene_ids[0] &&
          !focus.selection.track_ids[0] &&
          !focus.selection.gap_ids[0])
      ) {
        return;
      }
      const validSceneIds = focus.selection.scene_ids.filter((sceneId) =>
        editorContent.scenes.some((scene) => scene.id === sceneId),
      );
      const validGapIds = focus.selection.gap_ids.filter((gapId) =>
        editorGaps.some((gap) => gap.id === gapId),
      );
      const validTrackIds = focus.selection.track_ids.filter((trackId) =>
        editorTracks.some((track) => track.id === trackId),
      );
      const validItemIds =
        focus.selection.item_ids.length > 0
          ? focus.selection.item_ids.filter((itemId) =>
              editorItems.some((item) => item.id === itemId),
            )
          : validGapIds.length === 0
            ? editorItems
                .filter((item) => validSceneIds.includes(item.scene_id))
                .map((item) => item.id)
            : [];
      if (
        validItemIds.length === 0 &&
        validTrackIds.length === 0 &&
        validGapIds.length === 0
      ) {
        return;
      }
      setSelectedItemIds(validItemIds);
      setSelectedTrackIds(validTrackIds);
      setSelectedGapIds(validGapIds);
      setRightTab("producer");
      layout.setRightOpen(true);
      const firstGap = editorGaps.find((gap) => validGapIds.includes(gap.id));
      const firstSceneIndex = editorContent.scenes.findIndex((scene) =>
        validSceneIds.includes(scene.id),
      );
      const nextTime =
        focus.selection.playhead_seconds ??
        firstGap?.start_seconds ??
        (firstSceneIndex >= 0
          ? sceneOffset(editorContent.scenes, firstSceneIndex)
          : media.currentTime);
      media.seek(nextTime);
    },
    [
      editorContent,
      editorGaps,
      editorItems,
      editorTracks,
      layout,
      media,
      projectId,
    ],
  );

  const producer = useProducerAgent(projectId, focusFromAgent);

  const agentPreviewPatch = useMemo(() => {
    const pending = producer.pendingApprovals.find(
      (approval) => approval.toolName === "apply_editor_patch",
    );
    if (!pending) return null;
    const parsed = editorPatchInputSchema.safeParse(pending.arguments);
    return parsed.success ? parsed.data : null;
  }, [producer.pendingApprovals]);
  const previewPatch = agentPreviewPatch;

  const transitionFromPatch = useCallback(
    (patch: EditorPatchInput | null): TransitionTimelineClip | null => {
      const operation = patch?.operations.find(
        (candidate) => candidate.type === "upsert_transition_track",
      );
      if (!patch || operation?.type !== "upsert_transition_track") return null;
      return (
        operation.track.clips.find(
          (clip) =>
            clip.from_item_id === patch.selection.item_ids[0] &&
            clip.to_item_id === patch.selection.item_ids[1],
        ) ?? null
      );
    },
    [],
  );
  useEffect(() => {
    setSelectedGapIds([]);
    setSelectedTrackIds([]);
    undoStack.current = [];
    redoStack.current = [];
    setHistorySize({ undo: 0, redo: 0 });
    setDirectRevision(null);
    setPreviewTransitionPreset(null);
    lastDirectArtifactId.current = null;
  }, [projectId]);

  const previewContent = useMemo(() => {
    if (!editorContent || !previewPatch) return null;
    if (
      previewPatch.selection.base_content_package_artifact_id !==
      editorArtifactId
    ) {
      return null;
    }
    try {
      return applyEditorPatch(editorContent, previewPatch);
    } catch {
      return null;
    }
  }, [editorArtifactId, editorContent, previewPatch]);

  const previewSceneIds = useMemo(
    () =>
      previewPatch
        ? [
            ...new Set(
              previewPatch.operations.flatMap((operation) => {
                if (operation.type === "split_scene") {
                  return [operation.scene_id, operation.second.id];
                }
                if (operation.type === "reorder_scenes") {
                  return operation.scene_ids;
                }
                if ("scene_id" in operation) return [operation.scene_id];
                if (operation.type === "upsert_localized_track") {
                  return [operation.track.scene_id];
                }
                if (operation.type === "upsert_audio_track") {
                  return operation.track.clips.map((clip) => clip.scene_id);
                }
                return [];
              }),
            ),
          ]
        : [],
    [previewPatch],
  );

  const visibleContent = previewContent ?? editorContent;
  const programDuration = visibleContent ? totalDuration(visibleContent) : 0;
  const previewUsesCanvas =
    Boolean(previewPatch) ||
    videoArtifact?.provenance.content_package_artifact_id !== editorArtifactId;
  const programAudioSources = useMemo(
    () =>
      visibleContent
        ? timelineAudioSources(visibleContent).map((source) => ({
            ...source,
            url: greenlightApi.artifactUrl(source.artifactId),
          }))
        : [],
    [visibleContent],
  );

  useEffect(() => {
    media.setTimelineAudioSources(programAudioSources);
  }, [media.setTimelineAudioSources, programAudioSources]);
  const visibleScene = useMemo(() => {
    if (!visibleContent) return selectedScene;
    return sceneAtTimelineTime(visibleContent, media.currentTime);
  }, [media.currentTime, selectedScene, visibleContent]);
  const activeCaption = useMemo(() => {
    if (!visibleContent) return null;
    return (
      effectiveCaptionTracks(visibleContent)
        .filter((track) => track.visible)
        .flatMap((track) => track.clips)
        .find(
          (clip) =>
            media.currentTime >= clip.timeline_start_seconds &&
            media.currentTime <
              clip.timeline_start_seconds + clip.duration_seconds,
        ) ?? null
    );
  }, [media.currentTime, visibleContent]);

  const activeTransition = useMemo(() => {
    if (!visibleContent) return null;
    return (
      effectiveTransitionTracks(visibleContent)
        .filter((track) => track.visible)
        .flatMap((track) => track.clips)
        .find((clip) => {
          const halfDuration = clip.duration_seconds / 2;
          return (
            media.currentTime >= clip.cut_seconds - halfDuration &&
            media.currentTime <= clip.cut_seconds + halfDuration
          );
        }) ?? null
    );
  }, [media.currentTime, visibleContent]);

  useEffect(() => {
    if (!previewPatch?.selection.time_range_seconds) {
      media.setPlaybackWindow(null);
      media.setPlaybackRate(1);
      return;
    }
    media.setPlaybackWindow(previewPatch.selection.time_range_seconds);
    media.setPlaybackRate(1);
  }, [media.setPlaybackRate, media.setPlaybackWindow, previewPatch]);

  const directProducer = useCallback(
    (text: string) => {
      setRightTab("producer");
      layout.setRightOpen(true);
      setDraftIntent({ id: crypto.randomUUID(), text, mode: "replace" });
    },
    [layout],
  );

  const persistDirectOperations = useCallback(
    async (input: {
      selection: EditorSelection;
      operations: EditorPatchOperation[];
      summary: string;
      recordHistory: boolean;
      allowPreview?: boolean;
    }) => {
      if (
        !projectId ||
        !editorArtifactId ||
        !editorContent ||
        applyDirectPatch.isPending ||
        (previewPatch && !input.allowPreview)
      ) {
        return false;
      }
      const patch = editorPatchInputSchema.parse({
        instruction_summary: input.summary,
        operations: input.operations,
        selection: input.selection,
      });
      const revised = applyEditorPatch(editorContent, patch);
      const previousRevision = directRevision;
      setDirectRevision({ artifactId: editorArtifactId, content: revised });
      try {
        const result = await applyDirectPatch.mutateAsync(patch);
        const nextArtifactId = result.content_package_artifact.id;
        lastDirectArtifactId.current = nextArtifactId;
        setDirectRevision({ artifactId: nextArtifactId, content: revised });
        if (input.recordHistory) {
          undoStack.current.push({
            beforeArtifactId: editorArtifactId,
            beforeContent: editorContent,
            afterArtifactId: nextArtifactId,
            afterContent: revised,
            summary: input.summary,
          });
          redoStack.current = [];
          updateHistorySize();
        }
        return true;
      } catch {
        setDirectRevision(previousRevision);
        return false;
      }
    },
    [
      applyDirectPatch,
      directRevision,
      editorArtifactId,
      editorContent,
      previewPatch,
      projectId,
      updateHistorySize,
    ],
  );

  const applyDirectOperations = useCallback(
    (
      sceneIds: string[],
      operations: EditorPatchOperation[],
      summary: string,
    ) => {
      void persistDirectOperations({
        selection: createSelection({
          projectId: projectId!,
          contentArtifactId: editorArtifactId!,
          content: editorContent!,
          sceneIds,
          gapIds: selectedGapIds,
          playheadSeconds: media.currentTime,
          sourceLedgerArtifact: evidenceArtifact,
        }),
        operations,
        summary,
        recordHistory: true,
      });
    },
    [
      editorArtifactId,
      editorContent,
      evidenceArtifact,
      media.currentTime,
      persistDirectOperations,
      projectId,
      selectedGapIds,
    ],
  );

  const applyDirectTrackOperations = useCallback(
    (
      trackIds: string[],
      operations: EditorPatchOperation[],
      summary: string,
    ) => {
      void persistDirectOperations({
        selection: createSelection({
          projectId: projectId!,
          contentArtifactId: editorArtifactId!,
          content: editorContent!,
          sceneIds: trackOperationSceneIds(operations),
          trackIds,
          playheadSeconds: media.currentTime,
          sourceLedgerArtifact: evidenceArtifact,
        }),
        operations,
        summary,
        recordHistory: true,
      });
    },
    [
      editorArtifactId,
      editorContent,
      evidenceArtifact,
      media.currentTime,
      persistDirectOperations,
      projectId,
    ],
  );

  const applyDirectItemOperations = useCallback(
    (
      itemIds: string[],
      operations: EditorPatchOperation[],
      summary: string,
    ) => {
      void persistDirectOperations({
        selection: createSelection({
          projectId: projectId!,
          contentArtifactId: editorArtifactId!,
          content: editorContent!,
          itemIds,
          playheadSeconds: media.currentTime,
          sourceLedgerArtifact: evidenceArtifact,
        }),
        operations,
        summary,
        recordHistory: true,
      });
    },
    [
      editorArtifactId,
      editorContent,
      evidenceArtifact,
      media.currentTime,
      persistDirectOperations,
      projectId,
    ],
  );

  const updateRelease = useCallback(
    (
      operation: Extract<EditorPatchOperation, { type: "update_release" }>,
      summary: string,
    ) => {
      if (!projectId || !editorArtifactId || !editorContent) return;
      const thumbnailId = operation.release?.thumbnail_artifact_id;
      void persistDirectOperations({
        selection: {
          project_id: projectId,
          base_content_package_artifact_id: editorArtifactId,
          item_ids: [],
          scene_ids: [],
          track_ids: ["release"],
          gap_ids: [],
          artifact_ids: thumbnailId ? [thumbnailId] : [],
          playhead_seconds: media.currentTime,
          time_range_seconds: null,
        },
        operations: [operation],
        summary,
        recordHistory: true,
      });
    },
    [
      editorArtifactId,
      editorContent,
      media.currentTime,
      persistDirectOperations,
      projectId,
    ],
  );

  const deleteTimelineSelection = useCallback(async () => {
    if (
      !projectId ||
      !editorArtifactId ||
      !editorContent ||
      selectedItemIds.length === 0 ||
      applyDirectPatch.isPending
    ) {
      return;
    }
    const plan = buildTimelineDeletePlan(editorContent, selectedItemIds);
    if (plan.operations.length === 0) return;
    const deleted = await persistDirectOperations({
      selection: createSelection({
        projectId,
        contentArtifactId: editorArtifactId,
        content: editorContent,
        itemIds: selectedItemIds,
        playheadSeconds: media.currentTime,
        sourceLedgerArtifact: evidenceArtifact,
      }),
      operations: plan.operations,
      summary:
        selectedItemIds.length === 1
          ? "Delete selected timeline item"
          : `Delete ${selectedItemIds.length} selected timeline items`,
      recordHistory: true,
    });
    if (deleted) {
      setSelectedItemIds([]);
      setSelectedGapIds([]);
    }
  }, [
    applyDirectPatch.isPending,
    editorArtifactId,
    editorContent,
    evidenceArtifact,
    media.currentTime,
    persistDirectOperations,
    projectId,
    selectedItemIds,
  ]);

  const cutAtPlayhead = useCallback(
    (sceneId: string) => {
      if (!editorContent || !projectId || !editorArtifactId) return;
      const operation = splitSceneAtPlayhead({
        content: editorContent,
        sceneId,
        playheadSeconds: media.currentTime,
        secondSceneId: `scene_cut_${crypto.randomUUID()}`,
      });
      if (!operation) return;
      void persistDirectOperations({
        selection: createSelection({
          projectId,
          contentArtifactId: editorArtifactId,
          content: editorContent,
          itemIds: [videoItemId(sceneId)],
          playheadSeconds: media.currentTime,
          sourceLedgerArtifact: evidenceArtifact,
        }),
        operations: [operation],
        summary: `Cut “${operation.first.title}” at the playhead`,
        recordHistory: true,
      });
    },
    [
      editorArtifactId,
      editorContent,
      evidenceArtifact,
      media.currentTime,
      persistDirectOperations,
      projectId,
    ],
  );

  const undo = useCallback(async () => {
    const entry = undoStack.current.pop();
    if (!entry || !editorArtifactId || restoreRevision.isPending) return;
    updateHistorySize();
    const previousRevision = directRevision;
    setDirectRevision({
      artifactId: editorArtifactId,
      content: entry.beforeContent,
    });
    try {
      const result = await restoreRevision.mutateAsync({
        baseArtifactId: editorArtifactId,
        targetArtifactId: entry.beforeArtifactId,
      });
      lastDirectArtifactId.current = result.content_package_artifact.id;
      setDirectRevision({
        artifactId: result.content_package_artifact.id,
        content: entry.beforeContent,
      });
      redoStack.current.push(entry);
    } catch {
      setDirectRevision(previousRevision);
      undoStack.current.push(entry);
    }
    updateHistorySize();
  }, [directRevision, editorArtifactId, restoreRevision, updateHistorySize]);

  const redo = useCallback(async () => {
    const entry = redoStack.current.pop();
    if (!entry || !editorArtifactId || restoreRevision.isPending) return;
    updateHistorySize();
    const previousRevision = directRevision;
    setDirectRevision({
      artifactId: editorArtifactId,
      content: entry.afterContent,
    });
    try {
      const result = await restoreRevision.mutateAsync({
        baseArtifactId: editorArtifactId,
        targetArtifactId: entry.afterArtifactId,
      });
      lastDirectArtifactId.current = result.content_package_artifact.id;
      setDirectRevision({
        artifactId: result.content_package_artifact.id,
        content: entry.afterContent,
      });
      undoStack.current.push(entry);
    } catch {
      setDirectRevision(previousRevision);
      redoStack.current.push(entry);
    }
    updateHistorySize();
  }, [directRevision, editorArtifactId, restoreRevision, updateHistorySize]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, [contenteditable='true'], [role='dialog']",
        )
      ) {
        return;
      }
      const commandKey = event.metaKey || event.ctrlKey;
      if (commandKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) void redo();
        else void undo();
      } else if (commandKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        void redo();
      } else if (
        !commandKey &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        event.preventDefault();
        void deleteTimelineSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteTimelineSelection, redo, undo]);

  const selectItem = (itemId: string, additive = false) => {
    const item = editorItems.find((candidate) => candidate.id === itemId);
    if (!item) return;
    setSelectedItemIds((current) => {
      if (!additive) return [itemId];
      if (current.includes(itemId)) {
        const next = current.filter((id) => id !== itemId);
        return next.length > 0 ? next : [itemId];
      }
      return editorItems
        .filter((candidate) => [...current, itemId].includes(candidate.id))
        .map((candidate) => candidate.id);
    });
    if (!additive) {
      setSelectedGapIds([]);
      setSelectedTrackIds([]);
    }
    media.seek(item.start_seconds);
  };

  const selectItems = (itemIds: string[]) => {
    const ordered = editorItems
      .filter((item) => itemIds.includes(item.id))
      .map((item) => item.id);
    if (ordered.length === 0) {
      setSelectedItemIds([]);
      setSelectedTrackIds([]);
      setSelectedGapIds([]);
      return;
    }
    setSelectedItemIds(ordered);
    setSelectedTrackIds([]);
    setSelectedGapIds([]);
    const first = editorItems.find((item) => item.id === ordered[0]);
    if (first) media.seek(first.start_seconds);
  };

  const selectTrack = (trackId: string, additive = false) => {
    if (!editorTracks.some((track) => track.id === trackId)) return;
    setSelectedTrackIds((current) => {
      if (!additive) return [trackId];
      if (current.includes(trackId)) {
        return current.filter((id) => id !== trackId);
      }
      return editorTracks
        .filter((track) => [...current, trackId].includes(track.id))
        .map((track) => track.id);
    });
    if (!additive) {
      setSelectedItemIds([]);
      setSelectedGapIds([]);
    }
  };

  const selectGap = (gapId: string, additive = false) => {
    if (!editorContent) return;
    const gap = editorGaps.find((candidate) => candidate.id === gapId);
    if (!gap) return;
    const index = editorContent.scenes.findIndex(
      (scene) => scene.id === gap.after_scene_id,
    );
    const scene = editorContent.scenes[index];
    if (!scene?.gap_after_seconds) return;
    if (!additive) {
      setSelectedItemIds([]);
      setSelectedTrackIds([]);
    }
    setSelectedGapIds((current) =>
      additive
        ? current.includes(gapId)
          ? current.filter((id) => id !== gapId)
          : [...current, gapId]
        : [gapId],
    );
    media.seek(gap.start_seconds);
  };

  const selectArtifact = (artifactId: string) => {
    setAttachedArtifactIds((current) =>
      current.includes(artifactId)
        ? current.filter((id) => id !== artifactId)
        : [...current, artifactId],
    );
    setRightTab("producer");
    layout.setRightOpen(true);
  };

  const importMedia = async (files: File[]) => {
    if (!projectId) return [];
    setImportError(null);
    try {
      const imported: string[] = [];
      for (const file of files) {
        const artifact = await uploadAsset.mutateAsync(file);
        imported.push(artifact.id);
      }
      setAttachedArtifactIds((current) => [
        ...new Set([...current, ...imported]),
      ]);
      setRightTab("producer");
      layout.setRightOpen(true);
      return imported;
    } catch (error) {
      setImportError(
        error instanceof Error
          ? `Import failed · ${error.message.replaceAll("_", " ")}`
          : "Import failed",
      );
      return [];
    }
  };

  const placeAudioArtifact = useCallback(
    async (input: {
      artifact: Artifact;
      durationSeconds: number;
      extraArtifactIds?: string[];
      label: string;
      role: "effects" | "music";
    }) => {
      if (!projectId || !editorArtifactId || !editorContent) return false;
      const selectedGap = editorGaps.find((gap) =>
        selectedGapIds.includes(gap.id),
      );
      const selectedItem = editorItems.find(
        (item) => item.id === selectedItemIds.at(-1),
      );
      const start = snapToFrame(
        Math.max(
          0,
          selectedGap?.start_seconds ??
            selectedItem?.start_seconds ??
            media.currentTime,
        ),
      );
      const scene =
        editorContent.scenes.find(
          (candidate) => candidate.id === selectedGap?.after_scene_id,
        ) ?? sceneAtTimelineTime(editorContent, start);
      if (!scene) return false;
      const sourceDuration = fitSourceDurationToFrames(
        artifactDurationSeconds(input.artifact, input.durationSeconds),
      );
      const duration = snapToFrame(
        Math.max(
          1 / VIDEO_FPS,
          Math.min(sourceDuration, totalDuration(editorContent) - start),
        ),
      );
      const clipId = `clip_${crypto.randomUUID()}`;
      const existing = effectiveAudioTracks(editorContent).find(
        (track) => track.role === input.role,
      );
      const track = existing ?? {
        id: input.role === "music" ? "track_music" : "track_effects",
        name: input.role === "music" ? "Music" : "Sound effects",
        role: input.role,
        locale: null,
        voice_label: null,
        muted: false,
        solo: false,
        export_enabled: true,
        gain: 1,
        clips: [],
      };
      const operation: EditorPatchOperation = {
        type: "upsert_audio_track",
        track: {
          ...track,
          clips: [
            ...track.clips,
            {
              id: clipId,
              scene_id: scene.id,
              label: input.label,
              artifact_id: input.artifact.id,
              script: null,
              transcript_artifact_id: null,
              captions_artifact_id: null,
              start_offset_seconds: 0,
              timeline_start_seconds: start,
              source_in_seconds: 0,
              source_out_seconds: duration,
              duration_seconds: duration,
              playback_rate: 1,
              status: "generated",
            },
          ],
        },
      };
      const applied = await persistDirectOperations({
        selection: createSelection({
          projectId,
          contentArtifactId: editorArtifactId,
          content: editorContent,
          sceneIds: [scene.id],
          trackIds: ["voice", track.id],
          playheadSeconds: start,
          sourceLedgerArtifact: evidenceArtifact,
          extraArtifactIds: [
            input.artifact.id,
            ...(input.extraArtifactIds ?? []),
          ],
        }),
        operations: [operation],
        summary: `Place ${input.label}`,
        recordHistory: true,
      });
      if (applied) {
        setSelectedItemIds([audioItemId(clipId)]);
        setSelectedGapIds([]);
        media.seek(start);
      }
      return applied;
    },
    [
      editorArtifactId,
      editorContent,
      editorGaps,
      editorItems,
      evidenceArtifact,
      media,
      persistDirectOperations,
      projectId,
      selectedGapIds,
      selectedItemIds,
    ],
  );

  const buildTransitionPatch = useCallback(
    (preset: TransitionPresetId): EditorPatchInput | null => {
      if (!projectId || !editorArtifactId || !editorContent) return null;
      const selectedGap = editorGaps.find((gap) =>
        selectedGapIds.includes(gap.id),
      );
      const selectedItem = editorItems.find(
        (item) => item.id === selectedItemIds.at(-1),
      );
      const selectedTransition = selectedItem
        ? effectiveTransitionTracks(editorContent)
            .flatMap((track) => track.clips)
            .find((clip) => transitionItemId(clip.id) === selectedItem.id)
        : null;
      if (selectedItem?.kind === "transition" && selectedTransition) {
        const definition = transitionPresetRegistry[preset];
        return editorPatchInputSchema.parse({
          instruction_summary: `Replace ${selectedTransition.label} with ${definition.label}`,
          operations: [
            {
              type: "update_transition_clip",
              item_id: selectedItem.id,
              clip_id: selectedTransition.id,
              label: definition.label,
              preset_id: preset,
              duration_seconds: snapToFrame(
                definition.default_duration_seconds,
              ),
            },
          ],
          selection: createSelection({
            projectId,
            contentArtifactId: editorArtifactId,
            content: editorContent,
            itemIds: [selectedItem.id],
            playheadSeconds: selectedTransition.cut_seconds,
            sourceLedgerArtifact: evidenceArtifact,
          }),
        });
      }
      const targetTime =
        selectedGap?.end_seconds ??
        selectedItem?.end_seconds ??
        media.currentTime;
      const edit = buildTransitionTrackEdit({
        content: editorContent,
        items: editorItems,
        targetSeconds: targetTime,
        preset,
        createClipId: () => `clip_${crypto.randomUUID()}`,
      });
      if (!edit) return null;
      return editorPatchInputSchema.parse({
        instruction_summary: `Use ${edit.clip.label}`,
        operations: [edit.operation],
        selection: createSelection({
          projectId,
          contentArtifactId: editorArtifactId,
          content: editorContent,
          itemIds: [edit.leftItem.id, edit.rightItem.id],
          sceneIds: [edit.leftItem.scene_id, edit.rightItem.scene_id],
          trackIds: ["transition", edit.operation.track.id],
          gapIds: selectedGap ? [selectedGap.id] : [],
          playheadSeconds: edit.clip.cut_seconds,
          sourceLedgerArtifact: evidenceArtifact,
        }),
      });
    },
    [
      editorArtifactId,
      editorContent,
      editorGaps,
      editorItems,
      evidenceArtifact,
      media.currentTime,
      projectId,
      selectedGapIds,
      selectedItemIds,
    ],
  );

  const previewTransition = useCallback((preset: TransitionPresetId | null) => {
    setPreviewTransitionPreset(preset);
  }, []);

  const applyTransition = useCallback(
    async (preset: TransitionPresetId) => {
      const patch = buildTransitionPatch(preset);
      if (!patch) return;
      setPreviewTransitionPreset(null);
      const applied = await persistDirectOperations({
        selection: patch.selection,
        operations: patch.operations,
        summary: patch.instruction_summary,
        recordHistory: true,
        allowPreview: true,
      });
      if (!applied) return;
      const transition = transitionFromPatch(patch);
      if (transition) {
        setSelectedItemIds([transitionItemId(transition.id)]);
        media.seek(transition.cut_seconds);
      }
    },
    [buildTransitionPatch, media, persistDirectOperations, transitionFromPatch],
  );

  const applyGeneratedSound = useCallback(
    async (input: {
      artifact: Artifact;
      durationSeconds: number;
      presetId: SoundEffectPresetId;
    }) => {
      await placeAudioArtifact({
        artifact: input.artifact,
        durationSeconds: input.durationSeconds,
        label: soundEffectPresetRegistry[input.presetId].label,
        role: "effects",
      });
    },
    [placeAudioArtifact],
  );

  const placeLibraryAsset = useCallback(
    async ({ artifact, licenseArtifact, result }: PlacedLibraryAsset) => {
      if (!projectId || !editorArtifactId || !editorContent) return;
      const selectedGap = editorGaps.find((gap) =>
        selectedGapIds.includes(gap.id),
      );
      const selectedItem = editorItems.find(
        (item) => item.id === selectedItemIds.at(-1),
      );
      const start = snapToFrame(
        Math.max(
          0,
          selectedGap?.start_seconds ??
            selectedItem?.start_seconds ??
            media.currentTime,
        ),
      );
      const scene =
        editorContent.scenes.find(
          (candidate) => candidate.id === selectedGap?.after_scene_id,
        ) ?? sceneAtTimelineTime(editorContent, start);
      if (!scene) return;
      const sourceDuration = fitSourceDurationToFrames(
        artifactDurationSeconds(artifact, result.duration_seconds ?? 5),
      );
      const available = Math.max(
        1 / VIDEO_FPS,
        totalDuration(editorContent) - start,
      );
      const requestedDuration = selectedGap
        ? selectedGap.end_seconds - selectedGap.start_seconds
        : Math.min(sourceDuration, 5);
      const duration = snapToFrame(
        Math.max(
          1 / VIDEO_FPS,
          Math.min(sourceDuration, available, requestedDuration),
        ),
      );
      const clipId = `clip_${crypto.randomUUID()}`;

      if (result.use === "broll") {
        const operation = buildBrollPlacementOperation(editorContent, {
          artifactId: artifact.id,
          clipId,
          durationSeconds: duration,
          label: result.title,
          licenseArtifactId: licenseArtifact.id,
          sceneId: scene.id,
          sourceDurationSeconds: sourceDuration,
          startSeconds: start,
        });
        const applied = await persistDirectOperations({
          selection: createSelection({
            projectId,
            contentArtifactId: editorArtifactId,
            content: editorContent,
            sceneIds: [scene.id],
            trackIds: ["visual", BROLL_TRACK_ID],
            gapIds: selectedGap ? [selectedGap.id] : [],
            playheadSeconds: start,
            sourceLedgerArtifact: evidenceArtifact,
            extraArtifactIds: [artifact.id, licenseArtifact.id],
          }),
          operations: [operation],
          summary: `Place ${result.title}`,
          recordHistory: true,
        });
        if (applied) {
          setSelectedItemIds([videoItemId(clipId)]);
          setSelectedGapIds([]);
          media.seek(start);
        }
        return;
      }

      await placeAudioArtifact({
        artifact,
        durationSeconds: sourceDuration,
        extraArtifactIds: [licenseArtifact.id],
        label: result.title,
        role: result.use === "music" ? "music" : "effects",
      });
    },
    [
      editorArtifactId,
      editorContent,
      editorGaps,
      editorItems,
      evidenceArtifact,
      media,
      placeAudioArtifact,
      persistDirectOperations,
      projectId,
      selectedGapIds,
      selectedItemIds,
    ],
  );

  const leftPaneWidth = layout.leftOpen ? layout.leftWidth : 42;
  const rightPaneWidth = layout.rightOpen ? layout.rightWidth : 42;

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-surface text-ink">
      <header className="flex h-12 shrink-0 items-center border-b border-line-subtle bg-surface px-2">
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg px-2 hover:bg-hover"
        >
          <GreenlightMark size={18} className="text-action" strokeWidth={2} />
          <strong className="text-[13px] font-semibold tracking-[-0.02em]">
            Greenlight
          </strong>
        </button>

        <ProjectSwitcher
          projects={projects.data ?? []}
          activeId={projectId}
          creating={createProject.isPending}
          onSelect={setProjectId}
          onCreate={async (topic) => {
            const created = await createProject.mutateAsync({
              topic,
              audience: "YouTube viewers",
              goal: "Develop a publish-ready YouTube video",
              target_duration_seconds: 60,
              tone: "clear, curious, cinematic",
            });
            setSelectedItemIds([]);
            setProjectId(created.id);
          }}
        />

        <div className="ml-auto mr-1.5">
          <ThemeToggle />
        </div>
        <CodexConnectionStatus
          capabilities={imageGeneration.data ?? null}
          checking={imageGeneration.isLoading && !imageGeneration.data}
        />
        <button
          type="button"
          onClick={() => {
            setRightTab("release");
            layout.setRightOpen(true);
          }}
          className={cx(
            "flex h-8 items-center gap-2 rounded-full border border-line-subtle px-3 text-[10px] font-medium text-ink-secondary hover:border-ink-caption hover:text-ink",
            rightTab === "release" && "border-action text-action",
          )}
        >
          <YouTubeIcon className="size-4" />
          Release
          <span className="capitalize text-ink-caption">
            {project.data?.release?.privacy ?? "draft"}
          </span>
        </button>
        <div className="ml-1.5 flex items-center gap-1.5 rounded-full border border-line-subtle px-2 py-1 text-ink-tertiary">
          <TrueForgeIcon className="size-4" />
          <GeminiIcon className="size-4" />
          <RemotionIcon className="size-4" />
          <YouTubeIcon className="size-4" />
        </div>
        <button
          type="button"
          onClick={() =>
            directProducer(
              "Prepare the current cut for review. Run only the missing quality and staging steps, and stop for TrueForge confirmation before rendering, uploading, or publishing.",
            )
          }
          className="ml-2 flex h-8 items-center gap-2 rounded-full bg-surface-sunken px-3 text-[10px] font-medium text-ink-secondary hover:bg-active"
        >
          <LockKeyhole size={13} />
          {project.data?.project.stage ?? "Not ready"}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          style={{ width: leftPaneWidth }}
          className="shrink-0 overflow-hidden"
        >
          {layout.leftOpen ? (
            <MediaBrowser
              projectId={projectId!}
              artifacts={project.data?.artifacts ?? []}
              attachedArtifactIds={attachedArtifactIds}
              importing={uploadAsset.isPending}
              importError={importError}
              workspacePath={project.data?.project.workspace_path ?? null}
              onSelectArtifact={selectArtifact}
              onImport={(files) => void importMedia(files)}
              onPlaceLibraryAsset={placeLibraryAsset}
              onApplySoundEffect={applyGeneratedSound}
              onApplyTransition={applyTransition}
              onPreviewTransition={previewTransition}
              previewTransitionPreset={previewTransitionPreset}
              selectedTransitionPreset={selectedTransitionPreset}
              onCollapse={() => layout.setLeftOpen(false)}
            />
          ) : (
            <div className="flex h-full justify-center bg-sidebar pt-2">
              <IconButton
                Icon={PanelLeftOpen}
                label="Open media browser"
                onClick={() => layout.setLeftOpen(true)}
              />
            </div>
          )}
        </div>
        {layout.leftOpen ? (
          <ResizeHandle
            direction="vertical"
            onPointerDown={layout.resizeLeft}
          />
        ) : null}

        <div className="relative isolate z-0 flex min-w-0 flex-1 flex-col">
          <ProgramMonitor
            scene={visibleScene}
            artifacts={project.data?.artifacts ?? []}
            video={videoArtifact}
            poster={thumbnailArtifact}
            media={media}
            duration={programDuration}
            previewing={Boolean(previewContent)}
            previewUsesCanvas={previewUsesCanvas}
            transition={activeTransition}
            transitionReview={null}
            captionText={activeCaption?.label ?? null}
            timelineOpen={layout.timelineOpen}
            onToggleTimeline={() =>
              layout.setTimelineOpen(!layout.timelineOpen)
            }
          />
          {layout.timelineOpen ? (
            <>
              <ResizeHandle
                direction="horizontal"
                onPointerDown={layout.resizeTimeline}
              />
              <div
                className="shrink-0 overflow-hidden"
                style={{ height: layout.timelineHeight }}
              >
                {editorContent ? (
                  <Timeline
                    content={visibleContent ?? editorContent}
                    selectedItemIds={selectedItemIds}
                    selectedTrackIds={selectedTrackIds}
                    selectedGapIds={selectedGapIds}
                    previewSceneIds={previewSceneIds}
                    previewing={Boolean(previewContent)}
                    currentTime={media.currentTime}
                    onSelectItem={selectItem}
                    onSelectTrack={selectTrack}
                    onSelectMany={(itemIds, gapIds = []) => {
                      selectItems(itemIds);
                      setSelectedGapIds(gapIds);
                    }}
                    onSeek={media.seek}
                    onScrubStart={media.beginScrub}
                    onScrub={media.previewSeek}
                    onScrubEnd={media.endScrub}
                    onIntent={directProducer}
                    onDirectEdit={applyDirectOperations}
                    onDirectItemEdit={applyDirectItemOperations}
                    onDirectTrackEdit={applyDirectTrackOperations}
                    onCutAtPlayhead={cutAtPlayhead}
                    onAttachItemsToProducer={(items) => {
                      if (items.length === 0) return;
                      setProducerReferences((current) =>
                        appendProducerReferences(
                          current,
                          items.map((item) => ({
                            type: "item",
                            id: item.id,
                          })),
                        ),
                      );
                      setRightTab("producer");
                      layout.setRightOpen(true);
                    }}
                    onAttachTracksToProducer={(tracks) => {
                      if (tracks.length === 0) return;
                      setProducerReferences((current) =>
                        appendProducerReferences(
                          current,
                          tracks.map((track) => ({
                            type: "track",
                            id: track.id,
                          })),
                        ),
                      );
                      setRightTab("producer");
                      layout.setRightOpen(true);
                    }}
                    onAttachGapsToProducer={(gaps) => {
                      if (gaps.length === 0) return;
                      setProducerReferences((current) =>
                        appendProducerReferences(
                          current,
                          gaps.map((gap) => ({
                            type: "gap",
                            id: gap.id,
                          })),
                        ),
                      );
                      setRightTab("producer");
                      layout.setRightOpen(true);
                    }}
                    onSelectGap={selectGap}
                    onSelectAll={() =>
                      selectItems(editorItems.map((item) => item.id))
                    }
                    onCollapse={() => layout.setTimelineOpen(false)}
                    canUndo={historySize.undo > 0}
                    canRedo={historySize.redo > 0}
                    editing={applyDirectPatch.isPending}
                    onUndo={() => void undo()}
                    onRedo={() => void redo()}
                    onDeleteSelection={() => void deleteTimelineSelection()}
                  />
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        {layout.rightOpen ? (
          <ResizeHandle
            direction="vertical"
            onPointerDown={layout.resizeRight}
          />
        ) : null}
        <div
          style={{ width: rightPaneWidth }}
          className="shrink-0 overflow-hidden"
        >
          {layout.rightOpen ? (
            <aside className="flex h-full min-h-0 flex-col bg-surface">
              <div className="flex h-10 shrink-0 items-end border-b border-line-subtle px-2">
                {(["producer", "details", "release"] as const).map((tab) => (
                  <button
                    type="button"
                    key={tab}
                    onClick={() => setRightTab(tab)}
                    className={cx(
                      "relative h-10 px-3 text-[11px] capitalize text-ink-tertiary hover:text-ink",
                      rightTab === tab &&
                        "font-medium text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-action",
                    )}
                  >
                    {tab === "producer"
                      ? "AI Producer"
                      : tab === "details"
                        ? "Details"
                        : "Release"}
                  </button>
                ))}
                <div className="ml-auto mb-1.5">
                  <IconButton
                    Icon={PanelRightClose}
                    label="Collapse AI Producer panel"
                    size="sm"
                    onClick={() => layout.setRightOpen(false)}
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <div
                  className={
                    rightTab === "producer" ? "h-full" : "hidden h-full"
                  }
                >
                  <ProducerPanel
                    projectId={projectId}
                    content={editorContent}
                    artifacts={project.data?.artifacts ?? []}
                    selection={selection}
                    liveSelection={liveSelection}
                    references={resolvedProducerReferences}
                    contextArtifacts={(project.data?.artifacts ?? []).filter(
                      (artifact) => attachedArtifactIds.includes(artifact.id),
                    )}
                    draftIntent={draftIntent}
                    events={producer.events}
                    sessionCostInUsd={producer.sessionCostInUsd}
                    activity={producer.activity}
                    pendingApprovals={producer.pendingApprovals}
                    pendingQuestions={producer.pendingQuestions}
                    isSending={producer.isSending}
                    isApproving={producer.isApproving}
                    isAnswering={producer.isAnswering}
                    onSend={(instruction) =>
                      producer.send({
                        instruction,
                        selection,
                        references: producerReferenceSelection,
                        timeline: timelineContext,
                      })
                    }
                    onRetryInstruction={producer.retryInstruction}
                    onApproval={(pending, status, reason) =>
                      producer.decideApproval({ pending, status, reason })
                    }
                    onAnswerQuestion={(pending, answer) =>
                      producer.answerQuestion({ pending, answer })
                    }
                    onCancelQuestion={producer.cancelQuestion}
                    onRemoveItem={(itemId) =>
                      setProducerReferences((current) =>
                        removeProducerReference(current, {
                          type: "item",
                          id: itemId,
                        }),
                      )
                    }
                    onRemoveTrack={(trackId) =>
                      setProducerReferences((current) =>
                        removeProducerReference(current, {
                          type: "track",
                          id: trackId,
                        }),
                      )
                    }
                    onRemoveGap={(gapId) =>
                      setProducerReferences((current) =>
                        removeProducerReference(current, {
                          type: "gap",
                          id: gapId,
                        }),
                      )
                    }
                    onRemoveArtifact={(artifactId) =>
                      setAttachedArtifactIds((current) =>
                        current.filter((id) => id !== artifactId),
                      )
                    }
                    onClearReferences={() => {
                      setProducerReferences(emptyProducerReferences());
                      setAttachedArtifactIds([]);
                    }}
                    onAttachArtifact={selectArtifact}
                    onImportFiles={importMedia}
                    importing={uploadAsset.isPending}
                  />
                </div>
                <div
                  className={
                    rightTab === "release" ? "h-full" : "hidden h-full"
                  }
                >
                  {visibleContent ? (
                    <ReleasePanel
                      artifacts={project.data?.artifacts ?? []}
                      busy={
                        applyDirectPatch.isPending ||
                        producer.isSending ||
                        Boolean(previewPatch)
                      }
                      connection={youtubeConnection.data ?? null}
                      content={visibleContent}
                      latestThumbnail={releaseThumbnailArtifact}
                      releasePrivacy={project.data?.release?.privacy ?? null}
                      releaseStudioUrl={
                        project.data?.release?.snapshot.youtube_video_id
                          ? `https://studio.youtube.com/video/${encodeURIComponent(project.data.release.snapshot.youtube_video_id)}/edit`
                          : null
                      }
                      onChange={updateRelease}
                      onPrepare={() => {
                        setRightTab("producer");
                        directProducer(
                          project.data?.release?.privacy === "unlisted"
                            ? visibleContent.release.destination === "scheduled"
                              ? "Prepare the current unlisted release for its scheduled time. Check the locked snapshot and stop for approval before scheduling it."
                              : visibleContent.release.destination === "public"
                                ? "Prepare the current unlisted release for public publication. Check the locked snapshot and stop for approval before publishing it."
                                : "Open the current unlisted review and tell me what still needs attention."
                            : "Prepare this cut for an unlisted YouTube review. Run only missing quality or render steps and stop for approval before upload.",
                        );
                      }}
                    />
                  ) : null}
                </div>
                <div
                  className={
                    rightTab === "details" ? "h-full" : "hidden h-full"
                  }
                >
                  <InspectorPanel
                    scene={visibleScene}
                    editing={applyDirectPatch.isPending}
                    onChangeSpeed={(scene, playbackRate) =>
                      applyDirectOperations(
                        [scene.id],
                        [changeSceneSpeed(scene, playbackRate)],
                        `Set “${scene.title}” to ${playbackRate.toFixed(2)}×`,
                      )
                    }
                    onEdit={(instruction) => directProducer(instruction)}
                  />
                </div>
              </div>
            </aside>
          ) : (
            <div className="flex h-full justify-center bg-surface pt-2">
              <IconButton
                Icon={PanelRightOpen}
                label="Open AI Producer panel"
                onClick={() => layout.setRightOpen(true)}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
