import { createHash, randomUUID } from "node:crypto";

export const now = (): string => new Date().toISOString();

export const createId = (prefix: string): string =>
  `${prefix}_${randomUUID().replaceAll("-", "")}`;

export const canonicalJson = (value: unknown): string => {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, sort(child)]),
      );
    }
    return input;
  };

  return JSON.stringify(sort(value));
};

export const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

export const hashJson = (value: unknown): string =>
  sha256(canonicalJson(value));
