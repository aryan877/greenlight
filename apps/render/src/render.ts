import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { contentPackageSchema } from "@greenlight/contracts";
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
const outputPath = resolve(argument("--output") ?? "out/greenlight.mp4");
const thumbnailPath = resolve(argument("--thumbnail") ?? "out/thumbnail.png");
const publicDir = await mkdtemp(join(tmpdir(), "greenlight-public-"));

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(thumbnailPath), { recursive: true });

try {
  const assetFiles: Record<string, string> = {};
  await Promise.all(
    Object.entries(sourceAssets).map(async ([id, source]) => {
      const relativePath = `assets/${id}${extname(source)}`;
      const target = join(publicDir, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      assetFiles[id] = relativePath;
    }),
  );
  const inputProps: RenderProject = { content, assetFiles };
  const serveUrl = await bundle({
    entryPoint: resolve(here, "index.ts"),
    publicDir,
    onProgress: (progress) => {
      if (Math.round(progress * 100) % 20 === 0) {
        process.stderr.write(`bundle ${Math.round(progress * 100)}%\n`);
      }
    },
  });
  const composition = await selectComposition({
    serveUrl,
    id: "GreenlightFilm",
    inputProps,
  });

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    audioCodec: "aac",
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => {
      process.stderr.write(`render ${Math.round(progress * 100)}%\r`);
    },
  });
  await renderStill({
    composition: {
      ...composition,
      id: "GreenlightThumbnail",
      width: 1280,
      height: 720,
      durationInFrames: 1,
    },
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
