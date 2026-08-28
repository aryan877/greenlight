import { createTikTokStyleCaptions, type TikTokPage } from "@remotion/captions";
import type { CaptionCue } from "@greenlight/contracts";
import { useMemo } from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { renderSpec } from "./design";

const PAGE_WINDOW_MS = 1_200;
const { color, layout, type } = renderSpec;

const CaptionPage = ({
  page,
  playbackRate,
}: {
  page: TikTokPage;
  playbackRate: number;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mediaTimeMs = page.startMs + (frame / fps) * 1_000 * playbackRate;
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "flex-end",
        padding: `0 ${layout.edge}px ${layout.captionBottom}px`,
      }}
    >
      <div
        style={{
          maxWidth: 1_340,
          padding: "12px 20px 14px",
          borderRadius: 12,
          color: "white",
          background: "rgba(18, 22, 21, 0.9)",
          fontFamily: type.editorial,
          fontSize: type.caption,
          fontWeight: 600,
          letterSpacing: "-0.015em",
          lineHeight: 1.16,
          textAlign: "center",
          whiteSpace: "pre-wrap",
        }}
      >
        {page.tokens.map((token) => {
          const active =
            token.fromMs <= mediaTimeMs && token.toMs > mediaTimeMs;
          return (
            <span
              key={`${token.fromMs}-${token.toMs}-${token.text}`}
              style={{ color: active ? color.signal : "white" }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const TimedCaptions = ({
  cues,
  playbackRate,
}: {
  cues: CaptionCue[];
  playbackRate: number;
}) => {
  const { fps } = useVideoConfig();
  const { pages } = useMemo(
    () =>
      createTikTokStyleCaptions({
        captions: cues,
        combineTokensWithinMilliseconds: PAGE_WINDOW_MS,
      }),
    [cues],
  );
  return pages.map((page, index) => {
    const next = pages[index + 1];
    const finalTokenEnd = page.tokens.at(-1)?.toMs ?? page.startMs;
    const endMs = Math.max(page.startMs + 1, next?.startMs ?? finalTokenEnd);
    const from = Math.round((page.startMs / 1_000 / playbackRate) * fps);
    const durationInFrames = Math.max(
      1,
      Math.round(((endMs - page.startMs) / 1_000 / playbackRate) * fps),
    );
    return (
      <Sequence
        key={`${page.startMs}-${index}`}
        from={from}
        durationInFrames={durationInFrames}
        premountFor={fps}
      >
        <CaptionPage page={page} playbackRate={playbackRate} />
      </Sequence>
    );
  });
};
