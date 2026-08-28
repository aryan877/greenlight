import type { Response as ExpressResponse } from "express";

const forwardedResponseHeaders = [
  "content-type",
  "openrouter-processing-time",
  "x-request-id",
] as const;

export const normalizeProviderCost = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const payload = value as Record<string, unknown>;
  const usage = payload.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return value;
  const providerUsage = usage as Record<string, unknown>;
  const cost = providerUsage.cost;
  if (
    providerUsage.costInUSD !== undefined ||
    typeof cost !== "number" ||
    !Number.isFinite(cost) ||
    cost < 0
  ) {
    return value;
  }
  return {
    ...payload,
    usage: { ...providerUsage, costInUSD: cost },
  };
};

export const normalizeProviderSseLine = (line: string): string => {
  if (!line.startsWith("data:")) return line;
  const data = line.slice("data:".length).trimStart();
  if (!data || data === "[DONE]") return line;
  try {
    return `data: ${JSON.stringify(normalizeProviderCost(JSON.parse(data)))}`;
  } catch {
    return line;
  }
};

export class LlmGatewayProvider {
  constructor(
    private readonly config: {
      apiKey: string | null;
      upstreamBaseUrl: string;
    },
  ) {}

  available() {
    return Boolean(this.config.apiKey);
  }

  async chatCompletions(
    body: unknown,
    response: ExpressResponse,
  ): Promise<void> {
    if (!this.config.apiKey) throw new Error("llm_gateway_not_configured");
    const upstream = await fetch(
      new URL("chat/completions", `${this.config.upstreamBaseUrl}/`),
      {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          "http-referer": "https://greenlight.local",
          "x-title": "Greenlight",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10 * 60_000),
      },
    );

    response.status(upstream.status);
    for (const header of forwardedResponseHeaders) {
      const value = upstream.headers.get(header);
      if (value) response.setHeader(header, value);
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      const text = await upstream.text();
      if (!contentType.includes("application/json")) {
        response.send(text);
        return;
      }
      try {
        response.json(normalizeProviderCost(JSON.parse(text)));
      } catch {
        response.send(text);
      }
      return;
    }

    if (!upstream.body) throw new Error("llm_gateway_empty_stream");
    response.flushHeaders();
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    while (true) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        response.write(`${normalizeProviderSseLine(line)}\n`);
      }
      if (done) break;
    }
    if (buffered) response.write(normalizeProviderSseLine(buffered));
    response.end();
  }
}
