import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  captionCueSchema,
  captionTrackSchema,
  contentPackageSchema,
} from "@greenlight/contracts";
import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";

import { fixturePackage } from "./fixture";
import type { RenderProject } from "./Root";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const fixtureMode = args.includes("--fixture");
const argument = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const content = fixtureMode
  ? fixturePackage
  : contentPackageSchema.parse(
      JSON.parse(await readFile(argument("--input") ?? "", "utf8")),
    );
const sourceAssets = argument("--assets")
  ? (JSON.parse(await readFile(argument("--assets")!, "utf8")) as Record<
      string,
      string
    >)
  : {};
const captionArtifactIds = new Set(
  content.scenes.flatMap((scene) =>
    scene.captions_artifact_id ? [scene.captions_artifact_id] : [],
  ),
);
const captionTracks = Object.fromEntries(
  await Promise.all(
    [...captionArtifactIds].map(async (id) => {
      const source = sourceAssets[id];
      if (!source) throw new Error(`caption_artifact_missing:${id}`);
      const value = JSON.parse(await readFile(source, "utf8"));
      const track = captionTrackSchema.safeParse(value);
      return [
        id,
        track.success ? track.data.cues : captionCueSchema.array().parse(value),
      ] as const;
    }),
  ),
);
const outputPath = resolve(argument("--output") ?? "out/greenlight.mp4");
const thumbnailPath = resolve(argument("--thumbnail") ?? "out/thumbnail.png");
const publicDir = await mkdtemp(join(tmpdir(), "greenlight-public-"));

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(thumbnailPath), { recursive: true });

try {
  const assetFiles: Record<string, string> = {};
  await Promise.all(
    Object.entries(sourceAssets).map(async ([id, source]) => {
      if (captionArtifactIds.has(id)) return;
      const relativePath = `assets/${id}${extname(source)}`;
      const target = join(publicDir, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      assetFiles[id] = relativePath;
    }),
  );
  const inputProps: RenderProject = { content, assetFiles, captionTracks };
  const serveUrl = await bundle({
    entryPoint: resolve(here, "index.ts"),
    publicDir,
    onProgress: (progress) => {
      if (Math.round(progress * 100) % 20 === 0) {
        process.stderr.write(`bundle ${Math.round(progress * 100)}%\n`);
      }
    },
  });
  const filmComposition = await selectComposition({
    serveUrl,
    id: "GreenlightFilm",
    inputProps,
  });
  const thumbnailComposition = await selectComposition({
    serveUrl,
    id: "GreenlightThumbnail",
    inputProps,
  });

  await renderMedia({
    composition: filmComposition,
    serveUrl,
    codec: "h264",
    audioCodec: "aac",
    hardwareAcceleration: "if-possible",
    videoBitrate: "8M",
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => {
      process.stderr.write(`render ${Math.round(progress * 100)}%\r`);
    },
  });
  await renderStill({
    composition: thumbnailComposition,
    serveUrl,
    output: thumbnailPath,
    inputProps,
    imageFormat: "png",
  });

  process.stdout.write(
    `${JSON.stringify({ ok: true, output_path: outputPath, thumbnail_path: thumbnailPath })}\n`,
  );
} finally {
  await rm(publicDir, { recursive: true, force: true });
}
