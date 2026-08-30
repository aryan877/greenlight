interface Env {
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
  DEMO_EMAIL: string;
  DEMO_PASSWORD: string;
  GOOGLE_LOGIN_CLIENT_ID: string;
  GOOGLE_LOGIN_CLIENT_SECRET: string;
  GOOGLE_LOGIN_REDIRECT_URI: string;
  ORIGIN_SHARED_SECRET: string;
  ORIGIN_URL: string;
  SESSION_SECRET: string;
}

type UploadGrant = {
  expires_at: number;
  filename: string;
  key: string;
  mime_type: string;
  project_id: string;
  size: number;
  upload_id: string;
};

type UploadedPart = { etag: string; part_number: number };

const SESSION_COOKIE = "greenlight_session";
const GOOGLE_STATE_COOKIE = "greenlight_google_state";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const GOOGLE_STATE_TTL_SECONDS = 10 * 60;
const UPLOAD_TTL_SECONDS = 60 * 60;
const PART_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const encoder = new TextEncoder();
const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

const json = (value: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
};

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const sign = async (value: string, secret: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return base64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
    ),
  );
};

const signedValue = async (value: string, secret: string) =>
  `${base64Url(encoder.encode(value))}.${await sign(value, secret)}`;

const parseBase64Url = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(`${normalized}${padding}`);
  return new Uint8Array(
    [...binary].map((character) => character.charCodeAt(0)),
  );
};

const verifySignedValue = async (token: string, secret: string) => {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  try {
    const value = new TextDecoder().decode(parseBase64Url(encoded));
    const expected = await sign(value, secret);
    if (expected.length !== signature.length) return null;
    let mismatch = 0;
    for (let index = 0; index < expected.length; index += 1) {
      mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
    }
    return mismatch === 0 ? value : null;
  } catch {
    return null;
  }
};

const encryptionKey = async (secret: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "decrypt",
    "encrypt",
  ]);
};

const sealedValue = async (value: string, secret: string) => {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { iv: nonce, name: "AES-GCM" },
    await encryptionKey(secret),
    encoder.encode(value),
  );
  return `${base64Url(nonce)}.${base64Url(new Uint8Array(ciphertext))}`;
};

const unsealValue = async (token: string, secret: string) => {
  const [encodedNonce, encodedCiphertext, extra] = token.split(".");
  if (!encodedNonce || !encodedCiphertext || extra) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { iv: parseBase64Url(encodedNonce), name: "AES-GCM" },
      await encryptionKey(secret),
      parseBase64Url(encodedCiphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
};

const secretsMatch = async (received: string | null, expected: string) => {
  if (!received) return false;
  const [receivedDigest, expectedDigest] = await Promise.all([
    sign("greenlight-internal-r2", received),
    sign("greenlight-internal-r2", expected),
  ]);
  let mismatch = 0;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    mismatch |=
      receivedDigest.charCodeAt(index) ^ expectedDigest.charCodeAt(index);
  }
  return mismatch === 0;
};

const cookies = (request: Request) =>
  Object.fromEntries(
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((entry) => entry.trim().split("=", 2))
      .filter(([name, value]) => Boolean(name && value)),
  );

const html = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const sessionCookie = async (email: string, env: Env) => {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const token = await signedValue(`${email}|${expiresAt}`, env.SESSION_SECRET);
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
};

const sessionEmail = async (request: Request, env: Env) => {
  const token = cookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const value = await verifySignedValue(token, env.SESSION_SECRET);
  if (!value) return null;
  const separator = value.lastIndexOf("|");
  const email = value.slice(0, separator);
  const expiresAt = Number(value.slice(separator + 1));
  return separator > 0 && /\S+@\S+\.\S+/u.test(email) && expiresAt > Date.now()
    ? email
    : null;
};

const secureHeaders = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=()");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

const loginPage = (env: Env, error: "credentials" | "google" | null = null) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Greenlight</title><style>:root{color-scheme:dark;font-family:Archivo,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0d100e;color:#eef3f0;display:grid;place-items:center;padding:24px}.shell{width:min(440px,100%)}.brand{display:flex;align-items:center;gap:12px;margin-bottom:28px}.brand svg{width:30px;height:30px}.brand strong{font-size:18px;letter-spacing:-.02em}.card{border:1px solid #303733;background:#151917;padding:32px}h1{font-size:30px;line-height:1.1;letter-spacing:-.04em;margin:0 0 10px}p{color:#a1aaa5;line-height:1.55;margin:0}.google,.primary{display:flex;width:100%;height:46px;align-items:center;justify-content:center;gap:10px;border:1px solid #3b443f;border-radius:2px;font:600 14px inherit;text-decoration:none;cursor:pointer}.google{background:#eef3f0;color:#151917;margin-top:26px}.google svg{width:18px;height:18px}.divider{display:flex;align-items:center;gap:12px;color:#747d78;font-size:11px;margin:24px 0}.divider:before,.divider:after{content:"";height:1px;background:#2c332f;flex:1}.section-title{font-size:12px;color:#c5cdc9;margin-bottom:14px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}label{display:grid;gap:6px;color:#89928d;font-size:10px;letter-spacing:.06em;text-transform:uppercase}input{height:42px;width:100%;min-width:0;border:1px solid #333b36;border-radius:2px;background:#101310;color:#eef3f0;padding:0 11px;font:12px "IBM Plex Mono",ui-monospace,monospace}.primary{background:#5ac0a4;border-color:#5ac0a4;color:#0d1713;margin-top:14px}.primary:hover,.google:hover{filter:brightness(1.05)}.error{border-left:2px solid #f07878;color:#f3aaaa;font-size:12px;line-height:1.45;margin:18px 0 0;padding:2px 0 2px 10px}.foot{color:#747d78;font:11px "IBM Plex Mono",ui-monospace,monospace;margin-top:16px;text-align:center}@media(max-width:480px){.card{padding:24px}.fields{grid-template-columns:1fr}}</style></head><body><main class="shell"><div class="brand"><svg viewBox="0 0 96 96" fill="none" aria-hidden="true"><circle cx="48" cy="48" r="40" stroke="#69E0A7" stroke-width="7"/><path d="m57.24 32 22.96 39.76M38.76 32h45.92M29.52 48 52.48 8.24M38.76 64 15.8 24.24M57.24 64H11.32M66.48 48 43.52 87.76" stroke="#69E0A7" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg><strong>Greenlight</strong></div><section class="card"><h1>Enter the studio</h1><p>Research, edit, render, and prepare a YouTube release in one controlled workspace.</p><a class="google" href="/auth/google"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.19c0-.64-.06-1.25-.16-1.84H12v3.48h5.25a4.49 4.49 0 0 1-1.95 2.94v2.26h3.16c1.85-1.7 2.89-4.21 2.89-6.84Z"/><path fill="#34A853" d="M12 21.73c2.64 0 4.86-.88 6.48-2.38l-3.16-2.26c-.88.59-2 .94-3.32.94-2.55 0-4.71-1.72-5.48-4.04H3.26v2.33A9.78 9.78 0 0 0 12 21.73Z"/><path fill="#FBBC05" d="M6.52 13.99A5.88 5.88 0 0 1 6.21 12c0-.69.12-1.36.31-1.99V7.68H3.26A9.78 9.78 0 0 0 2.27 12c0 1.57.38 3.05.99 4.32l3.26-2.33Z"/><path fill="#EA4335" d="M12 5.97c1.44 0 2.72.49 3.73 1.46l2.81-2.81A9.42 9.42 0 0 0 12 2.27a9.78 9.78 0 0 0-8.74 5.41l3.26 2.33C7.29 7.69 9.45 5.97 12 5.97Z"/></svg>Continue with Google</a><div class="divider">or use judge access</div><form method="post" action="/auth/login"><div class="fields"><label for="email">Email<input id="email" name="email" type="email" autocomplete="username" value="${html(env.DEMO_EMAIL)}" required></label><label for="password">Password<input id="password" name="password" type="text" autocomplete="current-password" value="${html(env.DEMO_PASSWORD)}" required></label></div><button class="primary" type="submit">Open demo workspace</button></form>${error === "credentials" ? '<div class="error">Those judge credentials did not match.</div>' : error === "google" ? '<div class="error">Google sign-in did not finish. Use judge access or try again.</div>' : ""}</section><p class="foot">Judge credentials are intentionally prefilled.</p></main></body></html>`,
    {
      headers: {
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        "content-type": "text/html; charset=utf-8",
      },
    },
  );

const login = async (request: Request, env: Env) => {
  const contentType = request.headers.get("content-type") ?? "";
  let email = "";
  let password = "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    email = typeof body.email === "string" ? body.email : "";
    password = typeof body.password === "string" ? body.password : "";
  } else {
    const body = await request.formData();
    email = String(body.get("email") ?? "");
    password = String(body.get("password") ?? "");
  }
  if (email !== env.DEMO_EMAIL || password !== env.DEMO_PASSWORD) {
    return contentType.includes("application/json")
      ? json({ error: "invalid_login" }, { status: 401 })
      : loginPage(env, "credentials");
  }
  const headers = new Headers({
    location: "/",
    "set-cookie": await sessionCookie(email, env),
  });
  return new Response(null, { headers, status: 303 });
};

const startGoogleLogin = async (env: Env) => {
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const expiresAt = Date.now() + GOOGLE_STATE_TTL_SECONDS * 1000;
  const stateCookie = await signedValue(
    `${state}|${expiresAt}`,
    env.SESSION_SECRET,
  );
  const authorization = new URL(GOOGLE_AUTHORIZATION_URL);
  authorization.search = new URLSearchParams({
    client_id: env.GOOGLE_LOGIN_CLIENT_ID,
    prompt: "select_account",
    redirect_uri: env.GOOGLE_LOGIN_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
  }).toString();
  return new Response(null, {
    headers: {
      location: authorization.toString(),
      "set-cookie": `${GOOGLE_STATE_COOKIE}=${stateCookie}; HttpOnly; Secure; SameSite=Lax; Path=/auth/google/callback; Max-Age=${GOOGLE_STATE_TTL_SECONDS}`,
    },
    status: 302,
  });
};

const finishGoogleLogin = async (request: Request, env: Env) => {
  const url = new URL(request.url);
  const receivedState = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const stateCookie = cookies(request)[GOOGLE_STATE_COOKIE];
  const stateValue = stateCookie
    ? await verifySignedValue(stateCookie, env.SESSION_SECRET)
    : null;
  const separator = stateValue?.lastIndexOf("|") ?? -1;
  const expectedState = stateValue?.slice(0, separator) ?? "";
  const stateExpiresAt = Number(stateValue?.slice(separator + 1));
  if (
    url.searchParams.has("error") ||
    !code ||
    !receivedState ||
    receivedState !== expectedState ||
    stateExpiresAt <= Date.now()
  ) {
    return loginPage(env, "google");
  }

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: env.GOOGLE_LOGIN_CLIENT_ID,
      client_secret: env.GOOGLE_LOGIN_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: env.GOOGLE_LOGIN_REDIRECT_URI,
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const tokens = (await tokenResponse.json().catch(() => null)) as {
    access_token?: unknown;
  } | null;
  if (!tokenResponse.ok || typeof tokens?.access_token !== "string") {
    return loginPage(env, "google");
  }
  const profileResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = (await profileResponse.json().catch(() => null)) as {
    email?: unknown;
    email_verified?: unknown;
  } | null;
  if (
    !profileResponse.ok ||
    profile?.email_verified !== true ||
    typeof profile.email !== "string" ||
    !/\S+@\S+\.\S+/u.test(profile.email)
  ) {
    return loginPage(env, "google");
  }
  const headers = new Headers({ location: "/" });
  headers.append("set-cookie", await sessionCookie(profile.email, env));
  headers.append(
    "set-cookie",
    `${GOOGLE_STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/auth/google/callback; Max-Age=0`,
  );
  return new Response(null, { headers, status: 303 });
};

const logout = () =>
  new Response(null, {
    headers: {
      location: "/login",
      "set-cookie": `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    },
    status: 303,
  });

const originRequest = async (request: Request, env: Env) => {
  const source = new URL(request.url);
  const target = new URL(`${source.pathname}${source.search}`, env.ORIGIN_URL);
  const headers = new Headers(request.headers);
  for (const name of [
    "cf-connecting-ip",
    "cf-ipcountry",
    "cf-ray",
    "cookie",
    "host",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
  ]) {
    headers.delete(name);
  }
  headers.set("x-greenlight-origin-token", env.ORIGIN_SHARED_SECRET);
  return fetch(target, {
    body:
      request.method === "GET" || request.method === "HEAD"
        ? null
        : request.body,
    headers,
    method: request.method,
    redirect: "manual",
  });
};

const cleanFilename = (value: string) => {
  const filename = value.split(/[\\/]/u).at(-1)?.trim() ?? "";
  if (!filename || filename.length > 180) throw new Error("invalid_filename");
  return filename.replaceAll(/[^A-Za-z0-9._ -]/gu, "_");
};

const uploadGrant = async (request: Request, env: Env) => {
  const body = (await request.json()) as Record<string, unknown>;
  const filename = cleanFilename(String(body.filename ?? ""));
  const projectId = String(body.project_id ?? "");
  const mimeType = String(body.mime_type ?? "application/octet-stream");
  const size = Number(body.size);
  if (!/^[A-Za-z0-9_-]{3,100}$/u.test(projectId)) {
    throw new Error("invalid_project_id");
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) {
    throw new Error("invalid_file_size");
  }
  if (!/^[\w.+-]+\/[\w.+-]+$/u.test(mimeType)) {
    throw new Error("invalid_mime_type");
  }
  const key = `demo/projects/${projectId}/uploads/${crypto.randomUUID()}-${filename}`;
  const multipart = await env.MEDIA.createMultipartUpload(key, {
    customMetadata: { filename, projectId },
    httpMetadata: { contentType: mimeType },
  });
  const grant: UploadGrant = {
    expires_at: Date.now() + UPLOAD_TTL_SECONDS * 1000,
    filename,
    key,
    mime_type: mimeType,
    project_id: projectId,
    size,
    upload_id: multipart.uploadId,
  };
  return json({
    expires_at: new Date(grant.expires_at).toISOString(),
    part_size_bytes: PART_SIZE_BYTES,
    token: await sealedValue(JSON.stringify(grant), env.SESSION_SECRET),
  });
};

const verifiedGrant = async (request: Request, env: Env, token?: unknown) => {
  const raw =
    typeof token === "string"
      ? token
      : new URL(request.url).searchParams.get("token");
  if (!raw) throw new Error("upload_token_required");
  const value = await unsealValue(raw, env.SESSION_SECRET);
  if (!value) throw new Error("invalid_upload_token");
  const grant = JSON.parse(value) as UploadGrant;
  if (grant.expires_at <= Date.now()) throw new Error("upload_token_expired");
  return grant;
};

const uploadPart = async (request: Request, env: Env) => {
  const grant = await verifiedGrant(request, env);
  const partNumber = Number(
    new URL(request.url).searchParams.get("part_number"),
  );
  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    throw new Error("invalid_part_number");
  }
  if (
    !request.body ||
    !Number.isSafeInteger(contentLength) ||
    contentLength < 1 ||
    contentLength > PART_SIZE_BYTES
  ) {
    throw new Error("invalid_part_size");
  }
  const upload = env.MEDIA.resumeMultipartUpload(grant.key, grant.upload_id);
  const part = await upload.uploadPart(partNumber, request.body);
  return json({ etag: part.etag, part_number: part.partNumber });
};

const importCompletedUpload = async (grant: UploadGrant, env: Env) => {
  const object = await env.MEDIA.get(grant.key);
  if (!object?.body) throw new Error("uploaded_object_missing");
  const target = new URL(
    `/greenlight-api/projects/${encodeURIComponent(grant.project_id)}/assets`,
    env.ORIGIN_URL,
  );
  const response = await fetch(target, {
    body: object.body,
    headers: {
      "content-length": String(object.size),
      "content-type": "application/octet-stream",
      "x-greenlight-filename": encodeURIComponent(grant.filename),
      "x-greenlight-mime": grant.mime_type,
      "x-greenlight-origin-token": env.ORIGIN_SHARED_SECRET,
      "x-greenlight-r2-key": grant.key,
      "x-greenlight-source": "cloudflare_r2",
    },
    method: "POST",
  });
  const value = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const code =
      value && typeof value === "object" && "error" in value
        ? String((value as { error: unknown }).error)
        : `origin_import_${response.status}`;
    throw new Error(code);
  }
  return value;
};

const completeUpload = async (request: Request, env: Env) => {
  const body = (await request.json()) as {
    parts?: UploadedPart[];
    token?: string;
  };
  const grant = await verifiedGrant(request, env, body.token);
  if (!Array.isArray(body.parts) || body.parts.length < 1) {
    throw new Error("upload_parts_required");
  }
  const parts = body.parts
    .map((part) => ({ etag: part.etag, partNumber: part.part_number }))
    .sort((left, right) => left.partNumber - right.partNumber);
  if (
    parts.some(
      (part, index) =>
        !part.etag ||
        !Number.isInteger(part.partNumber) ||
        part.partNumber !== index + 1,
    )
  ) {
    throw new Error("invalid_upload_parts");
  }
  let object = await env.MEDIA.head(grant.key);
  if (!object) {
    const upload = env.MEDIA.resumeMultipartUpload(grant.key, grant.upload_id);
    object = await upload.complete(parts);
  }
  if (object.size !== grant.size) throw new Error("uploaded_size_mismatch");
  return json(await importCompletedUpload(grant, env), { status: 201 });
};

const abortUpload = async (request: Request, env: Env) => {
  const body = (await request.json()) as { token?: string };
  const grant = await verifiedGrant(request, env, body.token);
  await env.MEDIA.resumeMultipartUpload(grant.key, grant.upload_id).abort();
  return new Response(null, { status: 204 });
};

const readInternalR2Object = async (request: Request, env: Env) => {
  if (
    !(await secretsMatch(
      request.headers.get("x-greenlight-origin-token"),
      env.ORIGIN_SHARED_SECRET,
    ))
  ) {
    return new Response(null, { status: 404 });
  }
  const body = (await request.json()) as { key?: unknown };
  const key = typeof body.key === "string" ? body.key : "";
  if (
    !/^demo\/projects\/[A-Za-z0-9_-]{3,100}\/uploads\/[A-Za-z0-9._ -]{1,240}$/u.test(
      key,
    )
  ) {
    return json({ error: "invalid_object_key" }, { status: 400 });
  }
  const object = await env.MEDIA.get(key);
  if (!object?.body) return new Response(null, { status: 404 });
  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-length": String(object.size),
    etag: object.httpEtag,
  });
  object.writeHttpMetadata(headers);
  return new Response(object.body, { headers });
};

const handleAuthenticated = async (request: Request, env: Env) => {
  const url = new URL(request.url);
  if (url.pathname === "/auth/logout" && request.method === "POST") {
    return logout();
  }
  if (url.pathname === "/healthz" && request.method === "GET") {
    return json({ ok: true, service: "greenlight-edge" });
  }
  if (url.pathname === "/uploads/start" && request.method === "POST") {
    return uploadGrant(request, env);
  }
  if (url.pathname === "/uploads/part" && request.method === "PUT") {
    return uploadPart(request, env);
  }
  if (url.pathname === "/uploads/complete" && request.method === "POST") {
    return completeUpload(request, env);
  }
  if (url.pathname === "/uploads/abort" && request.method === "POST") {
    return abortUpload(request, env);
  }
  if (
    url.pathname.startsWith("/greenlight-api/") ||
    url.pathname.startsWith("/trueforge/")
  ) {
    return originRequest(request, env);
  }
  return secureHeaders(await env.ASSETS.fetch(request));
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/auth/login" && request.method === "POST") {
        return secureHeaders(await login(request, env));
      }
      if (url.pathname === "/auth/google" && request.method === "GET") {
        return secureHeaders(await startGoogleLogin(env));
      }
      if (
        url.pathname === "/auth/google/callback" &&
        request.method === "GET"
      ) {
        return secureHeaders(await finishGoogleLogin(request, env));
      }
      if (url.pathname === "/internal/r2" && request.method === "POST") {
        return secureHeaders(await readInternalR2Object(request, env));
      }
      const email = await sessionEmail(request, env);
      if (!email) {
        if (url.pathname === "/healthz") {
          return json({ ok: true, service: "greenlight-edge" });
        }
        return secureHeaders(loginPage(env));
      }
      return secureHeaders(await handleAuthenticated(request, env));
    } catch (error) {
      const code = error instanceof Error ? error.message : "edge_error";
      const status =
        code.startsWith("invalid_") ||
        code.endsWith("_required") ||
        code.endsWith("_expired")
          ? 400
          : 502;
      return secureHeaders(json({ error: code }, { status }));
    }
  },
};

export const edgeInternals = {
  sealedValue,
  sign,
  signedValue,
  unsealValue,
  verifySignedValue,
};
