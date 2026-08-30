import { describe, expect, it } from "vitest";

import { edgeInternals } from "./index.js";

describe("edge signed values", () => {
  it("accepts an unchanged value", async () => {
    const token = await edgeInternals.signedValue("demo", "a-long-secret");
    await expect(
      edgeInternals.verifySignedValue(token, "a-long-secret"),
    ).resolves.toBe("demo");
  });

  it("rejects a changed signature", async () => {
    const token = await edgeInternals.signedValue("demo", "a-long-secret");
    await expect(
      edgeInternals.verifySignedValue(`${token}x`, "a-long-secret"),
    ).resolves.toBeNull();
  });
});
