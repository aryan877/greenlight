import type { AudioTrack, Scene } from "@greenlight/contracts";
import {
  Captions,
  Download,
  Layers3,
  Mic2,
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
  onEditorCommand,
  scenes,
}: {
  audioTracks: AudioTrack[];
  height: number;
  onEditorCommand: (sceneIds: string[], instruction: string) => void;
  scenes: Scene[];
}) => (
  <div
    className="sticky left-0 top-0 z-40 w-36 border-r border-line-subtle bg-surface"
    style={{ height }}
  >
    <div className="flex h-7 items-center justify-between border-b border-line-subtle px-2.5 text-[9px] font-medium text-ink-tertiary">
      <span>Tracks</span>
      <IconButton
        Icon={Plus}
        label="Add an audio track with Producer"
        size="sm"
        onClick={() =>
          onEditorCommand(
            scenes.map((scene) => scene.id),
            "Add one named audio track for this production. Ask which role, locale, and voice I want if they are not clear. Keep it as scene-sized clips aligned to the existing cut and show the track patch before generating media.",
          )
        }
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
              onEditorCommand(
                sceneIds,
                `Set audio track ${track.id} (${track.name}) muted to ${String(!track.muted)}. Change only that track setting and show the preview before applying it.`,
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
            title={
              track.solo ? `Clear solo on ${track.name}` : `Solo ${track.name}`
            }
            aria-label={
              track.solo ? `Clear solo on ${track.name}` : `Solo ${track.name}`
            }
            onClick={() =>
              onEditorCommand(
                sceneIds,
                `Set audio track ${track.id} (${track.name}) solo to ${String(!track.solo)}. Change only that track setting and show the preview before applying it.`,
              )
            }
          >
            S
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
              onEditorCommand(
                sceneIds,
                `Set audio track ${track.id} (${track.name}) export_enabled to ${String(!track.export_enabled)}. Change only that track setting and show the preview before applying it.`,
              )
            }
          >
            <Download size={10} />
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
