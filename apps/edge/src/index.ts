interface Env {
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
  DEMO_EMAIL: string;
  DEMO_PASSWORD: string;
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
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const UPLOAD_TTL_SECONDS = 60 * 60;
const PART_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const encoder = new TextEncoder();

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

const cookies = (request: Request) =>
  Object.fromEntries(
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((entry) => entry.trim().split("=", 2))
      .filter(([name, value]) => Boolean(name && value)),
  );

const sessionEmail = async (request: Request, env: Env) => {
  const token = cookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const value = await verifySignedValue(token, env.SESSION_SECRET);
  if (!value) return null;
  const [email, expiresAt] = value.split("|", 2);
  return email === env.DEMO_EMAIL && Number(expiresAt) > Date.now()
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

const loginPage = (env: Env, invalid = false) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Greenlight demo</title><style>*{box-sizing:border-box}body{margin:0;background:#0b0d0c;color:#f3f5f2;font:15px Archivo,system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{border:1px solid #343936;background:#111411;padding:24px;width:min(380px,calc(100vw - 32px))}h1{font-size:24px;margin:0 0 8px}p{color:#aeb5af;line-height:1.5;margin:0 0 20px}label{display:block;font-size:12px;margin:14px 0 6px;text-transform:uppercase;letter-spacing:.08em}input,button{border:1px solid #3e4640;border-radius:0;font:inherit;width:100%;padding:11px 12px}input{background:#0b0d0c;color:#fff}button{background:#c8ff3d;border-color:#c8ff3d;color:#10130e;font-weight:700;margin-top:18px;cursor:pointer}.error{color:#ff8c82;margin-bottom:12px}.hint{font:12px ui-monospace,SFMono-Regular,monospace;color:#8f988f;margin-top:14px}</style></head><body><main class="card"><h1>Greenlight</h1><p>Private hackathon demo. Use the test account below.</p>${invalid ? '<div class="error">That login did not match.</div>' : ""}<form method="post" action="/auth/login"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" value="${env.DEMO_EMAIL}" required><label for="password">Password</label><input id="password" name="password" type="text" autocomplete="current-password" value="${env.DEMO_PASSWORD}" required><button type="submit">Enter Studio</button></form><div class="hint">Credentials are intentionally shared for judging.</div></main></body></html>`,
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
      : loginPage(env, true);
  }
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const token = await signedValue(`${email}|${expiresAt}`, env.SESSION_SECRET);
  const headers = new Headers({
    location: "/",
    "set-cookie": `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`,
  });
  return new Response(null, { headers, status: 303 });
};

const logout = () =>
  new Response(null, {
    headers: {
      location: "/",
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
    token: await signedValue(JSON.stringify(grant), env.SESSION_SECRET),
  });
};

const verifiedGrant = async (request: Request, env: Env, token?: unknown) => {
  const raw =
    typeof token === "string"
      ? token
      : new URL(request.url).searchParams.get("token");
  if (!raw) throw new Error("upload_token_required");
  const value = await verifySignedValue(raw, env.SESSION_SECRET);
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
  const upload = env.MEDIA.resumeMultipartUpload(grant.key, grant.upload_id);
  const object = await upload.complete(parts);
  if (object.size !== grant.size) throw new Error("uploaded_size_mismatch");
  return json(await importCompletedUpload(grant, env), { status: 201 });
};

const abortUpload = async (request: Request, env: Env) => {
  const body = (await request.json()) as { token?: string };
  const grant = await verifiedGrant(request, env, body.token);
  await env.MEDIA.resumeMultipartUpload(grant.key, grant.upload_id).abort();
  return new Response(null, { status: 204 });
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

export const edgeInternals = { sign, signedValue, verifySignedValue };
