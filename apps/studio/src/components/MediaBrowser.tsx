import type {
  Artifact,
  SoundEffectPresetId,
  TransitionPresetId,
} from "@greenlight/contracts";
import {
  Captions,
  Check,
  Copy,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Library,
  Mic2,
  PanelLeftClose,
  Plus,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { greenlightApi } from "../api/greenlight.js";
import { MEDIA_ACCEPT, MEDIA_ARTIFACT_MIME } from "../editor/media-transfer.js";
import { cx, IconButton } from "./controls.js";
import {
  MediaLibraryDialog,
  type PlacedLibraryAsset,
} from "./MediaLibraryDialog.js";
import { EffectsLibraryDialog } from "./EffectsLibraryDialog.js";

type MediaFacts = {
  audioCodec?: string;
  duration?: number;
  height?: number;
  videoCodec?: string;
  width?: number;
};

const labelFor = (artifact: Artifact) => {
  const original = artifact.provenance.original_filename;
  return typeof original === "string" && original.trim()
    ? original
    : `Untitled ${artifact.kind}`;
};

const storedFacts = (artifact: Artifact): MediaFacts => {
  const value = artifact.provenance.media_metadata;
  if (!value || typeof value !== "object") return {};
  const metadata = value as Record<string, unknown>;
  return {
    ...(typeof metadata.duration_seconds === "number"
      ? { duration: metadata.duration_seconds }
      : {}),
    ...(typeof metadata.width === "number" ? { width: metadata.width } : {}),
    ...(typeof metadata.height === "number" ? { height: metadata.height } : {}),
    ...(typeof metadata.video_codec === "string"
      ? { videoCodec: metadata.video_codec }
      : {}),
    ...(typeof metadata.audio_codec === "string"
      ? { audioCodec: metadata.audio_codec }
      : {}),
  };
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDuration = (seconds: number | undefined) => {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
};

const MediaKindIcon = ({
  artifact,
  size = 12,
}: {
  artifact: Artifact;
  size?: number;
}) => {
  if (artifact.kind === "image") return <ImageIcon size={size} />;
  if (artifact.kind === "video") return <Film size={size} />;
  if (artifact.kind === "narration" || artifact.kind === "audio")
    return <Mic2 size={size} />;
  return <Captions size={size} />;
};

const MediaPreview = ({
  artifact,
  controls = false,
  onFacts,
}: {
  artifact: Artifact;
  controls?: boolean;
  onFacts: (facts: MediaFacts) => void;
}) => {
  const label = labelFor(artifact);
  if (artifact.kind === "image") {
    return (
      <img
        src={greenlightApi.artifactUrl(artifact.id)}
        alt={label}
        onLoad={(event) =>
          onFacts({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
        className="size-full object-contain"
      />
    );
  }
  if (artifact.kind === "video") {
    return (
      <video
        src={greenlightApi.artifactUrl(artifact.id)}
        controls={controls}
        muted={!controls}
        preload="metadata"
        onLoadedMetadata={(event) =>
          onFacts({
            duration: event.currentTarget.duration,
            width: event.currentTarget.videoWidth,
            height: event.currentTarget.videoHeight,
          })
        }
        className="size-full bg-black object-contain"
      />
    );
  }
  if (artifact.kind === "narration" || artifact.kind === "audio") {
    return controls ? (
      <audio
        src={greenlightApi.artifactUrl(artifact.id)}
        controls
        preload="metadata"
        onLoadedMetadata={(event) =>
          onFacts({ duration: event.currentTarget.duration })
        }
        className="w-[min(520px,90%)]"
      />
    ) : (
      <Mic2 size={26} className="text-track-voice-strong" />
    );
  }
  return <Captions size={26} className="text-track-caption-strong" />;
};

const MediaViewer = ({
  artifact,
  facts,
  workspacePath,
  attached,
  onFacts,
  onAttach,
  onClose,
}: {
  artifact: Artifact;
  facts: MediaFacts;
  workspacePath: string | null;
  attached: boolean;
  onFacts: (facts: MediaFacts) => void;
  onAttach: () => void;
  onClose: () => void;
}) => {
  const [copied, setCopied] = useState(false);
  const projectRelativePath = artifact.relative_path
    .split("/")
    .slice(1)
    .join("/");
  const filePath = workspacePath
    ? `${workspacePath}/${projectRelativePath}`
    : artifact.relative_path;
  const duration = formatDuration(facts.duration);
  const dimensions =
    facts.width && facts.height ? `${facts.width} × ${facts.height}` : null;
  const codec = [facts.videoCodec, facts.audioCodec]
    .filter(Boolean)
    .join(" + ");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={labelFor(artifact)}
      className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-5 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-float">
        <header className="flex shrink-0 items-center gap-3 border-b border-line-subtle px-4 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-sunken text-ink-tertiary">
            <MediaKindIcon artifact={artifact} size={15} />
          </span>
          <div className="min-w-0">
            <h2 className="break-words text-[15px] font-medium leading-5 text-ink">
              {labelFor(artifact)}
            </h2>
            <p className="mt-0.5 text-[10px] text-ink-tertiary">
              {artifact.mime_type} · {formatBytes(artifact.byte_size)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close media viewer"
            onClick={onClose}
            className="ml-auto grid size-8 shrink-0 place-items-center rounded-md text-ink-tertiary hover:bg-hover hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px]">
          <div className="grid min-h-[360px] place-items-center overflow-hidden bg-canvas p-5">
            <div className="grid size-full max-h-[62vh] place-items-center overflow-hidden rounded-md bg-surface shadow-monitor">
              <MediaPreview artifact={artifact} controls onFacts={onFacts} />
            </div>
          </div>
          <aside className="overflow-y-auto border-l border-line-subtle p-4">
            <h3 className="text-[11px] font-medium text-ink">Media details</h3>
            <dl className="mt-3 space-y-3 text-[10px]">
              {[
                ["Size", formatBytes(artifact.byte_size)],
                ["Duration", duration],
                ["Dimensions", dimensions],
                ["Codec", codec || null],
                ["Format", artifact.mime_type],
                ["Imported", new Date(artifact.created_at).toLocaleString()],
              ].map(([label, value]) =>
                value ? (
                  <div key={label} className="border-b border-line-subtle pb-2">
                    <dt className="text-ink-caption">{label}</dt>
                    <dd className="mt-0.5 break-words text-ink-secondary">
                      {value}
                    </dd>
                  </div>
                ) : null,
              )}
            </dl>
            <div className="mt-4">
              <p className="text-[10px] text-ink-caption">
                Managed project file
              </p>
              <button
                type="button"
                title={filePath}
                onClick={() => {
                  void navigator.clipboard.writeText(filePath).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  });
                }}
                className="mt-1 flex w-full items-start gap-2 rounded-md border border-line bg-surface-sunken p-2 text-left hover:border-line-strong"
              >
                <span className="min-w-0 flex-1 break-all font-mono text-[8px] leading-4 text-ink-secondary">
                  {filePath}
                </span>
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={onAttach}
                className={cx(
                  "flex h-9 items-center justify-center gap-2 rounded-md text-[11px] font-medium",
                  attached
                    ? "border border-action/25 bg-action-soft text-action"
                    : "bg-control text-control-ink hover:bg-control-hover",
                )}
              >
                {attached ? <Check size={13} /> : <Plus size={13} />}
                {attached ? "Added to AI" : "Add to AI"}
              </button>
              <a
                href={greenlightApi.artifactUrl(artifact.id)}
                target="_blank"
                rel="noreferrer"
                className="flex h-9 items-center justify-center gap-2 rounded-md border border-line text-[11px] text-ink-secondary hover:bg-hover hover:text-ink"
              >
                <ExternalLink size={13} /> Open original
              </a>
            </div>
          </aside>
        </div>
      </article>
    </div>
  );
};

export const MediaBrowser = ({
  projectId,
  artifacts,
  attachedArtifactIds,
  importing,
  importError,
  workspacePath,
  onSelectArtifact,
  onImport,
  onPlaceLibraryAsset,
  onApplySoundEffect,
  onApplyTransition,
  onPreviewTransition,
  previewTransitionPreset,
  onCollapse,
}: {
  projectId: string;
  artifacts: Artifact[];
  attachedArtifactIds: string[];
  importing: boolean;
  importError: string | null;
  workspacePath: string | null;
  onSelectArtifact: (artifactId: string) => void;
  onImport: (files: File[]) => void;
  onPlaceLibraryAsset: (input: PlacedLibraryAsset) => Promise<void> | void;
  onApplySoundEffect: (input: {
    artifact: Artifact;
    durationSeconds: number;
    presetId: SoundEffectPresetId;
  }) => Promise<void> | void;
  onApplyTransition: (preset: TransitionPresetId) => Promise<void> | void;
  onPreviewTransition: (preset: TransitionPresetId | null) => void;
  previewTransitionPreset: TransitionPresetId | null;
  onCollapse: () => void;
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [effectsOpen, setEffectsOpen] = useState(false);
  const [loadedFacts, setLoadedFacts] = useState<Record<string, MediaFacts>>(
    {},
  );
  const media = artifacts.filter(
    (artifact) =>
      artifact.provenance.source === "local_import" ||
      artifact.provenance.source === "media_library",
  );
  const openArtifact =
    media.find((artifact) => artifact.id === openArtifactId) ?? null;
  const factsFor = (artifact: Artifact) => ({
    ...storedFacts(artifact),
    ...loadedFacts[artifact.id],
  });
  const rememberFacts = (artifactId: string, facts: MediaFacts) =>
    setLoadedFacts((current) => ({
      ...current,
      [artifactId]: { ...current[artifactId], ...facts },
    }));

  return (
    <aside className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b border-line-subtle px-3">
        <span className="text-[12px] font-medium text-ink">Media</span>
        <span className="text-[9px] text-ink-caption">{media.length}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={MEDIA_ACCEPT}
            className="sr-only"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              if (files.length > 0) onImport(files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            className="flex h-8 items-center gap-1.5 rounded-md bg-control px-3 text-[11px] font-medium text-control-ink hover:bg-control-hover disabled:opacity-45"
          >
            <Plus size={13} /> {importing ? "Adding…" : "Add media"}
          </button>
          <button
            type="button"
            aria-label="Open licensed media library"
            title="Licensed media library"
            onClick={() => setLibraryOpen(true)}
            className="grid size-8 place-items-center rounded-full border border-line text-ink-secondary hover:bg-hover hover:text-ink"
          >
            <Library size={13} />
          </button>
          <button
            type="button"
            aria-label="Open transitions and sound effects"
            title="Transitions and sound effects"
            onClick={() => setEffectsOpen(true)}
            className="grid size-8 place-items-center rounded-full border border-line text-ink-secondary hover:bg-hover hover:text-ink"
          >
            <Sparkles size={13} />
          </button>
          <IconButton
            Icon={PanelLeftClose}
            label="Collapse media"
            size="sm"
            onClick={onCollapse}
          />
        </div>
      </div>

      <div className="scroll-stable min-h-0 flex-1 overflow-y-auto p-3">
        {importError ? (
          <p className="mb-3 border-l-2 border-warning bg-warning-soft px-2.5 py-2 text-[10px] leading-4 text-warning">
            {importError}
          </p>
        ) : null}

        {media.length > 0 ? (
          <div className="grid gap-3">
            {media.map((artifact) => {
              const label = labelFor(artifact);
              const attached = attachedArtifactIds.includes(artifact.id);
              const facts = factsFor(artifact);
              const secondary = [
                formatBytes(artifact.byte_size),
                formatDuration(facts.duration),
                facts.width && facts.height
                  ? `${facts.width}×${facts.height}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <article
                  key={artifact.id}
                  data-testid={`media-${artifact.id}`}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(
                      MEDIA_ARTIFACT_MIME,
                      artifact.id,
                    );
                  }}
                  className={cx(
                    "group min-w-0 overflow-hidden rounded-md border bg-surface transition-colors",
                    attached
                      ? "border-action"
                      : "border-line hover:border-line-strong",
                  )}
                >
                  <button
                    type="button"
                    title={`Open ${label}`}
                    onClick={() => setOpenArtifactId(artifact.id)}
                    className="block w-full text-left"
                  >
                    <span className="grid aspect-video place-items-center overflow-hidden bg-surface-sunken p-2">
                      <MediaPreview
                        artifact={artifact}
                        onFacts={(next) => rememberFacts(artifact.id, next)}
                      />
                    </span>
                    <span className="block border-t border-line-subtle px-2.5 py-2">
                      <span className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 text-ink-caption">
                          <MediaKindIcon artifact={artifact} />
                        </span>
                        <span className="min-w-0 flex-1 break-words text-[11px] font-medium leading-4 text-ink-secondary">
                          {label}
                        </span>
                      </span>
                      <span className="mt-1 block text-[9px] text-ink-caption">
                        {secondary}
                      </span>
                    </span>
                  </button>
                  <div className="flex justify-end border-t border-line-subtle px-2.5 py-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectArtifact(artifact.id)}
                      className={cx(
                        "flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[10px] font-medium",
                        attached
                          ? "bg-action-soft text-action"
                          : "text-ink-tertiary hover:bg-hover hover:text-ink",
                      )}
                    >
                      {attached ? <Check size={11} /> : <Plus size={11} />}
                      {attached ? "Added to AI" : "Add to AI"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-strong bg-surface text-[11px] text-ink-tertiary hover:border-action hover:text-action"
          >
            <Upload size={17} />
            <span className="font-medium">Add your first media</span>
            <span className="text-[9px] text-ink-caption">
              Video, audio, image, or captions
            </span>
          </button>
        )}
      </div>

      {openArtifact ? (
        <MediaViewer
          artifact={openArtifact}
          facts={factsFor(openArtifact)}
          workspacePath={workspacePath}
          attached={attachedArtifactIds.includes(openArtifact.id)}
          onFacts={(next) => rememberFacts(openArtifact.id, next)}
          onAttach={() => onSelectArtifact(openArtifact.id)}
          onClose={() => setOpenArtifactId(null)}
        />
      ) : null}
      <MediaLibraryDialog
        open={libraryOpen}
        projectId={projectId}
        onClose={() => setLibraryOpen(false)}
        onPlace={onPlaceLibraryAsset}
      />
      <EffectsLibraryDialog
        open={effectsOpen}
        projectId={projectId}
        previewPreset={previewTransitionPreset}
        onApplySound={onApplySoundEffect}
        onApplyTransition={onApplyTransition}
        onPreviewTransition={(preset) => {
          onPreviewTransition(preset);
          if (preset) setEffectsOpen(false);
        }}
        onClose={() => {
          onPreviewTransition(null);
          setEffectsOpen(false);
        }}
      />
    </aside>
  );
};
