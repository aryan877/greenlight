import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { extname, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArtifactKind } from "@greenlight/contracts";

import { sha256 } from "../lib/canonical.js";
import type { ArtifactStore } from "../storage/artifacts.js";

type RpcResponse = {
  id: number;
  result?: unknown;
  error?: { message?: string };
};
type RpcNotification = { method: string; params?: Record<string, unknown> };

type ImageGenerationItem = {
  failure?: { type?: string } | null;
  revisedPrompt?: string | null;
  savedPath?: string;
  status?: string;
  type: "imageGeneration";
};

export class CodexImageProvider {
  constructor(
    private readonly config: { binaryPath: string; model: string | null },
    private readonly artifacts: ArtifactStore,
  ) {}

  describe() {
    return {
      available: true,
      provider: "codex_subscription",
      runtime: "codex app-server",
      model: this.config.model,
      skill: "imagegen",
    };
  }

  async generate(input: {
    aspectRatio: "16:9" | "1:1" | "9:16";
    kind: ArtifactKind;
    projectId: string;
    prompt: string;
    sceneId: string | null;
  }) {
    const workDir = await mkdtemp(join(tmpdir(), "greenlight-codex-image-"));
    const child = spawn(this.config.binaryPath, ["app-server"], {
      cwd: workDir,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const reader = createInterface({ input: child.stdout });
    let nextId = 1;
    const pending = new Map<
      number,
      { reject: (reason: Error) => void; resolve: (value: unknown) => void }
    >();
    let imageItem: ImageGenerationItem | null = null;
    let turnResolve: (() => void) | null = null;
    let turnReject: ((reason: Error) => void) | null = null;
    let stderr = "";

    const send = (message: object) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const call = (method: string, params: object) =>
      new Promise<unknown>((resolvePromise, rejectPromise) => {
        const id = nextId++;
        pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
        send({ id, method, params });
      });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-2000);
    });
    reader.on("line", (line) => {
      let message: RpcResponse | RpcNotification;
      try {
        message = JSON.parse(line) as RpcResponse | RpcNotification;
      } catch {
        return;
      }
      if ("id" in message && typeof message.id === "number") {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) {
          waiter.reject(
            new Error(message.error.message ?? "codex_app_server_error"),
          );
        } else {
          waiter.resolve(message.result);
        }
        return;
      }
      if (!("method" in message)) return;
      if (message.method === "item/completed") {
        const item = message.params?.item as ImageGenerationItem | undefined;
        if (item?.type === "imageGeneration") imageItem = item;
      }
      if (message.method === "turn/completed") {
        const turn = message.params?.turn as
          { error?: { message?: string } | null; status?: string } | undefined;
        if (turn?.status === "completed") turnResolve?.();
        else {
          turnReject?.(
            new Error(
              turn?.error?.message ?? `codex_turn_${turn?.status ?? "failed"}`,
            ),
          );
        }
      }
    });

    const completed = new Promise<void>((resolvePromise, rejectPromise) => {
      turnResolve = resolvePromise;
      turnReject = rejectPromise;
    });
    const timeout = setTimeout(
      () => turnReject?.(new Error("codex_image_generation_timeout")),
      5 * 60_000,
    );

    try {
      await call("initialize", {
        clientInfo: {
          name: "greenlight",
          title: "Greenlight",
          version: "0.1.0",
        },
      });
      send({ method: "initialized", params: {} });
      const threadResponse = (await call("thread/start", {
        ...(this.config.model ? { model: this.config.model } : {}),
        cwd: workDir,
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandbox: "read-only",
        ephemeral: true,
        developerInstructions:
          "You are a bounded image-generation worker. Use only Codex's built-in imagegen skill and its image generation tool. Generate exactly one image. Do not run shell commands, edit files, browse the web, or use any browser-driven image workflow.",
      })) as { thread?: { id?: string } };
      const threadId = threadResponse.thread?.id;
      if (!threadId) throw new Error("codex_thread_id_missing");
      await call("turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text: `Use the built-in imagegen skill to generate exactly one ${input.aspectRatio} image for this editorial brief:\n\n${input.prompt}`,
            text_elements: [],
          },
        ],
      });
      await completed;
      const generated = imageItem as ImageGenerationItem | null;
      if (!generated?.savedPath) {
        throw new Error(
          generated?.failure?.type
            ? `codex_image_generation_failed:${generated.failure.type}`
            : "codex_image_path_missing",
        );
      }
      const allowedRoot = await realpath(
        resolve(homedir(), ".codex/generated_images"),
      );
      const generatedPath = await realpath(generated.savedPath);
      const fromRoot = relative(allowedRoot, generatedPath);
      if (
        fromRoot === ".." ||
        fromRoot.startsWith(`..${sep}`) ||
        fromRoot.startsWith(sep)
      ) {
        throw new Error("codex_image_path_outside_allowed_root");
      }
      const extension = extname(generatedPath).toLowerCase();
      if (![".png", ".webp"].includes(extension)) {
        throw new Error("codex_image_type_not_allowed");
      }
      const bytes = await readFile(generatedPath);
      return this.artifacts.importBuffer({
        projectId: input.projectId,
        kind: input.kind,
        filename: `codex-image${extension}`,
        bytes,
        provenance: {
          provider: "codex_subscription",
          runtime: "codex app-server",
          model: this.config.model ?? "codex_default",
          skill: "imagegen",
          prompt_sha256: sha256(input.prompt),
          revised_prompt: generated.revisedPrompt ?? null,
          aspect_ratio: input.aspectRatio,
          scene_id: input.sceneId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      throw new Error(
        `codex_image_failed:${message}${stderr ? `:${stderr.slice(-240)}` : ""}`,
      );
    } finally {
      clearTimeout(timeout);
      reader.close();
      child.kill("SIGTERM");
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
