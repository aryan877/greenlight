import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";

import {
  artifactKindSchema,
  type Artifact,
  type ArtifactKind,
  type GeneratedArtifactMetadata,
} from "@greenlight/contracts";

import { createId, now, sha256 } from "../lib/canonical.js";
import type { ArtifactStorage, GreenlightStore } from "./store.js";

export type RemoteArtifactReader = (remoteKey: string) => Promise<Response>;

const mimeByExtension: Record<string, string> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".m4a": "audio/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".srt": "application/x-subrip",
  ".svg": "image/svg+xml",
  ".vtt": "text/vtt",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

export class ArtifactStore {
  private readonly hydrationByArtifactId = new Map<string, Promise<void>>();

  constructor(
    private readonly root: string,
    private readonly store: GreenlightStore,
    private readonly readRemoteArtifact: RemoteArtifactReader | null = null,
  ) {}

  async importBuffer(input: {
    projectId: string;
    kind: ArtifactKind;
    filename: string;
    bytes: Uint8Array;
    generation?: GeneratedArtifactMetadata;
    provenance: Record<string, unknown>;
    storage?: ArtifactStorage;
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
      generation: input.generation ?? null,
      provenance: input.provenance,
      created_at: now(),
    };
    return this.store.saveArtifact(artifact, input.storage);
  }

  async importJson(input: {
    projectId: string;
    kind:
      | "evidence_ledger"
      | "content_package"
      | "caption"
      | "edit_patch"
      | "media_license"
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
    const { absolutePath } = await this.ensureLocal(id);
    return JSON.parse(await readFile(absolutePath, "utf8")) as T;
  }

  async readChunk(
    id: string,
    offsetBytes: number,
    lengthBytes: number,
  ): Promise<Buffer> {
    const { artifact, absolutePath } = await this.ensureLocal(id);
    if (offsetBytes > artifact.byte_size) {
      throw new Error("artifact_offset_out_of_range");
    }

    const bytesToRead = Math.min(
      lengthBytes,
      Math.max(0, artifact.byte_size - offsetBytes),
    );
    if (bytesToRead === 0) return Buffer.alloc(0);

    const handle = await open(absolutePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        bytesToRead,
        offsetBytes,
      );
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async ensureLocal(
    id: string,
  ): Promise<{ artifact: Artifact; absolutePath: string }> {
    const resolved = this.resolveArtifact(id);
    try {
      const info = await stat(resolved.absolutePath);
      if (info.isFile() && info.size === resolved.artifact.byte_size) {
        return resolved;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const storage = this.store.getArtifactStorage(id);
    if (!storage || storage.backend !== "r2") {
      throw new Error("artifact_file_missing");
    }
    if (!this.readRemoteArtifact) throw new Error("artifact_cache_unavailable");

    const existing = this.hydrationByArtifactId.get(id);
    if (existing) {
      await existing;
      return this.resolveArtifact(id);
    }
    const hydration = this.hydrateFromRemote(resolved, storage.remoteKey);
    this.hydrationByArtifactId.set(id, hydration);
    try {
      await hydration;
    } finally {
      this.hydrationByArtifactId.delete(id);
    }
    return this.resolveArtifact(id);
  }

  private async hydrateFromRemote(
    resolved: { artifact: Artifact; absolutePath: string },
    remoteKey: string,
  ): Promise<void> {
    const response = await this.readRemoteArtifact!(remoteKey);
    if (!response.ok || !response.body) {
      throw new Error(`artifact_remote_read_failed:${String(response.status)}`);
    }
    const declaredSize = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredSize) &&
      declaredSize !== resolved.artifact.byte_size
    ) {
      throw new Error("artifact_remote_size_mismatch");
    }

    await mkdir(dirname(resolved.absolutePath), { recursive: true });
    const temporaryPath = `${resolved.absolutePath}.${randomUUID()}.partial`;
    const handle = await open(temporaryPath, "wx", 0o600);
    const digest = createHash("sha256");
    let byteSize = 0;
    try {
      for await (const value of response.body) {
        const chunk = Buffer.from(value);
        byteSize += chunk.byteLength;
        if (byteSize > resolved.artifact.byte_size) {
          throw new Error("artifact_remote_size_mismatch");
        }
        digest.update(chunk);
        await handle.write(chunk);
      }
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    await handle.close();
    if (byteSize !== resolved.artifact.byte_size) {
      await rm(temporaryPath, { force: true });
      throw new Error("artifact_remote_size_mismatch");
    }
    if (digest.digest("hex") !== resolved.artifact.sha256) {
      await rm(temporaryPath, { force: true });
      throw new Error("artifact_remote_hash_mismatch");
    }
    await rename(temporaryPath, resolved.absolutePath);
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
