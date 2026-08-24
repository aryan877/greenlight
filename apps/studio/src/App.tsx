import {
  applyEditorPatch,
  editorPatchInputSchema,
  type EditorFocusInput,
  type EditorSelection,
} from "@greenlight/contracts";
import {
  Aperture,
  ChevronDown,
  LockKeyhole,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useProducerAgent } from "./api/trueforge.js";
import {
  useContentPackage,
  useProject,
  useProjects,
  useUploadAsset,
} from "./api/queries.js";
import {
  GeminiIcon,
  RemotionIcon,
  TrueForgeIcon,
  YouTubeIcon,
} from "./brand-icons.js";
import { IconButton, ResizeHandle, cx } from "./components/controls.js";
import { InspectorPanel } from "./components/InspectorPanel.js";
import { ProducerPanel } from "./components/ProducerPanel.js";
import { ProgramMonitor } from "./components/ProgramMonitor.js";
import { MediaBrowser } from "./components/MediaBrowser.js";
import { Timeline } from "./components/Timeline.js";
import { createSelection, sceneOffset } from "./editor/model.js";
import { useMediaController } from "./editor/use-media-controller.js";
import { useWorkspaceLayout } from "./editor/use-workspace-layout.js";

export const App = () => {
  const projects = useProjects();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const [rightTab, setRightTab] = useState<"producer" | "details">("producer");
  const [attachedArtifactIds, setAttachedArtifactIds] = useState<string[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [draftIntent, setDraftIntent] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const layout = useWorkspaceLayout();
  const media = useMediaController();

  useEffect(() => {
    if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id);
  }, [projectId, projects.data]);

  const project = useProject(projectId);
  const uploadAsset = useUploadAsset(projectId);
  const contentArtifact =
    project.data?.artifacts
      .filter((artifact) => artifact.kind === "content_package")
      .at(-1) ?? null;
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
  const content = useContentPackage(contentArtifact?.id ?? null);

  useEffect(() => {
    if (
      content.data?.scenes[0] &&
      (selectedSceneIds.length === 0 ||
        selectedSceneIds.some(
          (sceneId) =>
            !content.data.scenes.some((scene) => scene.id === sceneId),
        ))
    ) {
      setSelectedSceneIds([content.data.scenes[0].id]);
    }
  }, [content.data, selectedSceneIds]);

  const selectedScene =
    content.data?.scenes.find(
      (scene) => scene.id === selectedSceneIds.at(-1),
    ) ?? null;

  const selection = useMemo<EditorSelection | null>(() => {
    if (
      !projectId ||
      !contentArtifact ||
      !content.data ||
      selectedSceneIds.length === 0
    ) {
      return null;
    }
    return createSelection({
      projectId,
      contentArtifactId: contentArtifact.id,
      content: content.data,
      sceneIds: selectedSceneIds,
      sourceLedgerArtifact: evidenceArtifact,
      extraArtifactIds: attachedArtifactIds,
    });
  }, [
    content.data,
    contentArtifact,
    evidenceArtifact,
    projectId,
    selectedSceneIds,
    attachedArtifactIds,
  ]);

  useEffect(() => {
    setAttachedArtifactIds([]);
    setImportError(null);
  }, [projectId]);

  const focusFromAgent = useCallback(
    (focus: EditorFocusInput) => {
      if (
        focus.selection.project_id !== projectId ||
        !content.data ||
        !focus.selection.scene_ids[0]
      ) {
        return;
      }
      const sceneIndex = content.data.scenes.findIndex(
        (scene) => scene.id === focus.selection.scene_ids[0],
      );
      if (sceneIndex < 0) return;
      const validSceneIds = focus.selection.scene_ids.filter((sceneId) =>
        content.data.scenes.some((scene) => scene.id === sceneId),
      );
      if (validSceneIds.length === 0) return;
      setSelectedSceneIds(validSceneIds);
      setRightTab("producer");
      layout.setRightOpen(true);
      media.seek(sceneOffset(content.data.scenes, sceneIndex));
    },
    [content.data, layout, media, projectId],
  );

  const producer = useProducerAgent(projectId, focusFromAgent);

  const previewPatch = useMemo(() => {
    const pending = producer.pendingApprovals.find(
      (approval) => approval.toolName === "apply_editor_patch",
    );
    if (!pending) return null;
    const parsed = editorPatchInputSchema.safeParse(pending.arguments);
    return parsed.success ? parsed.data : null;
  }, [producer.pendingApprovals]);

  const previewContent = useMemo(() => {
    if (!content.data || !previewPatch) return null;
    try {
      return applyEditorPatch(content.data, previewPatch);
    } catch {
      return null;
    }
  }, [content.data, previewPatch]);

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
                return [];
              }),
            ),
          ]
        : [],
    [previewPatch],
  );

  const visibleContent = previewContent ?? content.data ?? null;
  const visibleScene =
    visibleContent?.scenes.find(
      (scene) => scene.id === selectedSceneIds.at(-1),
    ) ?? selectedScene;

  useEffect(() => {
    if (!previewPatch?.selection.time_range_seconds) {
      media.setPlaybackWindow(null);
      media.setPlaybackRate(1);
      return;
    }
    media.setPlaybackWindow(previewPatch.selection.time_range_seconds);
    media.setPlaybackRate(visibleScene?.playback_rate ?? 1);
  }, [
    media.setPlaybackRate,
    media.setPlaybackWindow,
    previewPatch,
    visibleScene?.playback_rate,
  ]);

  const directProducer = useCallback(
    (text: string) => {
      setRightTab("producer");
      layout.setRightOpen(true);
      setDraftIntent({ id: crypto.randomUUID(), text });
    },
    [layout],
  );

  const runEditorCommand = useCallback(
    (sceneIds: string[], instruction: string) => {
      if (!projectId || !contentArtifact || !content.data) return;
      const commandSelection = createSelection({
        projectId,
        contentArtifactId: contentArtifact.id,
        content: content.data,
        sceneIds,
        sourceLedgerArtifact: evidenceArtifact,
      });
      setSelectedSceneIds(sceneIds);
      setRightTab("producer");
      layout.setRightOpen(true);
      producer.send({ instruction, selection: commandSelection });
    },
    [
      content.data,
      contentArtifact,
      evidenceArtifact,
      layout,
      producer,
      projectId,
    ],
  );

  const selectScene = (sceneId: string, additive = false) => {
    if (!content.data) return;
    const index = content.data.scenes.findIndex(
      (scene) => scene.id === sceneId,
    );
    if (index < 0) return;
    setSelectedSceneIds((current) => {
      if (!additive) return [sceneId];
      if (current.includes(sceneId)) {
        const next = current.filter((id) => id !== sceneId);
        return next.length > 0 ? next : [sceneId];
      }
      return content
        .data!.scenes.filter((scene) =>
          [...current, sceneId].includes(scene.id),
        )
        .map((scene) => scene.id);
    });
    media.seek(sceneOffset(content.data.scenes, index));
  };

  const selectScenes = (sceneIds: string[]) => {
    if (!content.data) return;
    const ordered = content.data.scenes
      .filter((scene) => sceneIds.includes(scene.id))
      .map((scene) => scene.id);
    if (ordered.length === 0) return;
    setSelectedSceneIds(ordered);
    const first = content.data.scenes.findIndex(
      (scene) => scene.id === ordered[0],
    );
    if (first >= 0) media.seek(sceneOffset(content.data.scenes, first));
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

  const leftPaneWidth = layout.leftOpen ? layout.leftWidth : 42;
  const rightPaneWidth = layout.rightOpen ? layout.rightWidth : 42;

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-surface text-ink">
      <header className="flex h-12 shrink-0 items-center border-b border-line-subtle bg-surface px-2">
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg px-2 hover:bg-hover"
        >
          <Aperture size={18} className="text-action" strokeWidth={2} />
          <strong className="text-[13px] font-semibold tracking-[-0.02em]">
            Greenlight
          </strong>
        </button>

        <label className="ml-4 flex min-w-0 max-w-[420px] items-center rounded-lg px-2 hover:bg-hover">
          <select
            aria-label="Active production"
            value={projectId ?? ""}
            onChange={(event) => setProjectId(event.target.value || null)}
            className="h-8 min-w-0 flex-1 appearance-none truncate border-0 bg-transparent pr-6 text-[11px] text-ink outline-none"
          >
            {projects.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.brief.topic}
              </option>
            ))}
          </select>
          <ChevronDown
            size={13}
            className="-ml-5 pointer-events-none text-ink-caption"
          />
        </label>

        <div className="ml-auto flex items-center gap-1.5 rounded-full border border-line-subtle px-2 py-1 text-ink-tertiary">
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
              artifacts={project.data?.artifacts ?? []}
              attachedArtifactIds={attachedArtifactIds}
              importing={uploadAsset.isPending}
              importError={importError}
              onSelectArtifact={selectArtifact}
              onImport={(files) => void importMedia(files)}
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

        <div className="flex min-w-0 flex-1 flex-col">
          <ProgramMonitor
            scene={visibleScene}
            artifacts={project.data?.artifacts ?? []}
            video={videoArtifact}
            media={media}
            previewing={Boolean(previewContent)}
            previewUsesCanvas={Boolean(
              previewPatch?.operations.some(
                (operation) =>
                  operation.type === "update_scene" &&
                  (operation.title !== undefined ||
                    operation.narration !== undefined ||
                    operation.visual !== undefined),
              ),
            )}
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
                {content.data && selectedSceneIds.length > 0 ? (
                  <Timeline
                    content={visibleContent ?? content.data}
                    selectedSceneIds={selectedSceneIds}
                    previewSceneIds={previewSceneIds}
                    previewing={Boolean(previewContent)}
                    currentTime={media.currentTime}
                    onSelect={(scene, additive) =>
                      selectScene(scene.id, additive)
                    }
                    onSelectMany={selectScenes}
                    onSeek={media.seek}
                    onIntent={directProducer}
                    onEditorCommand={runEditorCommand}
                    onSelectAll={() =>
                      setSelectedSceneIds(
                        content.data!.scenes.map((scene) => scene.id),
                      )
                    }
                    onCollapse={() => layout.setTimelineOpen(false)}
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
                {(["producer", "details"] as const).map((tab) => (
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
                    {tab}
                  </button>
                ))}
                <div className="ml-auto mb-1.5">
                  <IconButton
                    Icon={PanelRightClose}
                    label="Collapse producer panel"
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
                    content={content.data ?? null}
                    selection={selection}
                    contextArtifacts={(project.data?.artifacts ?? []).filter(
                      (artifact) => attachedArtifactIds.includes(artifact.id),
                    )}
                    draftIntent={draftIntent}
                    events={producer.events}
                    pendingApprovals={producer.pendingApprovals}
                    pendingQuestions={producer.pendingQuestions}
                    isSending={producer.isSending}
                    isApproving={producer.isApproving}
                    isAnswering={producer.isAnswering}
                    onSend={(instruction) =>
                      producer.send({ instruction, selection })
                    }
                    onRetryInstruction={producer.retryInstruction}
                    onApproval={(pending, status, reason) =>
                      producer.decideApproval({ pending, status, reason })
                    }
                    onAnswerQuestion={(pending, answer) =>
                      producer.answerQuestion({ pending, answer })
                    }
                    onCancelQuestion={producer.cancelQuestion}
                    onRemoveScene={(sceneId) =>
                      setSelectedSceneIds((current) => {
                        const next = current.filter((id) => id !== sceneId);
                        return next.length > 0 ? next : current;
                      })
                    }
                    onRemoveArtifact={(artifactId) =>
                      setAttachedArtifactIds((current) =>
                        current.filter((id) => id !== artifactId),
                      )
                    }
                    onAttachArtifact={selectArtifact}
                    onImportFiles={importMedia}
                    importing={uploadAsset.isPending}
                  />
                </div>
                <div
                  className={
                    rightTab === "details" ? "h-full" : "hidden h-full"
                  }
                >
                  <InspectorPanel
                    scene={visibleScene}
                    onEdit={(instruction) => directProducer(instruction)}
                  />
                </div>
              </div>
            </aside>
          ) : (
            <div className="flex h-full justify-center bg-surface pt-2">
              <IconButton
                Icon={PanelRightOpen}
                label="Open producer panel"
                onClick={() => layout.setRightOpen(true)}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
