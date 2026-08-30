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
  CalendarClock,
  Check,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
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
  onChange,
  onApprovePublicRelease,
  onCancelPublicRelease,
  onGenerateThumbnails,
  onPrepare,
  onSchedule,
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
  onChange: (operation: ReleaseOperation, summary: string) => void;
  onApprovePublicRelease: () => void;
  onCancelPublicRelease: () => void;
  onGenerateThumbnails: () => void;
  onPrepare: () => void;
  onSchedule: (publishAt: string) => void;
  publicApprovalPending: boolean;
  qualityReport: QualityReport | null;
  releasePrivacy: string | null;
  releaseStudioUrl: string | null;
  video: Artifact | null;
}) => {
  const [title, setTitle] = useState(content.metadata.title);
  const [description, setDescription] = useState(content.metadata.description);
  const [tags, setTags] = useState(content.metadata.tags.join(", "));
  const [checksOpen, setChecksOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [publishAt, setPublishAt] = useState(
    toLocalInput(content.release.publish_at),
  );
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const thumbnails = useMemo(
    () => artifacts.filter((artifact) => artifact.kind === "thumbnail"),
    [artifacts],
  );
  const candidateThumbnails = useMemo(() => {
    const ids = [
      ...new Set(content.release.thumbnail_candidate_artifact_ids ?? []),
    ];
    return ids
      .flatMap((id) => {
        const artifact = thumbnails.find((candidate) => candidate.id === id);
        return artifact ? [artifact] : [];
      })
      .slice(0, 3);
  }, [content.release.thumbnail_candidate_artifact_ids, thumbnails]);
  const selectedThumbnailId = content.release.thumbnail_artifact_id;

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
  const metadataReady =
    content.metadata.title.trim().length > 0 &&
    content.metadata.description.trim().length > 0 &&
    content.metadata.tags.length > 0;
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
    {
      label: "Black frames",
      ready: checkByName.get("unexpected_black_frames")?.passed ?? false,
    },
    { label: "Metadata", ready: metadataReady },
    { label: "Render", ready: Boolean(video && qualityReport) },
    {
      label: "Disclosure",
      ready: !requiresDisclosure || content.metadata.contains_synthetic_media,
    },
  ];
  const readyCount = readiness.filter((item) => item.ready).length;
  const allReady = readyCount === readiness.length;
  const selectedCandidate = candidateThumbnails.some(
    (candidate) => candidate.id === selectedThumbnailId,
  );
  const stagedForReview =
    releasePrivacy === "private" || releasePrivacy === "unlisted";

  const connectYouTube = async () => {
    setConnecting(true);
    setConnectionError(null);
    try {
      const { authorization_url: authorizationUrl } =
        await greenlightApi.startYouTubeConnection(window.location.pathname);
      window.location.assign(authorizationUrl);
    } catch {
      setConnectionError(
        "Google OAuth is not configured yet. Add the web client credentials, then try again.",
      );
      setConnecting(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between border-b border-line-subtle px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[12px] font-medium text-ink">
              <YouTubeIcon className="size-4" /> YouTube
            </p>
            <p className="mt-0.5 truncate text-[10px] text-ink-tertiary">
              {connection?.connected
                ? connection.channel_title
                : "No channel connected"}
            </p>
          </div>
          {connection?.connected ? (
            <span className="flex items-center gap-1.5 text-[10px] text-success">
              <Check size={12} /> Connected
            </span>
          ) : (
            <button
              type="button"
              disabled={connecting}
              onClick={() => void connectYouTube()}
              className="flex h-8 items-center gap-2 border border-line bg-surface px-3 text-[10px] font-semibold text-ink hover:bg-hover disabled:opacity-50"
            >
              {connecting ? (
                <LoaderCircle size={12} className="animate-spin" />
              ) : (
                <YouTubeIcon className="size-3.5" />
              )}
              Connect YouTube
            </button>
          )}
        </div>
        {connectionError ? (
          <p className="border-b border-line-subtle px-4 py-2 text-[10px] leading-4 text-warning">
            {connectionError}
          </p>
        ) : null}

        <div className="border-b border-line-subtle px-4 py-3">
          <button
            type="button"
            onClick={() => setChecksOpen((open) => !open)}
            className="flex w-full items-center justify-between text-left"
          >
            <span>
              <span className="block text-[11px] font-medium text-ink">
                {allReady ? "Ready to upload" : "Needs attention"}
              </span>
              <span className="mt-0.5 block text-[9px] text-ink-tertiary">
                {readyCount} of {readiness.length} checks passed
              </span>
            </span>
            <ChevronDown
              size={13}
              className={cx(
                "text-ink-caption transition-transform",
                checksOpen && "rotate-180",
              )}
            />
          </button>
          {checksOpen ? (
            <div className="mt-3 grid grid-cols-2 border-l border-t border-line-subtle">
              {readiness.map((item) => (
                <div
                  key={item.label}
                  className="flex h-8 items-center gap-1.5 border-b border-r border-line-subtle px-2 text-[9px] text-ink-secondary"
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
          ) : null}
        </div>

        <div className="border-b border-line-subtle px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium text-ink">Thumbnail</p>
              <p className="mt-0.5 text-[9px] text-ink-tertiary">
                Choose one of three distinct concepts
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={onGenerateThumbnails}
              className="flex h-7 items-center gap-1.5 px-2 text-[9px] font-medium text-action hover:bg-action-soft disabled:opacity-45"
            >
              <Sparkles size={11} />
              {candidateThumbnails.length ? "Regenerate 3" : "Generate 3"}
            </button>
          </div>

          {candidateThumbnails.length ? (
            <div className="grid grid-cols-3 gap-2">
              {candidateThumbnails.map((artifact, index) => {
                const selected = artifact.id === selectedThumbnailId;
                const label = String.fromCharCode(65 + index);
                return (
                  <button
                    key={artifact.id}
                    type="button"
                    aria-label={`Choose thumbnail ${label}`}
                    aria-pressed={selected}
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
                        `Choose thumbnail ${label}`,
                      )
                    }
                    className={cx(
                      "relative overflow-hidden border bg-canvas text-left",
                      selected
                        ? "border-action ring-1 ring-action"
                        : "border-line hover:border-line-strong",
                    )}
                  >
                    <img
                      src={greenlightApi.artifactUrl(artifact.id)}
                      alt={`Thumbnail option ${label}`}
                      className="aspect-video w-full object-cover"
                    />
                    <span className="absolute left-1.5 top-1.5 grid size-5 place-items-center bg-black/80 font-mono text-[9px] text-white">
                      {selected ? <Check size={11} /> : label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onGenerateThumbnails}
              className="grid aspect-[16/5] w-full place-items-center border border-dashed border-line text-[10px] text-ink-tertiary hover:border-action hover:text-action"
            >
              Generate three thumbnail concepts
            </button>
          )}
        </div>

        <details className="border-b border-line-subtle px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-medium text-ink [&::-webkit-details-marker]:hidden">
            YouTube details
            <ChevronDown size={13} className="text-ink-caption" />
          </summary>
          <div className="space-y-3 pt-4">
            <label className="block">
              <span className="text-[9px] text-ink-tertiary">Title</span>
              <input
                value={title}
                maxLength={100}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => {
                  const value = title.trim();
                  if (value && value !== content.metadata.title) {
                    commitMetadata(
                      { title: value },
                      "Update the YouTube title",
                    );
                  }
                }}
                className="mt-1 h-9 w-full border border-line bg-surface px-3 text-[12px] text-ink outline-none focus:border-action"
              />
            </label>
            <label className="block">
              <span className="text-[9px] text-ink-tertiary">Description</span>
              <textarea
                value={description}
                maxLength={5000}
                rows={4}
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
                className="mt-1 w-full resize-y border border-line bg-surface px-3 py-2 text-[11px] leading-5 text-ink outline-none focus:border-action"
              />
            </label>
            <label className="block">
              <span className="text-[9px] text-ink-tertiary">Tags</span>
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                onBlur={() => {
                  const value = tagsFromText(tags);
                  if (value.join("|") !== content.metadata.tags.join("|")) {
                    commitMetadata({ tags: value }, "Update the YouTube tags");
                  }
                }}
                className="mt-1 h-9 w-full border border-line bg-surface px-3 text-[11px] text-ink outline-none focus:border-action"
              />
            </label>
          </div>
        </details>

        <label className="flex items-start gap-2 border-b border-line-subtle px-4 py-3 text-[10px] leading-4 text-ink-secondary">
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

        {stagedForReview ? (
          <div className="px-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-ink">
                  {releasePrivacy === "private"
                    ? "Private review is live"
                    : "Unlisted review is live"}
                </p>
                <p className="mt-0.5 text-[9px] text-ink-tertiary">
                  {releasePrivacy === "private"
                    ? "Google is enforcing private staging until this API project is audited."
                    : "Review it before making it public."}
                </p>
              </div>
              {releaseStudioUrl ? (
                <a
                  href={releaseStudioUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[9px] text-action hover:underline"
                >
                  Open Studio <ExternalLink size={10} />
                </a>
              ) : null}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={onApprovePublicRelease}
                className="h-9 border border-line text-[10px] font-medium text-ink hover:border-action hover:text-action disabled:opacity-45"
              >
                {publicApprovalPending ? "Approve publish" : "Publish…"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setScheduleOpen((open) => !open)}
                className="h-9 border border-line text-[10px] font-medium text-ink hover:border-action hover:text-action disabled:opacity-45"
              >
                Schedule…
              </button>
            </div>
            {publicApprovalPending ? (
              <button
                type="button"
                onClick={onCancelPublicRelease}
                className="mt-2 h-7 w-full text-[9px] text-ink-tertiary hover:bg-hover hover:text-ink"
              >
                Cancel publish request
              </button>
            ) : null}
            {scheduleOpen ? (
              <div className="mt-3 flex items-center gap-2 border border-line p-2">
                <CalendarClock size={13} className="text-ink-tertiary" />
                <input
                  type="datetime-local"
                  value={publishAt}
                  onChange={(event) => setPublishAt(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-[10px] text-ink outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    publishAt && onSchedule(new Date(publishAt).toISOString())
                  }
                  className="h-7 bg-control px-2 text-[9px] font-medium text-control-ink"
                >
                  Review
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {connection?.connected && !releasePrivacy ? (
        <div className="shrink-0 border-t border-line-subtle p-3">
          <button
            type="button"
            disabled={busy || !allReady || !selectedCandidate}
            onClick={onPrepare}
            className="flex h-10 w-full items-center justify-center gap-2 bg-control text-[11px] font-medium text-control-ink hover:bg-control-hover disabled:opacity-45"
          >
            {busy ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <YouTubeIcon className="size-[13px]" />
            )}
            Upload for review
          </button>
          {!selectedCandidate ? (
            <p className="mt-2 text-center text-[9px] text-ink-caption">
              Choose one thumbnail first.
            </p>
          ) : !allReady ? (
            <button
              type="button"
              onClick={onPrepare}
              className="mt-2 w-full text-[9px] text-action hover:underline"
            >
              Ask Producer to finish missing checks
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};
