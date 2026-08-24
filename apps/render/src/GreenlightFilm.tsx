import type { CSSProperties, ReactNode } from "react";

import type { CaptionCue, ContentPackage, Scene } from "@greenlight/contracts";
import { fitText } from "@remotion/layout-utils";
import { Audio, Video } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Series,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { accentColor, renderSpec } from "./design";
import { TimedCaptions } from "./Captions";
import type { RenderProject } from "./Root";

export const FPS = renderSpec.format.fps;
const AUDIO_EDGE_FADE_FRAMES = 2;

const { color, layout, timing, type } = renderSpec;

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
  captionTrack,
  isFirst,
  isLast,
  scene,
}: {
  assetFiles: Record<string, string>;
  captionTrack: CaptionCue[] | null;
  isFirst: boolean;
  isLast: boolean;
  scene: Scene;
}) => {
  const Treatment = treatments[scene.visual.treatment];
  const narrationFile = scene.narration_artifact_id
    ? assetFiles[scene.narration_artifact_id]
    : null;
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
        }}
      >
        <Treatment assetFiles={assetFiles} scene={scene} />
      </AbsoluteFill>
      {captionTrack ? (
        <TimedCaptions cues={captionTrack} playbackRate={scene.playback_rate} />
      ) : null}
      {narrationFile ? (
        <Audio
          playbackRate={scene.playback_rate}
          src={staticFile(narrationFile)}
          volume={(frame) => {
            const duration = Math.round(scene.duration_seconds * FPS);
            const fadeIn = isFirst
              ? 1
              : interpolate(frame, [0, AUDIO_EDGE_FADE_FRAMES], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                });
            const fadeOut = isLast
              ? 1
              : interpolate(
                  frame,
                  [duration - AUDIO_EDGE_FADE_FRAMES, duration],
                  [1, 0],
                  {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  },
                );
            return Math.min(fadeIn, fadeOut);
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

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
        <EditorialScene
          assetFiles={assetFiles}
          captionTrack={
            scene.captions_artifact_id
              ? (captionTracks[scene.captions_artifact_id] ?? null)
              : null
          }
          isFirst={index === 0}
          isLast={index === content.scenes.length - 1}
          scene={scene}
        />
      </Series.Sequence>,
    );
    if ((scene.gap_after_seconds ?? 0) > 0) {
      timeline.push(
        <Series.Sequence
          key={`${scene.id}-gap`}
          durationInFrames={Math.round((scene.gap_after_seconds ?? 0) * FPS)}
        >
          <AbsoluteFill style={{ background: color.paper }} />
        </Series.Sequence>,
      );
    }
  });
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <Series>{timeline}</Series>
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
