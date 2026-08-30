import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import worker, { edgeInternals } from "./index.js";

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

  it("keeps upload grants opaque and rejects tampering", async () => {
    const secret = "a-long-secret";
    const value = JSON.stringify({ key: "private/r2/object.mp4" });
    const token = await edgeInternals.sealedValue(value, secret);

    expect(token).not.toContain("private");
    await expect(edgeInternals.unsealValue(token, secret)).resolves.toBe(value);
    await expect(
      edgeInternals.unsealValue(`${token}x`, secret),
    ).resolves.toBeNull();
  });

  it("streams a private R2 original only to the authenticated VPS cache", async () => {
    const bytes = new TextEncoder().encode("r2-original");
    const get = vi.fn(async () => ({
      body: new Blob([bytes]).stream(),
      size: bytes.byteLength,
      httpEtag: '"fixture"',
      writeHttpMetadata: (headers: Headers) =>
        headers.set("content-type", "video/mp4"),
    }));
    const env = {
      MEDIA: { get },
      ORIGIN_SHARED_SECRET: "origin-secret",
    } as never;
    const request = (secret: string) =>
      worker.fetch(
        new Request("https://studio.example/internal/r2", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-greenlight-origin-token": secret,
          },
          body: JSON.stringify({
            key: "demo/projects/project_demo/uploads/source.mp4",
          }),
        }),
        env,
      );

    expect((await request("wrong-secret")).status).toBe(404);
    const response = await request("origin-secret");
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("r2-original");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(get).toHaveBeenCalledOnce();
  });
});
