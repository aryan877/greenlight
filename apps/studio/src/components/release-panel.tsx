import type {
  Artifact,
  ContentPackage,
  EditorPatchOperation,
  EvidenceLedger,
  QualityReport,
} from "@greenlight/contracts";
import {
  audibleAudioTracks,
  effectiveCaptionTracks,
} from "@greenlight/contracts";
import {
  CircleAlert,
  CalendarClock,
  Check,
  ChevronDown,
  ExternalLink,
  Image as ImageIcon,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { greenlightApi, type YouTubeConnection } from "../api/greenlight.js";
import { YouTubeIcon } from "../brand-icons.js";
import { cx } from "./controls.js";

type ReleaseOperation = Extract<
  EditorPatchOperation,
  { type: "update_release" }
>;

const tagsFromText = (value: string) =>
  [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ].slice(0, 30);

const artifactName = (artifact: Artifact) => {
  const original = artifact.provenance.original_filename;
  if (typeof original === "string" && original.trim()) return original;
  if (artifact.kind === "thumbnail") return "Rendered thumbnail";
  return artifact.relative_path.split("/").at(-1) ?? "thumbnail";
};

const tomorrowAtTen = () => {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(10, 0, 0, 0);
  return next;
};

const toLocalInput = (value: string | null) => {
  const date = value ? new Date(value) : tomorrowAtTen();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export const ReleasePanel = ({
  artifacts,
  busy,
  connection,
  content,
  evidence,
  latestThumbnail,
  onChange,
  onApprovePublicRelease,
  onCancelPublicRelease,
  onPrepare,
  onGenerateThumbnails,
  publicApprovalPending,
  qualityReport,
  releasePrivacy,
  releaseStudioUrl,
  video,
}: {
  artifacts: Artifact[];
  busy: boolean;
  connection: YouTubeConnection | null;
  content: ContentPackage;
  evidence: EvidenceLedger | null;
  latestThumbnail: Artifact | null;
  onChange: (operation: ReleaseOperation, summary: string) => void;
  onApprovePublicRelease: () => void;
  onCancelPublicRelease: () => void;
  onPrepare: () => void;
  onGenerateThumbnails: () => void;
  publicApprovalPending: boolean;
  qualityReport: QualityReport | null;
  releasePrivacy: string | null;
  releaseStudioUrl: string | null;
  video: Artifact | null;
}) => {
  const [title, setTitle] = useState(content.metadata.title);
  const [description, setDescription] = useState(content.metadata.description);
  const [tags, setTags] = useState(content.metadata.tags.join(", "));
  const [choosingThumbnail, setChoosingThumbnail] = useState(false);
  const thumbnails = useMemo(
    () => artifacts.filter((artifact) => artifact.kind === "thumbnail"),
    [artifacts],
  );
  const selectedThumbnail =
    artifacts.find(
      (artifact) => artifact.id === content.release.thumbnail_artifact_id,
    ) ?? null;
  const storedCandidateIds =
    content.release.thumbnail_candidate_artifact_ids ?? [];
  const candidateThumbnails = (
    storedCandidateIds.length > 0
      ? storedCandidateIds.flatMap((id) => {
          const artifact = thumbnails.find((candidate) => candidate.id === id);
          return artifact ? [artifact] : [];
        })
      : thumbnails.slice(-3).reverse()
  ).slice(0, 3);
  const displayedThumbnail =
    selectedThumbnail ?? candidateThumbnails[0] ?? latestThumbnail;

  useEffect(() => setTitle(content.metadata.title), [content.metadata.title]);
  useEffect(
    () => setDescription(content.metadata.description),
    [content.metadata.description],
  );
  useEffect(
    () => setTags(content.metadata.tags.join(", ")),
    [content.metadata.tags],
  );

  const commitMetadata = (
    metadata: NonNullable<ReleaseOperation["metadata"]>,
    summary: string,
  ) => onChange({ type: "update_release", metadata }, summary);

  const destination = content.release.destination;
  const isPublicRelease =
    releasePrivacy === "unlisted" && destination === "public";
  const status = releasePrivacy ?? "draft";
  const checkByName = new Map(
    qualityReport?.checks.map((check) => [check.name, check]) ?? [],
  );
  const referencedClaimIds = new Set(
    content.scenes.flatMap((scene) => scene.claim_ids),
  );
  const evidenceReady =
    referencedClaimIds.size > 0 &&
    [...referencedClaimIds].every(
      (claimId) =>
        evidence?.claims.find((claim) => claim.id === claimId)?.status ===
        "supported",
    );
  const hasTimedCaptions = effectiveCaptionTracks(content).some(
    (track) =>
      track.visible &&
      track.clips.length > 0 &&
      track.clips.every((clip) => Boolean(clip.artifact_id)),
  );
  const audibleTracks = audibleAudioTracks(content);
  const spokenAudioNeedsCaptions = audibleTracks.some(
    (track) =>
      (track.role === "narration" || track.role === "dub") &&
      track.clips.some((clip) => Boolean(clip.artifact_id)),
  );
  const captionsReady =
    !spokenAudioNeedsCaptions ||
    (hasTimedCaptions &&
      (!qualityReport || checkByName.get("timed_captions")?.passed === true));
  const hasAudibleAudio = audibleTracks.some((track) =>
    track.clips.some((clip) => Boolean(clip.artifact_id)),
  );
  const audioReady =
    hasAudibleAudio &&
    (!qualityReport ||
      (checkByName.get("audio_stream")?.passed === true &&
        checkByName.get("loudness")?.passed === true));
  const blackFramesReady =
    checkByName.get("unexpected_black_frames")?.passed ?? false;
  const metadataReady =
    content.metadata.title.trim().length > 0 &&
    content.metadata.description.trim().length > 0 &&
    content.metadata.tags.length > 0;
  const renderReady = Boolean(video && qualityReport);
  const requiresDisclosure = artifacts.some(
    (artifact) =>
      ["image", "thumbnail", "narration", "audio"].includes(artifact.kind) &&
      (typeof artifact.provenance.provider === "string" ||
        typeof artifact.provenance.model === "string"),
  );
  const readiness = [
    { label: "Evidence", ready: evidenceReady },
    { label: "Captions", ready: captionsReady },
    { label: "Audio", ready: audioReady },
    { label: "Black frames", ready: blackFramesReady },
    { label: "Metadata", ready: metadataReady },
    { label: "Render", ready: renderReady },
    {
      label: "Disclosure",
      ready: !requiresDisclosure || content.metadata.contains_synthetic_media,
    },
  ];
  const readyCount = readiness.filter((item) => item.ready).length;

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between border-b border-line-subtle pb-3">
          <div>
            <p className="text-[13px] font-medium text-ink">YouTube release</p>
            <p className="mt-0.5 text-[11px] text-ink-tertiary">
              {connection?.connected
                ? connection.channel_title
                : "YouTube channel not connected"}
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-[10px] capitalize text-ink-tertiary">
            {connection?.connected ? (
              <Check size={12} className="text-action" />
            ) : (
              <LockKeyhole size={12} />
            )}
            {status}
          </span>
        </div>

        <div className="border-b border-line-subtle py-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-medium text-ink">
              Release readiness
            </p>
            <span className="font-mono text-[9px] text-ink-tertiary">
              {readyCount}/{readiness.length}
            </span>
          </div>
          <div className="grid grid-cols-2 border-l border-t border-line-subtle">
            {readiness.map((item) => (
              <div
                key={item.label}
                className="flex h-7 items-center gap-1.5 border-b border-r border-line-subtle px-2 text-[9px] text-ink-secondary"
              >
                {item.ready ? (
                  <ShieldCheck size={10} className="text-success" />
                ) : (
                  <CircleAlert size={10} className="text-warning" />
                )}
                {item.label}
              </div>
            ))}
          </div>
          {readyCount < readiness.length ? (
            <button
              type="button"
              onClick={onPrepare}
              className="mt-2 text-[9px] font-medium text-action hover:underline"
            >
              Ask Producer to run missing checks
            </button>
          ) : null}
        </div>

        <div className="border-b border-line-subtle py-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium text-ink">
                Thumbnail test set
              </p>
              <p className="text-[9px] text-ink-caption">
                Up to three watch-time candidates
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onGenerateThumbnails}
                className="flex items-center gap-1 px-2 py-1 text-[9px] font-medium text-action hover:underline"
              >
                <Sparkles size={10} /> Generate 3
              </button>
              <button
                type="button"
                aria-label="Choose thumbnail candidates"
                title="Choose thumbnail candidates"
                onClick={() => setChoosingThumbnail((current) => !current)}
                className="grid size-6 place-items-center text-ink-tertiary hover:bg-hover hover:text-ink"
              >
                <ChevronDown size={11} />
              </button>
            </div>
          </div>
          <div className="aspect-video overflow-hidden rounded-xl bg-canvas">
            {displayedThumbnail ? (
              <img
                src={greenlightApi.artifactUrl(displayedThumbnail.id)}
                alt={
                  selectedThumbnail
                    ? "Selected YouTube thumbnail"
                    : "Current render thumbnail"
                }
                className="size-full object-cover"
              />
            ) : (
              <div className="grid size-full place-items-center text-ink-caption">
                <ImageIcon size={20} />
              </div>
            )}
          </div>
          {displayedThumbnail ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[10px] text-ink-tertiary">
                {artifactName(displayedThumbnail)}
              </p>
              {!selectedThumbnail && latestThumbnail ? (
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      {
                        type: "update_release",
                        release: {
                          thumbnail_artifact_id: latestThumbnail.id,
                        },
                      },
                      "Use the current render thumbnail",
                    )
                  }
                  className="shrink-0 text-[10px] font-medium text-action hover:underline"
                >
                  Use this
                </button>
              ) : null}
            </div>
          ) : null}
          {candidateThumbnails.length > 0 ? (
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {candidateThumbnails.map((artifact, index) => (
                <button
                  type="button"
                  key={artifact.id}
                  onClick={() =>
                    onChange(
                      {
                        type: "update_release",
                        release: {
                          thumbnail_artifact_id: artifact.id,
                          thumbnail_candidate_artifact_ids:
                            candidateThumbnails.map(
                              (candidate) => candidate.id,
                            ),
                        },
                      },
                      `Select thumbnail candidate ${String.fromCharCode(65 + index)}`,
                    )
                  }
                  className={cx(
                    "relative overflow-hidden border bg-canvas",
                    artifact.id === selectedThumbnail?.id
                      ? "border-action ring-1 ring-action"
                      : "border-line hover:border-line-strong",
                  )}
                >
                  <img
                    src={greenlightApi.artifactUrl(artifact.id)}
                    alt={`Thumbnail candidate ${String.fromCharCode(65 + index)}`}
                    className="aspect-video w-full object-cover"
                  />
                  <span className="absolute left-1 top-1 grid size-4 place-items-center bg-black/80 font-mono text-[8px] text-white">
                    {String.fromCharCode(65 + index)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {choosingThumbnail ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {thumbnails.map((artifact) => (
                <button
                  type="button"
                  key={artifact.id}
                  onClick={() => {
                    const nextCandidateIds = [
                      artifact.id,
                      ...candidateThumbnails
                        .map((candidate) => candidate.id)
                        .filter((id) => id !== artifact.id),
                    ].slice(0, 3);
                    onChange(
                      {
                        type: "update_release",
                        release: {
                          thumbnail_artifact_id: artifact.id,
                          thumbnail_candidate_artifact_ids: nextCandidateIds,
                        },
                      },
                      `Add ${artifactName(artifact)} to the thumbnail test set`,
                    );
                    setChoosingThumbnail(false);
                  }}
                  className={cx(
                    "overflow-hidden rounded-xl border border-line bg-canvas text-left hover:border-action",
                    artifact.id === selectedThumbnail?.id && "border-action",
                  )}
                >
                  <img
                    src={greenlightApi.artifactUrl(artifact.id)}
                    alt=""
                    className="aspect-video w-full object-cover"
                  />
                  <span className="block truncate px-2 py-1.5 text-[9px] text-ink-secondary">
                    {artifactName(artifact)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-4 border-b border-line-subtle py-4">
          <label className="block">
            <span className="text-[11px] font-medium text-ink">Title</span>
            <input
              value={title}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                const value = title.trim();
                if (value && value !== content.metadata.title) {
                  commitMetadata({ title: value }, "Update the YouTube title");
                }
              }}
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-action"
            />
            <span className="mt-1 block text-right font-mono text-[9px] text-ink-caption">
              {title.length}/100
            </span>
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-ink">
              Description
            </span>
            <textarea
              value={description}
              maxLength={5000}
              rows={6}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => {
                const value = description.trim();
                if (value && value !== content.metadata.description) {
                  commitMetadata(
                    { description: value },
                    "Update the YouTube description",
                  );
                }
              }}
              className="mt-1.5 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-[12px] leading-5 text-ink outline-none focus:border-action"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-ink">Tags</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              onBlur={() => {
                const value = tagsFromText(tags);
                if (value.join("|") !== content.metadata.tags.join("|")) {
                  commitMetadata({ tags: value }, "Update the YouTube tags");
                }
              }}
              placeholder="agents, video editing, creator tools"
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[12px] text-ink outline-none focus:border-action"
            />
          </label>
        </div>

        <div className="border-b border-line-subtle py-4">
          <p className="mb-2 text-[11px] font-medium text-ink">After review</p>
          <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-line">
            {(["unlisted", "public", "scheduled"] as const).map((option) => (
              <button
                type="button"
                key={option}
                disabled={busy}
                onClick={() => {
                  const publishAt =
                    option === "scheduled"
                      ? new Date(
                          toLocalInput(content.release.publish_at),
                        ).toISOString()
                      : null;
                  onChange(
                    {
                      type: "update_release",
                      release: {
                        destination: option,
                        publish_at: publishAt,
                      },
                    },
                    `Set the release plan to ${option}`,
                  );
                }}
                className={cx(
                  "h-9 border-r border-line text-[10px] capitalize text-ink-tertiary last:border-r-0 hover:bg-hover hover:text-ink",
                  destination === option && "bg-action-soft text-action",
                )}
              >
                {option}
              </button>
            ))}
          </div>
          {destination === "scheduled" ? (
            <label className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2">
              <CalendarClock size={13} className="text-ink-tertiary" />
              <input
                type="datetime-local"
                defaultValue={toLocalInput(content.release.publish_at)}
                onBlur={(event) => {
                  if (!event.target.value) return;
                  onChange(
                    {
                      type: "update_release",
                      release: {
                        destination: "scheduled",
                        publish_at: new Date(event.target.value).toISOString(),
                      },
                    },
                    "Update the release time",
                  );
                }}
                className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none"
              />
            </label>
          ) : null}
          <label className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-ink-secondary">
            <input
              type="checkbox"
              checked={content.metadata.contains_synthetic_media}
              onChange={(event) =>
                commitMetadata(
                  { contains_synthetic_media: event.target.checked },
                  "Update the synthetic media disclosure",
                )
              }
              className="mt-0.5 accent-[var(--color-action)]"
            />
            Disclose synthetic media
          </label>
        </div>

        {releasePrivacy === "unlisted" &&
        connection?.connected &&
        releaseStudioUrl ? (
          <a
            href={releaseStudioUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 flex items-center justify-between text-[11px] text-action hover:underline"
          >
            Open YouTube Studio <ExternalLink size={12} />
          </a>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-line-subtle p-3">
        {isPublicRelease && publicApprovalPending ? (
          <button
            type="button"
            disabled={busy}
            onClick={onCancelPublicRelease}
            className="mb-2 h-8 w-full text-[10px] text-ink-tertiary hover:bg-hover hover:text-ink disabled:opacity-45"
          >
            Cancel public release
          </button>
        ) : null}
        <button
          type="button"
          disabled={
            busy ||
            !connection?.connected ||
            !content.release.thumbnail_artifact_id
          }
          onClick={isPublicRelease ? onApprovePublicRelease : onPrepare}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-control text-[11px] font-medium text-control-ink hover:bg-control-hover disabled:opacity-45"
        >
          {busy ? (
            <LoaderCircle size={13} className="animate-spin" />
          ) : releasePrivacy === "unlisted" ? (
            <YouTubeIcon className="size-[13px]" />
          ) : (
            <LockKeyhole size={13} />
          )}
          {isPublicRelease
            ? publicApprovalPending
              ? "Approve public release"
              : "Request public approval"
            : releasePrivacy === "unlisted"
              ? destination === "scheduled"
                ? "Review schedule"
                : "Open unlisted review"
              : content.release.thumbnail_artifact_id
                ? "Prepare unlisted review"
                : "Choose a thumbnail"}
        </button>
      </div>
    </section>
  );
};
