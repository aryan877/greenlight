import { CircleCheck, Image, LoaderCircle } from "lucide-react";

import type { ImageGenerationCapabilities } from "../api/greenlight.js";
import { cx } from "./controls.js";

const unavailableCopy = (
  reason: ImageGenerationCapabilities["reason"] | undefined,
) => {
  if (reason === "codex_not_installed") return "Imagegen optional";
  if (reason === "codex_not_authenticated") return "Sign in to Codex";
  return "Imagegen optional";
};

export const CodexConnectionStatus = ({
  capabilities,
  checking,
}: {
  capabilities: ImageGenerationCapabilities | null;
  checking: boolean;
}) => {
  const connected = capabilities?.connected === true;
  const label = checking
    ? "Checking Codex"
    : connected
      ? "Codex connected"
      : unavailableCopy(capabilities?.reason);
  const detail = connected
    ? `Image generation via ${
        capabilities.connection === "chatgpt"
          ? "ChatGPT"
          : capabilities.connection === "api_key"
            ? "API key"
            : "Codex"
      } · provider-default quality`
    : `${label}. Image generation stays unavailable until this connection is ready.`;

  return (
    <div
      role="status"
      aria-live="polite"
      title={detail}
      className={cx(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-medium",
        connected
          ? "border-action/30 bg-action-soft/50 text-action"
          : "border-line-subtle bg-surface-sunken text-ink-tertiary",
      )}
    >
      {checking ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : connected ? (
        <CircleCheck className="size-3.5" />
      ) : null}
      <Image className="size-3.5" />
      <span>{label}</span>
    </div>
  );
};
