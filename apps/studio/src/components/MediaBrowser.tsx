import type {
  Artifact,
  ContentPackage,
  EvidenceLedger,
  Scene,
} from "@greenlight/contracts";
import {
  Captions,
  ExternalLink,
  Languages,
  Mic2,
  PanelLeftClose,
  Plus,
} from "lucide-react";

import { greenlightApi } from "../api/greenlight.js";
import { cx, IconButton } from "./controls.js";

const sceneForArtifact = (
  content: ContentPackage | null,
  artifactId: string,
): Scene | null =>
  content?.scenes.find((scene) =>
    [
      ...scene.visual.artifact_ids,
      scene.narration_artifact_id,
      scene.captions_artifact_id,
      scene.transcript_artifact_id,
    ].includes(artifactId),
  ) ?? null;

const visualLabel = (artifact: Artifact, scene: Scene | null) => {
  const annotation = artifact.provenance.annotation;
  if (typeof annotation === "string" && annotation.trim()) return annotation;
  return (
    scene?.title ?? (artifact.kind === "thumbnail" ? "Thumbnail" : "Visual")
  );
};

export const MediaBrowser = ({
  content,
  artifacts,
  sourceLedger,
  activeTab,
  activeLocale,
  onSelectArtifact,
  onTab,
  onLocale,
  onAddLocale,
  onCollapse,
}: {
  content: ContentPackage | null;
  artifacts: Artifact[];
  sourceLedger: EvidenceLedger | null;
  activeTab: "media" | "sources";
  activeLocale: string;
  onSelectArtifact: (artifactId: string) => void;
  onTab: (tab: "media" | "sources") => void;
  onLocale: (locale: string) => void;
  onAddLocale: () => void;
  onCollapse: () => void;
}) => {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const referencedIds = [
    ...new Set(
      content?.scenes.flatMap((scene) => [
        ...scene.visual.artifact_ids,
        ...(scene.narration_artifact_id ? [scene.narration_artifact_id] : []),
        ...(scene.captions_artifact_id ? [scene.captions_artifact_id] : []),
        ...(scene.transcript_artifact_id ? [scene.transcript_artifact_id] : []),
      ]) ?? [],
    ),
  ];
  const current = referencedIds.flatMap((id) => {
    const artifact = byId.get(id);
    return artifact ? [artifact] : [];
  });
  const visuals = current.filter(
    (artifact) => artifact.kind === "image" || artifact.kind === "thumbnail",
  );
  const voices = current.filter((artifact) => artifact.kind === "narration");
  const captions = current.filter((artifact) => artifact.kind === "caption");
  const transcripts = current.filter(
    (artifact) => artifact.kind === "transcript",
  );
  const latestVideo = artifacts
    .filter((artifact) => artifact.kind === "video")
    .at(-1);
  const latestThumbnail = artifacts
    .filter((artifact) => artifact.kind === "thumbnail")
    .at(-1);
  if (
    latestThumbnail &&
    !visuals.some((artifact) => artifact.id === latestThumbnail.id)
  ) {
    visuals.push(latestThumbnail);
  }
  const locales = [
    ...new Set([
      "en",
      ...(content?.localized_narration_tracks?.map((track) => track.locale) ??
        []),
    ]),
  ];

  return (
    <aside className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex h-10 shrink-0 items-center border-b border-line-subtle px-2">
        {(["media", "sources"] as const).map((tab) => (
          <button
            type="button"
            key={tab}
            onClick={() => onTab(tab)}
            className={cx(
              "rounded-lg px-3 py-1.5 text-[11px] capitalize text-ink-tertiary transition-colors hover:text-ink",
              activeTab === tab && "bg-active font-medium text-ink",
            )}
          >
            {tab}
          </button>
        ))}
        <div className="ml-auto">
          <IconButton
            Icon={PanelLeftClose}
            label="Collapse browser"
            size="sm"
            onClick={onCollapse}
          />
        </div>
      </div>

      <div className="scroll-stable min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === "media" ? (
          <div className="space-y-5">
            {latestVideo ? (
              <button
                type="button"
                onClick={() => onSelectArtifact(latestVideo.id)}
                className="group relative block aspect-video w-full overflow-hidden rounded-lg border border-line bg-ink"
              >
                <video
                  src={greenlightApi.artifactUrl(latestVideo.id)}
                  muted
                  preload="metadata"
                  className="size-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                />
                <span className="absolute inset-x-2 bottom-2 rounded-md bg-black/75 px-2 py-1 text-left text-[9px] font-medium text-white">
                  Current cut
                </span>
              </button>
            ) : null}

            {visuals.length > 0 ? (
              <section>
                <h3 className="mb-2 text-[9px] font-medium text-ink-tertiary">
                  Visuals
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {visuals.map((artifact) => {
                    const scene = sceneForArtifact(content, artifact.id);
                    const label = visualLabel(artifact, scene);
                    return (
                      <button
                        type="button"
                        key={artifact.id}
                        onClick={() => onSelectArtifact(artifact.id)}
                        className="group min-w-0 overflow-hidden rounded-lg border border-line bg-surface text-left hover:border-line-strong"
                      >
                        <span className="grid aspect-[4/3] place-items-center overflow-hidden bg-surface-sunken p-2">
                          <img
                            src={greenlightApi.artifactUrl(artifact.id)}
                            alt={label}
                            loading="lazy"
                            className="size-full object-contain transition-transform duration-150 group-hover:scale-[1.03]"
                          />
                        </span>
                        <span className="block truncate px-2 py-1.5 text-[9px] text-ink-secondary">
                          {label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {voices.length > 0 ? (
              <section>
                <h3 className="mb-1 text-[9px] font-medium text-ink-tertiary">
                  Voice
                </h3>
                {voices.map((artifact) => {
                  const scene = sceneForArtifact(content, artifact.id);
                  const voice = artifact.provenance.voice_id;
                  return (
                    <button
                      type="button"
                      key={artifact.id}
                      onClick={() => onSelectArtifact(artifact.id)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-hover"
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-track-voice text-track-voice-strong">
                        <Mic2 size={12} />
                      </span>
                      <span className="min-w-0">
                        <strong className="block truncate text-[9px] font-medium text-ink">
                          {scene?.title ?? "Narration"}
                        </strong>
                        <span className="block text-[8px] text-ink-caption">
                          {typeof voice === "string" ? voice : "Voice"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </section>
            ) : null}

            {captions.length > 0 ? (
              <section>
                <h3 className="mb-1 text-[9px] font-medium text-ink-tertiary">
                  Captions
                </h3>
                {captions.map((artifact) => {
                  const scene = sceneForArtifact(content, artifact.id);
                  return (
                    <button
                      type="button"
                      key={artifact.id}
                      onClick={() => onSelectArtifact(artifact.id)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-hover"
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-track-caption text-track-caption-strong">
                        <Captions size={12} />
                      </span>
                      <span className="truncate text-[9px] text-ink-secondary">
                        {scene?.title ?? "Captions"}
                      </span>
                    </button>
                  );
                })}
              </section>
            ) : null}

            {transcripts.length > 0 ? (
              <section>
                <h3 className="mb-1 text-[9px] font-medium text-ink-tertiary">
                  Transcript
                </h3>
                {transcripts.map((artifact) => {
                  const scene = sceneForArtifact(content, artifact.id);
                  return (
                    <button
                      type="button"
                      key={artifact.id}
                      onClick={() => onSelectArtifact(artifact.id)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-hover"
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-info-soft text-info">
                        <Captions size={12} />
                      </span>
                      <span className="min-w-0">
                        <strong className="block truncate text-[9px] font-medium text-ink">
                          {scene?.title ?? "Timed transcript"}
                        </strong>
                        <span className="block text-[8px] text-ink-caption">
                          Word timing
                        </span>
                      </span>
                    </button>
                  );
                })}
              </section>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1">
            {sourceLedger?.sources.map((source) => (
              <a
                key={source.id}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="flex gap-2.5 rounded-lg px-2 py-2.5 no-underline transition-colors hover:bg-hover"
              >
                <ExternalLink
                  size={12}
                  className="mt-0.5 shrink-0 text-ink-caption"
                />
                <span className="min-w-0">
                  <strong className="block line-clamp-2 text-[10px] font-medium leading-4 text-ink">
                    {source.title}
                  </strong>
                  <span className="mt-0.5 block text-[8px] text-ink-caption">
                    {source.publisher}
                  </span>
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="flex h-11 shrink-0 items-center gap-1 border-t border-line-subtle px-2">
        <Languages size={14} className="ml-1 text-ink-tertiary" />
        {locales.map((locale) => (
          <button
            type="button"
            key={locale}
            onClick={() => onLocale(locale)}
            className={cx(
              "rounded-lg px-2.5 py-1.5 font-mono text-[9px] text-ink-tertiary hover:bg-hover",
              activeLocale === locale && "bg-active text-ink",
            )}
          >
            {locale}
          </button>
        ))}
        <IconButton
          Icon={Plus}
          label="Add language"
          size="sm"
          onClick={onAddLocale}
        />
      </div>
    </aside>
  );
};
