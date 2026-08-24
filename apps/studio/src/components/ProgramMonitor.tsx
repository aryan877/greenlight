import type { Artifact, Scene } from "@greenlight/contracts";
import {
  Maximize2,
  Pause,
  Play,
  PanelBottomClose,
  Volume2,
  VolumeX,
} from "lucide-react";
import { type CSSProperties, useRef } from "react";

import { greenlightApi } from "../api/greenlight.js";
import type { useMediaController } from "../editor/use-media-controller.js";
import { formatTime } from "../editor/model.js";
import { cx, IconButton } from "./controls.js";

type MediaController = ReturnType<typeof useMediaController>;

const SceneCanvas = ({
  scene,
  artifacts,
}: {
  scene: Scene;
  artifacts: Artifact[];
}) => {
  const visuals = scene.visual.artifact_ids.slice(0, 4);
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  return (
    <div className="relative size-full overflow-hidden bg-white">
      {visuals.length > 0 ? (
        <div
          className={cx(
            "absolute right-[7%] top-1/2 grid h-[56%] w-[40%] -translate-y-1/2 gap-[5%]",
            visuals.length === 1 ? "grid-cols-1" : "grid-cols-2",
          )}
        >
          {visuals.map((visual) => (
            <div
              key={visual}
              className="grid min-h-0 place-items-center rounded-[7%] bg-[#ecf2ef] p-[9%]"
            >
              {byId.get(visual)?.mime_type.startsWith("video/") ? (
                <video
                  src={greenlightApi.artifactUrl(visual)}
                  muted
                  loop
                  autoPlay
                  playsInline
                  className="size-full object-cover"
                />
              ) : (
                <img
                  src={greenlightApi.artifactUrl(visual)}
                  alt=""
                  className="size-full object-contain"
                />
              )}
            </div>
          ))}
        </div>
      ) : null}
      <div
        className={cx(
          "absolute inset-0 flex items-center p-[7%]",
          visuals.length > 0 && "pr-[50%]",
        )}
      >
        <h1 className="max-w-[880px] text-[clamp(24px,4.6vw,68px)] font-semibold leading-[0.98] tracking-[-0.05em] text-ink">
          {scene.title}
        </h1>
      </div>
      <div className="absolute inset-x-[8%] bottom-[5%] flex justify-center">
        <span className="max-w-[88%] rounded-lg bg-black/88 px-3 py-2 text-center text-[clamp(9px,1vw,14px)] font-medium leading-snug text-white">
          {scene.narration}
        </span>
      </div>
    </div>
  );
};

export const ProgramMonitor = ({
  scene,
  artifacts,
  video,
  media,
  timelineOpen,
  previewing,
  previewUsesCanvas,
  onToggleTimeline,
}: {
  scene: Scene | null;
  artifacts: Artifact[];
  video: Artifact | null;
  media: MediaController;
  timelineOpen: boolean;
  previewing: boolean;
  previewUsesCanvas: boolean;
  onToggleTimeline: () => void;
}) => {
  const monitorRef = useRef<HTMLElement>(null);
  return (
    <section
      ref={monitorRef}
      className="flex min-h-0 flex-1 flex-col bg-canvas"
    >
      <div className="flex h-10 shrink-0 items-center border-b border-line-subtle bg-surface px-2.5">
        <span className="px-1.5 text-[12px] font-medium text-ink">Program</span>
        {previewing ? (
          <span className="ml-2 rounded-md bg-warning-soft px-2 py-1 text-[9px] font-medium text-warning">
            Preview
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            Icon={Maximize2}
            label="Full screen monitor"
            size="sm"
            onClick={() => void monitorRef.current?.requestFullscreen()}
          />
          <IconButton
            Icon={PanelBottomClose}
            label={timelineOpen ? "Collapse timeline" : "Open timeline"}
            active={!timelineOpen}
            size="sm"
            onClick={onToggleTimeline}
          />
        </div>
      </div>

      <div className="monitor-viewport grid min-h-0 flex-1 place-items-center overflow-hidden p-5 xl:p-7">
        <div className="monitor-frame bg-white">
          {video && !previewUsesCanvas ? (
            <video
              ref={media.mediaRef}
              src={greenlightApi.artifactUrl(video.id)}
              className="block size-full bg-white object-contain"
              playsInline
              {...media.mediaEvents}
            />
          ) : scene ? (
            <SceneCanvas scene={scene} artifacts={artifacts} />
          ) : (
            <div className="grid size-full place-items-center text-[12px] text-ink-tertiary">
              No scene selected
            </div>
          )}
        </div>
      </div>

      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-line-subtle bg-surface px-3">
        <IconButton
          Icon={media.playing ? Pause : Play}
          label={media.playing ? "Pause" : "Play"}
          disabled={!video}
          onClick={() => void media.togglePlay()}
        />
        <span className="w-20 font-mono text-[10px] text-ink-secondary">
          {formatTime(media.currentTime)}
        </span>
        <input
          aria-label="Program position"
          type="range"
          min={0}
          max={Math.max(media.duration, 0.01)}
          step={0.01}
          value={Math.min(media.currentTime, media.duration || 0)}
          style={
            {
              "--range-progress": `${media.duration > 0 ? (media.currentTime / media.duration) * 100 : 0}%`,
            } as CSSProperties
          }
          disabled={!video}
          onPointerDown={media.beginScrub}
          onInput={(event) =>
            media.previewSeek(Number(event.currentTarget.value))
          }
          onPointerUp={(event) =>
            media.endScrub(Number(event.currentTarget.value))
          }
          onPointerCancel={(event) =>
            media.endScrub(Number(event.currentTarget.value))
          }
          onKeyUp={(event) => media.endScrub(Number(event.currentTarget.value))}
          onChange={(event) =>
            media.previewSeek(Number(event.currentTarget.value))
          }
          className="precision-range min-w-0 flex-1 disabled:opacity-30"
        />
        <span className="w-20 text-right font-mono text-[10px] text-ink-caption">
          {formatTime(media.duration)}
        </span>
        <IconButton
          Icon={media.muted ? VolumeX : Volume2}
          label={media.muted ? "Unmute" : "Mute"}
          disabled={!video}
          onClick={media.toggleMute}
        />
        <input
          aria-label="Program volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={media.volume}
          style={
            { "--range-progress": `${media.volume * 100}%` } as CSSProperties
          }
          disabled={!video}
          onChange={(event) => media.updateVolume(Number(event.target.value))}
          className="precision-range w-20 disabled:opacity-30"
        />
      </div>
    </section>
  );
};
