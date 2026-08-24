import type { Artifact } from "@greenlight/contracts";
import {
  Captions,
  Film,
  Image as ImageIcon,
  Mic2,
  PanelLeftClose,
  Upload,
} from "lucide-react";
import { useRef } from "react";

import { greenlightApi } from "../api/greenlight.js";
import { MEDIA_ACCEPT, MEDIA_ARTIFACT_MIME } from "../editor/media-transfer.js";
import { cx, IconButton } from "./controls.js";

const labelFor = (artifact: Artifact) => {
  const original = artifact.provenance.original_filename;
  return typeof original === "string" && original.trim()
    ? original
    : `Untitled ${artifact.kind}`;
};

const MediaPreview = ({ artifact }: { artifact: Artifact }) => {
  const label = labelFor(artifact);
  if (artifact.kind === "image") {
    return (
      <img
        src={greenlightApi.artifactUrl(artifact.id)}
        alt={label}
        className="size-full object-contain p-2"
      />
    );
  }
  if (artifact.kind === "video") {
    return (
      <video
        src={greenlightApi.artifactUrl(artifact.id)}
        muted
        preload="metadata"
        className="size-full object-cover"
      />
    );
  }
  if (artifact.kind === "narration") {
    return <Mic2 size={20} className="text-track-voice-strong" />;
  }
  return <Captions size={20} className="text-track-caption-strong" />;
};

const MediaKindIcon = ({ artifact }: { artifact: Artifact }) => {
  if (artifact.kind === "image") return <ImageIcon size={10} />;
  if (artifact.kind === "video") return <Film size={10} />;
  if (artifact.kind === "narration") return <Mic2 size={10} />;
  return <Captions size={10} />;
};

export const MediaBrowser = ({
  artifacts,
  attachedArtifactIds,
  importing,
  importError,
  onSelectArtifact,
  onImport,
  onCollapse,
}: {
  artifacts: Artifact[];
  attachedArtifactIds: string[];
  importing: boolean;
  importError: string | null;
  onSelectArtifact: (artifactId: string) => void;
  onImport: (files: File[]) => void;
  onCollapse: () => void;
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const media = artifacts.filter(
    (artifact) => artifact.provenance.source === "local_import",
  );

  return (
    <aside className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex h-10 shrink-0 items-center gap-0.5 overflow-hidden border-b border-line-subtle px-2">
        <span className="px-2 text-[10px] font-medium text-ink">Media</span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
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
          <IconButton
            Icon={Upload}
            label={importing ? "Importing media" : "Import media"}
            size="sm"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          />
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
          <p className="mb-3 border-l-2 border-warning bg-warning-soft px-2.5 py-2 text-[9px] leading-4 text-warning">
            {importError}
          </p>
        ) : null}

        {media.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {media.map((artifact) => {
              const label = labelFor(artifact);
              const attached = attachedArtifactIds.includes(artifact.id);
              return (
                <button
                  type="button"
                  key={artifact.id}
                  data-testid={`media-${artifact.id}`}
                  draggable
                  title={`${label} · drag into Producer`}
                  aria-pressed={attached}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(
                      MEDIA_ARTIFACT_MIME,
                      artifact.id,
                    );
                  }}
                  onClick={() => onSelectArtifact(artifact.id)}
                  className={cx(
                    "group min-w-0 overflow-hidden rounded-md border bg-surface text-left transition-colors",
                    attached
                      ? "border-action ring-1 ring-action/20"
                      : "border-line hover:border-line-strong",
                  )}
                >
                  <span className="grid aspect-[4/3] place-items-center overflow-hidden bg-surface-sunken">
                    <MediaPreview artifact={artifact} />
                  </span>
                  <span className="flex h-7 items-center gap-1.5 border-t border-line-subtle px-2 text-ink-caption">
                    <MediaKindIcon artifact={artifact} />
                    <span className="truncate text-[9px] text-ink-secondary">
                      {label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-20 w-full items-center justify-center gap-2 border border-dashed border-line-strong text-[10px] text-ink-tertiary hover:border-action hover:text-action"
          >
            <Upload size={13} /> Import media
          </button>
        )}
      </div>
    </aside>
  );
};
