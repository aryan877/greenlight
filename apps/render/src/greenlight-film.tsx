import type { CSSProperties, ReactNode } from "react";

import {
  audioClipDurationSeconds,
  audibleAudioTracks,
  effectiveCaptionTracks,
  effectiveTransitionTracks,
  effectiveVideoTracks,
  sceneStartSeconds,
  type AudioTrack,
  type AudioTrackClip,
  type CaptionTimelineClip,
  type ContentPackage,
  type Scene,
  type TransitionTimelineClip,
  type VideoTimelineClip,
} from "@greenlight/contracts";
import { fitText } from "@remotion/layout-utils";
import { Audio, Video } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  Series,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { accentColor, renderSpec } from "./design";
import { TimedCaptions } from "./captions";
import type { RenderProject } from "./root";

export const FPS = renderSpec.format.fps;
const AUDIO_EDGE_FADE_FRAMES = 2;

const { color, layout, timing, type } = renderSpec;

const lookFilter: Record<NonNullable<Scene["visual"]["look"]>, string> = {
  neutral: "none",
  warm: "saturate(1.08) contrast(1.03) sepia(.08)",
  punchy: "saturate(1.18) contrast(1.12)",
  monochrome: "grayscale(1) contrast(1.08)",
};

export const audioClipRenderPlacement = (
  content: ContentPackage,
  clip: AudioTrackClip,
) => {
  const sceneIndex = content.scenes.findIndex(
    (scene) => scene.id === clip.scene_id,
  );
  const scene = content.scenes[sceneIndex];
  if (!scene || sceneIndex < 0) return null;
  return {
    from: Math.round(
      (clip.timeline_start_seconds ??
        sceneStartSeconds(content.scenes, sceneIndex) +
          clip.start_offset_seconds) * FPS,
    ),
    durationInFrames: Math.max(
      1,
      Math.round(audioClipDurationSeconds(clip, scene) * FPS),
    ),
    scene,
  };
};

export const captionClipRenderPlacement = (clip: CaptionTimelineClip) => ({
  from: Math.round(clip.timeline_start_seconds * FPS),
  durationInFrames: Math.max(1, Math.round(clip.duration_seconds * FPS)),
});

const enterProgress = (frame: number, fps: number): number =>
  interpolate(frame, [0, timing.enterSeconds * fps], [0.35, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const Title = ({
  scene,
  compact = false,
}: {
  scene: Scene;
  compact?: boolean;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = enterProgress(frame, fps);
  const availableWidth = compact ? 920 : layout.contentWidth;
  const measured = fitText({
    text: scene.title,
    withinWidth: availableWidth,
    fontFamily: type.editorial,
    fontWeight: 700,
  }).fontSize;
  const style: CSSProperties = {
    margin: 0,
    maxWidth: availableWidth,
    color: color.ink,
    fontFamily: type.editorial,
    fontSize: Math.max(72, Math.min(compact ? 112 : 142, measured)),
    lineHeight: 0.94,
    letterSpacing: "-0.055em",
    fontWeight: 700,
    transform: `translateY(${(1 - enter) * 34}px)`,
    opacity: enter,
  };
  return <h2 style={style}>{scene.title}</h2>;
};

type TreatmentProps = {
  assetFiles: Record<string, string>;
  scene: Scene;
};

const TypeTreatment = ({ scene }: TreatmentProps) => (
  <div style={{ maxWidth: 1480 }}>
    <Title scene={scene} />
  </div>
);

const QuoteTreatment = ({ scene }: TreatmentProps) => (
  <div
    style={{
      maxWidth: 1420,
      paddingLeft: 44,
      borderLeft: `10px solid ${accentColor(scene.visual.accent)}`,
    }}
  >
    <Title scene={scene} />
  </div>
);

const NumberTreatment = ({ scene }: TreatmentProps) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "1fr 420px",
      alignItems: "center",
      gap: 70,
    }}
  >
    <Title scene={scene} compact />
    <div
      style={{
        display: "grid",
        width: 340,
        height: 340,
        placeItems: "center",
        borderRadius: 90,
        color: color.ink,
        background: accentColor(scene.visual.accent),
        fontFamily: type.editorial,
        fontSize: 190,
        fontWeight: 700,
      }}
    >
      {scene.claim_ids.length}
    </div>
  </div>
);

const TimelineTreatment = ({ scene }: TreatmentProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rows = scene.claim_ids.length > 0 ? scene.claim_ids : ["Ready"];
  return (
    <div style={{ width: 1340 }}>
      <Title scene={scene} />
      <div style={{ display: "flex", gap: 18, marginTop: 64 }}>
        {rows.map((claimId, index) => {
          const reveal = interpolate(
            frame,
            [index * 0.12 * fps, (index * 0.12 + 0.45) * fps],
            [0, 1],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );
          return (
            <div
              key={claimId}
              style={{
                minWidth: 220,
                padding: "18px 22px",
                borderRadius: 14,
                color: color.ink,
                background: color.panel,
                fontFamily: type.technical,
                fontSize: 19,
                opacity: reveal,
                transform: `translateY(${(1 - reveal) * 28}px)`,
              }}
            >
              {claimId.replace(/^claim_/, "").replaceAll("_", " ")}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const OpenMojiTreatment = ({ assetFiles, scene }: TreatmentProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const assets = scene.visual.artifact_ids.flatMap((artifactId) => {
    const file = assetFiles[artifactId];
    return file ? [{ artifactId, file }] : [];
  });
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: assets.length > 0 ? "1fr 610px" : "1fr",
        alignItems: "center",
        gap: 80,
        width: "100%",
      }}
    >
      <Title scene={scene} compact={assets.length > 0} />
      {assets.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: assets.length === 1 ? "1fr" : "1fr 1fr",
            gap: 24,
            alignItems: "center",
          }}
        >
          {assets.map(({ artifactId, file }, index) => {
            const source =
              artifactId === scene.source_clip?.artifact_id
                ? scene.source_clip
                : null;
            const enter = interpolate(
              frame,
              [index * 0.12 * fps, (index * 0.12 + 0.55) * fps],
              [index === 0 ? 0.3 : 0, 1],
              {
                easing: Easing.bezier(0.34, 1.3, 0.64, 1),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            );
            return (
              <div
                key={artifactId}
                style={{
                  display: "grid",
                  aspectRatio: "1",
                  placeItems: "center",
                  borderRadius: 54,
                  background: color.panel,
                  transform: `scale(${0.82 + enter * 0.18}) rotate(${(1 - enter) * -4}deg)`,
                  opacity: enter,
                }}
              >
                {/\.(mp4|mov|webm)$/i.test(file) ? (
                  <Video
                    src={staticFile(file)}
                    muted
                    loop={!source}
                    playbackRate={source ? scene.playback_rate : 1}
                    trimBefore={
                      source ? Math.round(source.in_seconds * fps) : undefined
                    }
                    trimAfter={
                      source ? Math.round(source.out_seconds * fps) : undefined
                    }
                    objectFit="cover"
                    style={{ width: "100%", height: "100%", borderRadius: 54 }}
                  />
                ) : (
                  <Img
                    src={staticFile(file)}
                    style={{
                      width: "72%",
                      height: "72%",
                      objectFit: "contain",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

const treatments = {
  type: TypeTreatment,
  quote: QuoteTreatment,
  number: NumberTreatment,
  timeline: TimelineTreatment,
  image: OpenMojiTreatment,
  openmoji: OpenMojiTreatment,
} satisfies Record<
  Scene["visual"]["treatment"],
  (props: TreatmentProps) => ReactNode
>;

const EditorialScene = ({
  assetFiles,
  scene,
}: {
  assetFiles: Record<string, string>;
  scene: Scene;
}) => {
  const Treatment = treatments[scene.visual.treatment];
  return (
    <AbsoluteFill style={{ background: color.paper, color: color.ink }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 85% 18%, rgba(255,208,103,.34), transparent 32%), radial-gradient(circle at 8% 84%, rgba(77,196,156,.19), transparent 34%)",
        }}
      />
      <AbsoluteFill
        style={{
          padding: `${layout.bodyTop}px ${layout.bodyX}px ${layout.bodyBottom}px`,
          justifyContent: "center",
          filter: lookFilter[scene.visual.look ?? "neutral"],
        }}
      >
        <Treatment assetFiles={assetFiles} scene={scene} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const TrackAudioClip = ({
  clip,
  durationInFrames,
  file,
  scenePlaybackRate,
  track,
  timelineStartFrame,
  narrationWindows,
}: {
  clip: AudioTrackClip;
  durationInFrames: number;
  file: string;
  scenePlaybackRate: number;
  track: AudioTrack;
  timelineStartFrame: number;
  narrationWindows: Array<{ from: number; to: number }>;
}) => {
  const frame = useCurrentFrame();
  const isDucked =
    track.ducking?.enabled &&
    narrationWindows.some(
      (window) =>
        timelineStartFrame + frame >= window.from &&
        timelineStartFrame + frame < window.to,
    );
  const duckingGain = isDucked
    ? 10 ** ((track.ducking?.reduction_db ?? -12) / 20)
    : 1;
  const fadeIn = interpolate(
    frame,
    [0, AUDIO_EDGE_FADE_FRAMES],
    [0, track.gain],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const fadeOut = interpolate(
    frame,
    [durationInFrames - AUDIO_EDGE_FADE_FRAMES, durationInFrames],
    [track.gain, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  return (
    <Audio
      playbackRate={clip.playback_rate * scenePlaybackRate}
      src={staticFile(file)}
      trimBefore={Math.round(clip.source_in_seconds * FPS)}
      trimAfter={
        clip.source_out_seconds === null
          ? undefined
          : Math.round(clip.source_out_seconds * FPS)
      }
      volume={Math.min(fadeIn, fadeOut) * duckingGain}
    />
  );
};

const ProductionAudio = ({
  assetFiles,
  content,
}: Pick<RenderProject, "assetFiles" | "content">) => {
  const narrationWindows = audibleAudioTracks(content)
    .filter((track) => track.role === "narration")
    .flatMap((track) =>
      track.clips.flatMap((clip) => {
        const placement = audioClipRenderPlacement(content, clip);
        return placement
          ? [
              {
                from: placement.from,
                to: placement.from + placement.durationInFrames,
              },
            ]
          : [];
      }),
    );
  return (
    <>
      {audibleAudioTracks(content).flatMap((track) =>
        track.clips.flatMap((clip) => {
          const file = clip.artifact_id ? assetFiles[clip.artifact_id] : null;
          const placement = audioClipRenderPlacement(content, clip);
          if (!file || !placement) return [];
          return [
            <Sequence
              key={`${track.id}:${clip.id}`}
              from={placement.from}
              durationInFrames={placement.durationInFrames}
            >
              <TrackAudioClip
                clip={clip}
                durationInFrames={placement.durationInFrames}
                file={file}
                scenePlaybackRate={placement.scene.playback_rate}
                track={track}
                timelineStartFrame={placement.from}
                narrationWindows={narrationWindows}
              />
            </Sequence>,
          ];
        }),
      )}
    </>
  );
};

const ProductionCaptions = ({
  captionTracks,
  content,
}: Pick<RenderProject, "captionTracks" | "content">) => {
  return (
    <>
      {effectiveCaptionTracks(content).flatMap((track) =>
        track.visible
          ? track.clips.flatMap((clip) => {
              const cues = clip.artifact_id
                ? (captionTracks[clip.artifact_id] ?? null)
                : null;
              const scene = content.scenes.find(
                (candidate) => candidate.id === clip.scene_id,
              );
              if (!cues || !scene) return [];
              const placement = captionClipRenderPlacement(clip);
              return [
                <Sequence
                  key={`${track.id}:${clip.id}`}
                  from={placement.from}
                  durationInFrames={placement.durationInFrames}
                >
                  <TimedCaptions
                    cues={cues}
                    playbackRate={scene.playback_rate}
                  />
                </Sequence>,
              ];
            })
          : [],
      )}
    </>
  );
};

const BrollClip = ({
  clip,
  file,
}: {
  clip: VideoTimelineClip;
  file: string;
}) => (
  <Video
    src={staticFile(file)}
    trimBefore={Math.round(clip.source_in_seconds * FPS)}
    trimAfter={Math.round(clip.source_out_seconds * FPS)}
    playbackRate={clip.playback_rate}
    muted
    style={{
      width: "100%",
      height: "100%",
      objectFit: clip.fit,
      opacity: clip.opacity,
    }}
  />
);

const ProductionVideoOverlays = ({
  assetFiles,
  content,
}: Pick<RenderProject, "assetFiles" | "content">) => (
  <>
    {effectiveVideoTracks(content).flatMap((track) =>
      track.visible
        ? (track.clips ?? []).flatMap((clip) => {
            const file = assetFiles[clip.artifact_id];
            if (!file) return [];
            return [
              <Sequence
                key={`${track.id}:${clip.id}`}
                from={Math.round(clip.timeline_start_seconds * FPS)}
                durationInFrames={Math.max(
                  1,
                  Math.round(clip.duration_seconds * FPS),
                )}
                premountFor={FPS}
              >
                <BrollClip clip={clip} file={file} />
              </Sequence>,
            ];
          })
        : [],
    )}
  </>
);

const TransitionEffect = ({ clip }: { clip: TransitionTimelineClip }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = durationInFrames <= 1 ? 1 : frame / (durationInFrames - 1);
  const peak = 1 - Math.abs(progress * 2 - 1);
  const intensity = clip.parameters.intensity ?? 0.75;
  const direction = clip.parameters.direction ?? "left";
  const axis = direction === "left" || direction === "right" ? "X" : "Y";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const isLight = clip.preset_id === "light_flash";
  const isDark = clip.preset_id === "dip_to_black";
  const isBlur = clip.preset_id === "blur_dissolve";
  const isMotion = ["push", "slide", "zoom_through", "whip"].includes(
    clip.preset_id,
  );
  const isGlitch = clip.preset_id === "glitch";
  const background = isLight
    ? (clip.parameters.color ?? "#ffffff")
    : isDark
      ? (clip.parameters.color ?? "#000000")
      : isGlitch
        ? `linear-gradient(90deg, rgba(255,0,92,${peak * 0.42}), rgba(0,255,220,${peak * 0.42}))`
        : "#000000";
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        background,
        opacity:
          clip.preset_id === "clean_cut"
            ? 0
            : peak * intensity * (isDark || isLight ? 1 : 0.42),
        backdropFilter: isBlur
          ? `blur(${peak * (clip.parameters.blur ?? 28)}px)`
          : undefined,
        transform: isMotion
          ? clip.preset_id === "zoom_through"
            ? `scale(${1 + peak * intensity * 0.08})`
            : `translate${axis}(${sign * (1 - progress) * intensity * 7}%)`
          : isGlitch
            ? `translateX(${Math.sin(frame * 2.8) * peak * 18}px)`
            : undefined,
      }}
    />
  );
};

const ProductionTransitions = ({
  assetFiles,
  content,
}: Pick<RenderProject, "assetFiles" | "content">) => (
  <>
    {effectiveTransitionTracks(content).flatMap((track) =>
      track.visible
        ? track.clips.flatMap((clip) => {
            const durationInFrames = Math.max(
              1,
              Math.round(clip.duration_seconds * FPS),
            );
            const from = Math.max(
              0,
              Math.round(clip.cut_seconds * FPS - durationInFrames / 2),
            );
            const soundFile = clip.sound_artifact_id
              ? assetFiles[clip.sound_artifact_id]
              : null;
            return [
              <Sequence
                key={`${track.id}:${clip.id}:visual`}
                from={from}
                durationInFrames={durationInFrames}
              >
                <TransitionEffect clip={clip} />
              </Sequence>,
              ...(soundFile
                ? [
                    <Sequence
                      key={`${track.id}:${clip.id}:sound`}
                      from={from}
                      durationInFrames={durationInFrames}
                    >
                      <Audio src={staticFile(soundFile)} />
                    </Sequence>,
                  ]
                : []),
            ];
          })
        : [],
    )}
  </>
);

export const getDurationInFrames = (content: ContentPackage): number =>
  content.scenes.reduce(
    (total, scene) =>
      total +
      Math.round(scene.duration_seconds * FPS) +
      Math.round((scene.gap_after_seconds ?? 0) * FPS),
    0,
  );

export const GreenlightFilm = ({
  assetFiles,
  captionTracks,
  content,
}: RenderProject) => {
  const timeline: ReactNode[] = [];
  content.scenes.forEach((scene, index) => {
    timeline.push(
      <Series.Sequence
        key={scene.id}
        durationInFrames={Math.round(scene.duration_seconds * FPS)}
        premountFor={FPS}
      >
        <EditorialScene assetFiles={assetFiles} scene={scene} />
      </Series.Sequence>,
    );
    if ((scene.gap_after_seconds ?? 0) > 0) {
      timeline.push(
        <Series.Sequence
          key={`${scene.id}-gap`}
          durationInFrames={Math.round((scene.gap_after_seconds ?? 0) * FPS)}
        >
          <AbsoluteFill style={{ background: "#000000" }} />
        </Series.Sequence>,
      );
    }
  });
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <Series>{timeline}</Series>
      <ProductionVideoOverlays assetFiles={assetFiles} content={content} />
      <ProductionTransitions assetFiles={assetFiles} content={content} />
      <ProductionAudio assetFiles={assetFiles} content={content} />
      <ProductionCaptions captionTracks={captionTracks} content={content} />
    </AbsoluteFill>
  );
};

export const GreenlightThumbnail = ({ assetFiles, content }: RenderProject) => {
  const firstAsset = content.scenes
    .flatMap((scene) => scene.visual.artifact_ids)
    .map((id) => assetFiles[id])
    .find(
      (file): file is string =>
        typeof file === "string" && !/\.(mp4|mov|webm)$/i.test(file),
    );
  return (
    <AbsoluteFill
      style={{
        display: "grid",
        gridTemplateColumns: firstAsset ? "1fr 360px" : "1fr",
        alignItems: "center",
        gap: 56,
        overflow: "hidden",
        padding: 70,
        color: color.ink,
        background: color.paper,
        fontFamily: type.editorial,
      }}
    >
      <div
        style={{
          maxWidth: 900,
          fontSize: 104,
          lineHeight: 0.9,
          letterSpacing: "-0.06em",
          fontWeight: 700,
        }}
      >
        {content.headline}
      </div>
      {firstAsset ? (
        <div
          style={{
            display: "grid",
            width: 340,
            height: 340,
            placeItems: "center",
            borderRadius: 72,
            background: color.panel,
          }}
        >
          <Img
            src={staticFile(firstAsset)}
            style={{ width: "78%", height: "78%", objectFit: "contain" }}
          />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
