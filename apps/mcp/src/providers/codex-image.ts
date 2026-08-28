import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import { extname, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

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

export type CodexImageCapabilities = {
  available: boolean;
  connected: boolean;
  connection: "api_key" | "chatgpt" | "unknown" | null;
  model: string | null;
  provider: "codex_subscription";
  quality: "provider_default";
  reason:
    | "codex_not_authenticated"
    | "codex_not_installed"
    | "codex_status_unavailable"
    | null;
  runtime: "codex app-server";
  skill: "imagegen";
};

const execFileAsync = promisify(execFile);
const CAPABILITY_TTL_MS = 30_000;

export const codexConnectionFromStatus = (
  output: string,
): CodexImageCapabilities["connection"] => {
  const normalized = output.toLowerCase();
  if (
    normalized.includes("not logged in") ||
    normalized.includes("login required")
  ) {
    return null;
  }
  if (normalized.includes("chatgpt")) return "chatgpt";
  if (normalized.includes("api key") || normalized.includes("api_key")) {
    return "api_key";
  }
  return normalized.includes("logged in") ? "unknown" : null;
};

export class CodexImageProvider {
  private cachedCapabilities:
    { expiresAt: number; value: CodexImageCapabilities } | undefined;

  constructor(
    private readonly config: { binaryPath: string; model: string | null },
    private readonly artifacts: ArtifactStore,
  ) {}

  async describe(options: { refresh?: boolean } = {}) {
    if (
      !options.refresh &&
      this.cachedCapabilities &&
      this.cachedCapabilities.expiresAt > Date.now()
    ) {
      return this.cachedCapabilities.value;
    }

    const base = {
      provider: "codex_subscription",
      runtime: "codex app-server",
      model: this.config.model,
      skill: "imagegen",
      quality: "provider_default",
    } as const;
    let value: CodexImageCapabilities;
    try {
      const { stdout, stderr } = await execFileAsync(
        this.config.binaryPath,
        ["login", "status"],
        {
          env: process.env,
          maxBuffer: 16 * 1024,
          timeout: 5_000,
          windowsHide: true,
        },
      );
      const connection = codexConnectionFromStatus(`${stdout}\n${stderr}`);
      value = connection
        ? {
            ...base,
            available: true,
            connected: true,
            connection,
            reason: null,
          }
        : {
            ...base,
            available: false,
            connected: false,
            connection: null,
            reason: "codex_not_authenticated",
          };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        stderr?: Buffer | string;
        stdout?: Buffer | string;
      };
      const output = `${String(failure.stdout ?? "")}\n${String(
        failure.stderr ?? "",
      )}`.toLowerCase();
      value = {
        ...base,
        available: false,
        connected: false,
        connection: null,
        reason:
          failure.code === "ENOENT"
            ? "codex_not_installed"
            : output.includes("not logged in") ||
                output.includes("login required")
              ? "codex_not_authenticated"
              : "codex_status_unavailable",
      };
    }
    this.cachedCapabilities = {
      expiresAt: Date.now() + CAPABILITY_TTL_MS,
      value,
    };
    return value;
  }

  async generate(input: {
    aspectRatio: "16:9" | "1:1" | "9:16";
    kind: ArtifactKind;
    projectId: string;
    prompt: string;
    sceneId: string | null;
  }) {
    const capabilities = await this.describe();
    if (!capabilities.connected) {
      throw new Error(capabilities.reason ?? "codex_not_authenticated");
    }
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
    let processFailure: Error | null = null;

    const rejectRpc = (error: Error) => {
      if (processFailure) return;
      processFailure = error;
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
      turnReject?.(error);
    };
    child.once("error", (error) => {
      rejectRpc(new Error(`codex_app_server_spawn_failed:${error.message}`));
    });
    child.stdin.on("error", (error) => {
      rejectRpc(new Error(`codex_app_server_stdin_failed:${error.message}`));
    });
    child.once("exit", (code, signal) => {
      if (code === 0 || processFailure) return;
      rejectRpc(
        new Error(
          `codex_app_server_exited:${String(code ?? signal ?? "unknown")}`,
        ),
      );
    });

    const send = (message: object) => {
      if (processFailure) throw processFailure;
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
    // A spawn failure can happen while initialize is still pending, before the
    // turn promise is awaited. Register a handler immediately so that the same
    // failure rejects generate() without becoming an unhandled rejection.
    void completed.catch(() => undefined);
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
