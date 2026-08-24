import { loadFont as loadArchivo } from "@remotion/google-fonts/Archivo";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import { VIDEO_FPS } from "@greenlight/contracts";
import { Easing } from "remotion";

const editorial = loadArchivo("normal", {
  weights: ["400", "600", "700", "800"],
  subsets: ["latin"],
});
const technical = loadMono("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
});

export const renderSpec = {
  format: {
    width: 1920,
    height: 1080,
    thumbnailWidth: 1280,
    thumbnailHeight: 720,
    fps: VIDEO_FPS,
  },
  timing: {
    enterSeconds: 0.55,
    easeOut: Easing.bezier(0.16, 1, 0.3, 1),
  },
  layout: {
    edge: 72,
    bodyX: 110,
    bodyTop: 92,
    bodyBottom: 130,
    captionBottom: 42,
    contentWidth: 1540,
  },
  color: {
    paper: "#f8faf9",
    panel: "#e9f1ed",
    ink: "#121715",
    signal: "#56c79e",
    ember: "#ffb25b",
  },
  type: {
    editorial: editorial.fontFamily,
    technical: technical.fontFamily,
    caption: 29,
  },
} as const;

export const accentColor = (accent: "signal" | "ink" | "ember"): string =>
  renderSpec.color[accent];
