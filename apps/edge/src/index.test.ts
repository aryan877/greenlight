import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import worker, { edgeInternals } from "./index.js";

const edgeEnv = {
  ASSETS: { fetch: vi.fn() },
  DEMO_EMAIL: "demo@greenlight.studio",
  DEMO_PASSWORD: "judge-pass",
  GOOGLE_LOGIN_CLIENT_ID: "google-client",
  GOOGLE_LOGIN_CLIENT_SECRET: "google-secret",
  GOOGLE_LOGIN_REDIRECT_URI: "https://studio.example/auth/google/callback",
  MEDIA: {},
  ORIGIN_SHARED_SECRET: "origin-secret",
  ORIGIN_URL: "https://origin.example",
  SESSION_SECRET: "a-long-session-secret",
} as never;

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

describe("edge authentication", () => {
  it("shows both prefilled judge access and Google sign-in", async () => {
    const response = await worker.fetch(
      new Request("https://studio.example/login"),
      edgeEnv,
    );
    const page = await response.text();

    expect(page).toContain("Continue with Google");
    expect(page).toContain('value="demo@greenlight.studio"');
    expect(page).toContain('value="judge-pass"');
    expect(page).toContain("Judge credentials are intentionally prefilled");
  });

  it("creates a signed session from the judge credentials", async () => {
    const response = await worker.fetch(
      new Request("https://studio.example/auth/login", {
        body: new URLSearchParams({
          email: "demo@greenlight.studio",
          password: "judge-pass",
        }),
        method: "POST",
      }),
      edgeEnv,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toContain("greenlight_session=");
  });

  it("uses a CSRF-bound Google code flow and accepts a verified email", async () => {
    const start = await worker.fetch(
      new Request("https://studio.example/auth/google"),
      edgeEnv,
    );
    const authorization = new URL(String(start.headers.get("location")));
    const stateCookie = String(start.headers.get("set-cookie"));
    const state = String(authorization.searchParams.get("state"));
    expect(authorization.origin).toBe("https://accounts.google.com");
    expect(authorization.searchParams.get("scope")).toBe(
      "openid email profile",
    );

    const providerFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "access-token" }), {
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            email: "creator@example.com",
            email_verified: true,
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", providerFetch);
    const callback = await worker.fetch(
      new Request(
        `https://studio.example/auth/google/callback?code=one-time-code&state=${encodeURIComponent(state)}`,
        { headers: { cookie: stateCookie.split(";", 1)[0] ?? "" } },
      ),
      edgeEnv,
    );
    vi.unstubAllGlobals();

    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe("/");
    expect(callback.headers.get("set-cookie")).toContain("greenlight_session=");
    expect(providerFetch).toHaveBeenCalledTimes(2);
  });

  it("clears the session and returns to the login page", async () => {
    const response = await worker.fetch(
      new Request("https://studio.example/auth/logout", {
        headers: {
          cookie: `greenlight_session=${await edgeInternals.signedValue(
            `demo@greenlight.studio|${Date.now() + 60_000}`,
            "a-long-session-secret",
          )}`,
        },
        method: "POST",
      }),
      edgeEnv,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
