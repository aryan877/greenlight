import type { CSSProperties, ReactNode } from "react";

import type { ContentPackage, Scene } from "@greenlight/contracts";
import { fitText } from "@remotion/layout-utils";
import { Audio, Video } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { accentColor, renderSpec } from "./design";
import type { RenderProject } from "./Root";

export const FPS = renderSpec.format.fps;
export const TRANSITION_FRAMES = renderSpec.timing.transitionFrames;

const { color, layout, timing, type } = renderSpec;

const enterProgress = (frame: number, fps: number): number =>
  interpolate(frame, [0, timing.enterSeconds * fps], [0, 1], {
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

const Caption = ({ text }: { text: string }) => (
  <div
    style={{
      position: "absolute",
      left: layout.edge,
      right: layout.edge,
      bottom: layout.captionBottom,
      display: "flex",
      justifyContent: "center",
    }}
  >
    <div
      style={{
        maxWidth: 1340,
        padding: "12px 20px 14px",
        borderRadius: 12,
        color: "white",
        background: "rgba(18, 22, 21, 0.9)",
        fontFamily: type.editorial,
        fontSize: type.caption,
        fontWeight: 600,
        letterSpacing: "-0.015em",
        textAlign: "center",
      }}
    >
      {text}
    </div>
  </div>
);

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
  const files = scene.visual.artifact_ids
    .map((id) => assetFiles[id])
    .filter((file): file is string => Boolean(file));
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: files.length > 0 ? "1fr 610px" : "1fr",
        alignItems: "center",
        gap: 80,
        width: "100%",
      }}
    >
      <Title scene={scene} compact={files.length > 0} />
      {files.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: files.length === 1 ? "1fr" : "1fr 1fr",
            gap: 24,
            alignItems: "center",
          }}
        >
          {files.map((file, index) => {
            const enter = interpolate(
              frame,
              [index * 0.12 * fps, (index * 0.12 + 0.55) * fps],
              [0, 1],
              {
                easing: Easing.bezier(0.34, 1.3, 0.64, 1),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            );
            return (
              <div
                key={file}
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
                    loop
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
  isFirst,
  isLast,
  scene,
}: {
  assetFiles: Record<string, string>;
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
      <Caption text={scene.narration} />
      {narrationFile ? (
        <Audio
          playbackRate={scene.playback_rate}
          src={staticFile(narrationFile)}
          volume={(frame) => {
            const duration = Math.round(scene.duration_seconds * FPS);
            const fadeIn = isFirst
              ? 1
              : interpolate(frame, [0, TRANSITION_FRAMES], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                });
            const fadeOut = isLast
              ? 1
              : interpolate(
                  frame,
                  [duration - TRANSITION_FRAMES, duration],
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
    (total, scene) => total + Math.round(scene.duration_seconds * FPS),
    0,
  ) -
  Math.max(0, content.scenes.length - 1) * TRANSITION_FRAMES;

export const GreenlightFilm = ({ assetFiles, content }: RenderProject) => {
  const timeline: ReactNode[] = [];
  content.scenes.forEach((scene, index) => {
    timeline.push(
      <TransitionSeries.Sequence
        key={scene.id}
        durationInFrames={Math.round(scene.duration_seconds * FPS)}
        premountFor={FPS}
      >
        <EditorialScene
          assetFiles={assetFiles}
          isFirst={index === 0}
          isLast={index === content.scenes.length - 1}
          scene={scene}
        />
      </TransitionSeries.Sequence>,
    );
    if (index < content.scenes.length - 1) {
      timeline.push(
        <TransitionSeries.Transition
          key={`${scene.id}-transition`}
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />,
      );
    }
  });
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <TransitionSeries>{timeline}</TransitionSeries>
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
