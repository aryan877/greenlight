import type { AudioTrack, Scene } from "@greenlight/contracts";
import {
  Captions,
  Headphones,
  Layers3,
  Mic2,
  PackageCheck,
  PackageX,
  Plus,
  Volume2,
  VolumeX,
} from "lucide-react";

import { cx, IconButton } from "./controls.js";

const affectedSceneIds = (track: AudioTrack, scenes: Scene[]) => {
  const ids = [...new Set(track.clips.map((clip) => clip.scene_id))];
  return ids.length > 0 ? ids : scenes.map((scene) => scene.id);
};

export const AudioTrackRail = ({
  audioTracks,
  height,
  onChangeTrack,
  onRequestTrack,
  scenes,
}: {
  audioTracks: AudioTrack[];
  height: number;
  onChangeTrack: (
    sceneIds: string[],
    track: AudioTrack,
    summary: string,
  ) => void;
  onRequestTrack: () => void;
  scenes: Scene[];
}) => (
  <div
    className="sticky left-3 top-0 z-40 w-36 border-x border-line-subtle bg-surface"
    style={{ height }}
  >
    <div className="flex h-7 items-center justify-between border-b border-line-subtle px-2.5 text-[9px] font-medium text-ink-tertiary">
      <span>Tracks</span>
      <IconButton
        Icon={Plus}
        label="Add an audio track"
        size="sm"
        onClick={onRequestTrack}
      />
    </div>
    <div className="flex h-8 items-center gap-2 border-b border-line-subtle px-2.5 text-[9px] font-medium">
      <Layers3 size={11} className="text-track-video-strong" />
      <span className="truncate">Video</span>
    </div>
    {audioTracks.map((track) => {
      const sceneIds = affectedSceneIds(track, scenes);
      return (
        <div
          key={track.id}
          className="flex h-8 items-center gap-1 border-b border-line-subtle px-2 text-[9px]"
        >
          <Mic2 size={11} className="shrink-0 text-track-voice-strong" />
          <span className="min-w-0 flex-1 truncate" title={track.name}>
            {track.name}
          </span>
          <button
            type="button"
            className={cx(
              "grid size-5 shrink-0 place-items-center text-[8px] font-medium hover:bg-surface-sunken",
              track.muted && "bg-track-voice text-track-voice-strong",
            )}
            title={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
            aria-label={
              track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`
            }
            onClick={() =>
              onChangeTrack(
                sceneIds,
                { ...track, muted: !track.muted },
                track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`,
              )
            }
          >
            {track.muted ? <VolumeX size={10} /> : <Volume2 size={10} />}
          </button>
          <button
            type="button"
            className={cx(
              "grid size-5 shrink-0 place-items-center text-[8px] font-semibold hover:bg-surface-sunken",
              track.solo && "bg-track-voice text-track-voice-strong",
            )}
            title={track.solo ? `Hear every track` : `Hear only ${track.name}`}
            aria-label={
              track.solo ? `Hear every track` : `Hear only ${track.name}`
            }
            onClick={() =>
              onChangeTrack(
                sceneIds,
                { ...track, solo: !track.solo },
                track.solo ? `Hear every track` : `Hear only ${track.name}`,
              )
            }
          >
            <Headphones size={10} />
          </button>
          <button
            type="button"
            className={cx(
              "grid size-5 shrink-0 place-items-center hover:bg-surface-sunken",
              !track.export_enabled && "text-ink-caption opacity-45",
            )}
            title={
              track.export_enabled
                ? `Exclude ${track.name} from export`
                : `Include ${track.name} in export`
            }
            aria-label={
              track.export_enabled
                ? `Exclude ${track.name} from export`
                : `Include ${track.name} in export`
            }
            onClick={() =>
              onChangeTrack(
                sceneIds,
                { ...track, export_enabled: !track.export_enabled },
                track.export_enabled
                  ? `Exclude ${track.name} from export`
                  : `Include ${track.name} in export`,
              )
            }
          >
            {track.export_enabled ? (
              <PackageCheck size={10} />
            ) : (
              <PackageX size={10} />
            )}
          </button>
        </div>
      );
    })}
    <div className="flex h-8 items-center gap-2 border-b border-line-subtle px-2.5 text-[9px] font-medium">
      <Captions size={11} className="text-track-caption-strong" />
      <span className="truncate">Captions</span>
    </div>
  </div>
);
