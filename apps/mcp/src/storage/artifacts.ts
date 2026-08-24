import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";

import {
  artifactKindSchema,
  type Artifact,
  type ArtifactKind,
} from "@greenlight/contracts";

import { createId, now, sha256 } from "../lib/canonical.js";
import type { GreenlightStore } from "./store.js";

const mimeByExtension: Record<string, string> = {
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webp": "image/webp",
};

export class ArtifactStore {
  constructor(
    private readonly root: string,
    private readonly store: GreenlightStore,
  ) {}

  async importBuffer(input: {
    projectId: string;
    kind: ArtifactKind;
    filename: string;
    bytes: Uint8Array;
    provenance: Record<string, unknown>;
  }): Promise<Artifact> {
    const kind = artifactKindSchema.parse(input.kind);
    const extension = extname(input.filename).toLowerCase();
    if (!mimeByExtension[extension])
      throw new Error("unsupported_artifact_type");
    const digest = sha256(input.bytes);
    const relativePath = `${input.projectId}/${kind}/${digest}${extension}`;
    const absolutePath = this.resolveRelative(relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.bytes, { flag: "wx" }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    const info = await stat(absolutePath);
    const artifact: Artifact = {
      id: createId("artifact"),
      project_id: input.projectId,
      kind,
      sha256: digest,
      relative_path: relativePath,
      mime_type: mimeByExtension[extension],
      byte_size: info.size,
      provenance: input.provenance,
      created_at: now(),
    };
    return this.store.saveArtifact(artifact);
  }

  async importJson(input: {
    projectId: string;
    kind:
      | "evidence_ledger"
      | "content_package"
      | "edit_patch"
      | "quality_report"
      | "transcript";
    value: unknown;
    provenance: Record<string, unknown>;
  }): Promise<Artifact> {
    return this.importBuffer({
      projectId: input.projectId,
      kind: input.kind,
      filename: `${input.kind}.json`,
      bytes: Buffer.from(`${JSON.stringify(input.value, null, 2)}\n`),
      provenance: input.provenance,
    });
  }

  resolveArtifact(id: string): { artifact: Artifact; absolutePath: string } {
    const artifact = this.store.getArtifact(id);
    if (!artifact) throw new Error("artifact_not_found");
    return {
      artifact,
      absolutePath: this.resolveRelative(artifact.relative_path),
    };
  }

  async readJson<T>(id: string): Promise<T> {
    const { absolutePath } = this.resolveArtifact(id);
    return JSON.parse(await readFile(absolutePath, "utf8")) as T;
  }

  private resolveRelative(relativePath: string): string {
    const absolute = resolve(this.root, relativePath);
    const pathFromRoot = relative(this.root, absolute);
    if (
      pathFromRoot.startsWith(`..${sep}`) ||
      pathFromRoot === ".." ||
      pathFromRoot.startsWith(sep)
    ) {
      throw new Error("artifact_path_outside_root");
    }
    return absolute;
  }
}
