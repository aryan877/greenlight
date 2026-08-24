import { useCallback, useState } from "react";

type Axis = "x" | "y";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const useWorkspaceLayout = () => {
  const [leftWidth, setLeftWidth] = useState(252);
  const [rightWidth, setRightWidth] = useState(344);
  const [timelineHeight, setTimelineHeight] = useState(180);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(true);

  const beginResize = useCallback(
    (input: {
      axis: Axis;
      initial: number;
      invert?: boolean;
      min: number;
      max: number;
      onChange: (value: number) => void;
    }) =>
      (event: React.PointerEvent) => {
        event.preventDefault();
        const start = input.axis === "x" ? event.clientX : event.clientY;
        const onMove = (move: PointerEvent) => {
          const current = input.axis === "x" ? move.clientX : move.clientY;
          const delta = (current - start) * (input.invert ? -1 : 1);
          input.onChange(clamp(input.initial + delta, input.min, input.max));
        };
        const stop = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", stop);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        };
        document.body.style.cursor =
          input.axis === "x" ? "col-resize" : "row-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", stop, { once: true });
      },
    [],
  );

  return {
    leftWidth,
    rightWidth,
    timelineHeight,
    leftOpen,
    rightOpen,
    timelineOpen,
    setLeftOpen,
    setRightOpen,
    setTimelineOpen,
    resizeLeft: beginResize({
      axis: "x",
      initial: leftWidth,
      min: 196,
      max: 420,
      onChange: setLeftWidth,
    }),
    resizeRight: beginResize({
      axis: "x",
      initial: rightWidth,
      invert: true,
      min: 280,
      max: 520,
      onChange: setRightWidth,
    }),
    resizeTimeline: beginResize({
      axis: "y",
      initial: timelineHeight,
      invert: true,
      min: 154,
      max: Math.max(260, window.innerHeight * 0.62),
      onChange: setTimelineHeight,
    }),
  };
};
