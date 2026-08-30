import {
  contentPackageSchema,
  evidenceLedgerSchema,
  qualityReportSchema,
  type Artifact,
  type ContentPackage,
  type EditorPatchInput,
  type EvidenceLedger,
  type GenerateSoundEffectInput,
  type MediaLibraryResult,
  type Project,
  type ProjectBrief,
  type QualityReport,
  type ReleaseSnapshot,
} from "@greenlight/contracts";

export type ProjectSummary = Project & {
  artifact_count: number;
  current_content_package_artifact_id: string | null;
  workspace_path: string;
};

export type ProjectDetail = {
  artifacts: Artifact[];
  project: ProjectSummary;
  release: {
    privacy: string;
    snapshot: ReleaseSnapshot;
    snapshotSha256: string;
  } | null;
};

export type VoiceOption = {
  character: string;
  id: string;
};

export type VoiceCapabilities = {
  available: boolean;
  model: string | null;
  provider: "openrouter" | "disabled";
  voice_id: string | null;
  voices: VoiceOption[];
};

export type ImageGenerationCapabilities = {
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

export type YouTubeConnection = {
  connected: boolean;
  channel_title: string | null;
  custom_url: string | null;
};

export type MediaLibraryCapabilities = {
  openverse: { available: boolean; use: "music_and_sound_effects" };
  pexels: { available: boolean; use: "broll" };
};

export type ImportedLibraryAsset = {
  artifact: Artifact;
  licenseArtifact: Artifact;
  cached: boolean;
};

export type GeneratedSoundEffect = {
  artifact: Artifact;
  cached: boolean;
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/greenlight-api${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...init?.headers,
    },
  });
  const value = (await response.json().catch(() => null)) as
    T | { error?: string } | null;
  if (!response.ok) {
    const code =
      value && typeof value === "object" && "error" in value
        ? value.error
        : null;
    throw new Error(code || `Greenlight API ${response.status}`);
  }
  return value as T;
};

const edgeRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...init?.headers,
    },
  });
  const value = (await response.json().catch(() => null)) as
    T | { error?: string } | null;
  if (!response.ok) {
    const code =
      value && typeof value === "object" && "error" in value
        ? value.error
        : null;
    throw new Error(code || `Greenlight edge ${response.status}`);
  }
  return value as T;
};

const uploadToR2 = async (projectId: string, file: File) => {
  const grant = await edgeRequest<{
    part_size_bytes: number;
    token: string;
  }>("/uploads/start", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      project_id: projectId,
      size: file.size,
    }),
    headers: { "content-type": "application/json" },
  });
  const parts: Array<{ etag: string; part_number: number }> = [];
  try {
    for (
      let offset = 0, partNumber = 1;
      offset < file.size;
      offset += grant.part_size_bytes, partNumber += 1
    ) {
      const part = file.slice(
        offset,
        Math.min(file.size, offset + grant.part_size_bytes),
      );
      parts.push(
        await edgeRequest<{ etag: string; part_number: number }>(
          `/uploads/part?token=${encodeURIComponent(grant.token)}&part_number=${String(partNumber)}`,
          {
            method: "PUT",
            body: part,
            headers: { "content-type": "application/octet-stream" },
          },
        ),
      );
    }
    return await edgeRequest<{ artifact: Artifact }>("/uploads/complete", {
      method: "POST",
      body: JSON.stringify({ parts, token: grant.token }),
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    await edgeRequest<void>("/uploads/abort", {
      method: "POST",
      body: JSON.stringify({ token: grant.token }),
      headers: { "content-type": "application/json" },
    }).catch(() => undefined);
    throw error;
  }
};

const requestJsonArtifact = async <T>(artifactId: string): Promise<T> => {
  const response = await fetch(
    `/greenlight-api/artifacts/${encodeURIComponent(artifactId)}`,
    { headers: { accept: "application/json" } },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Greenlight API ${response.status}`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error("Greenlight returned an invalid JSON artifact");
  }
};

export const greenlightApi = {
  listProjects: () =>
    request<{ projects: ProjectSummary[] }>("/projects").then(
      (response) => response.projects,
    ),
  createProject: (brief: ProjectBrief) =>
    request<{ project: ProjectSummary }>("/projects", {
      method: "POST",
      body: JSON.stringify(brief),
      headers: { "content-type": "application/json" },
    }).then((response) => response.project),
  getProject: (projectId: string) =>
    request<ProjectDetail>(`/projects/${encodeURIComponent(projectId)}`),
  getEvidenceLedger: (artifactId: string): Promise<EvidenceLedger> =>
    requestJsonArtifact<unknown>(artifactId).then((value) =>
      evidenceLedgerSchema.parse(value),
    ),
  getQualityReport: (artifactId: string): Promise<QualityReport> =>
    requestJsonArtifact<unknown>(artifactId).then((value) =>
      qualityReportSchema.parse(value),
    ),
  getImageGenerationCapabilities: () =>
    request<ImageGenerationCapabilities>("/image-generation"),
  getVoiceCapabilities: () => request<VoiceCapabilities>("/voice"),
  getYouTubeConnection: () => request<YouTubeConnection>("/youtube"),
  getMediaLibraryCapabilities: () =>
    request<MediaLibraryCapabilities>("/media-library/capabilities"),
  searchMediaLibrary: (input: {
    limit?: number;
    orientation?: "landscape" | "portrait" | "square";
    provider?: "pexels" | "openverse";
    query: string;
    use: "broll" | "music" | "sound_effect";
  }) => {
    const query = new URLSearchParams({ query: input.query, use: input.use });
    if (input.limit) query.set("limit", String(input.limit));
    if (input.orientation) query.set("orientation", input.orientation);
    if (input.provider) query.set("provider", input.provider);
    return request<{ results: MediaLibraryResult[] }>(
      `/media-library/search?${query.toString()}`,
    ).then((response) => response.results);
  },
  importMediaLibraryAsset: (
    projectId: string,
    input: Pick<MediaLibraryResult, "provider" | "provider_asset_id" | "use">,
  ) =>
    request<ImportedLibraryAsset>(
      `/projects/${encodeURIComponent(projectId)}/media-library/import`,
      {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
      },
    ),
  generateSoundEffect: (
    projectId: string,
    input: Omit<GenerateSoundEffectInput, "project_id">,
  ) =>
    request<GeneratedSoundEffect>(
      `/projects/${encodeURIComponent(projectId)}/sound-effects`,
      {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
      },
    ),
  createVoiceSample: (
    projectId: string,
    input: { locale?: string; script: string; voice_id: string },
  ) =>
    request<{ artifact: Artifact; cached: boolean }>(
      `/projects/${encodeURIComponent(projectId)}/voice-samples`,
      {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
      },
    ),
  applyEditorPatch: (projectId: string, patch: EditorPatchInput) =>
    request<{
      content_package_artifact: Artifact;
      patch_artifact: Artifact;
      project: ProjectSummary;
    }>(`/projects/${encodeURIComponent(projectId)}/editor-patches`, {
      method: "POST",
      body: JSON.stringify(patch),
      headers: { "content-type": "application/json" },
    }),
  restoreContentRevision: (
    projectId: string,
    targetArtifactId: string,
    baseArtifactId: string,
  ) =>
    request<{
      content_package_artifact: Artifact;
      patch_artifact: Artifact;
      project: ProjectSummary;
    }>(
      `/projects/${encodeURIComponent(projectId)}/content-revisions/${encodeURIComponent(targetArtifactId)}/restore`,
      {
        method: "POST",
        body: JSON.stringify({
          base_content_package_artifact_id: baseArtifactId,
        }),
        headers: { "content-type": "application/json" },
      },
    ),
  getContentPackage: (artifactId: string) =>
    requestJsonArtifact<ContentPackage>(artifactId).then((value) =>
      contentPackageSchema.parse(value),
    ),
  uploadAsset: async (projectId: string, file: File) => {
    const response = await uploadToR2(projectId, file);
    return response.artifact;
  },
  uploadSandboxAsset: async (
    projectId: string,
    file: File,
    origin: { path: string; sessionId: string; turnId: string },
  ) => {
    const response = await request<{ artifact: Artifact }>(
      `/projects/${encodeURIComponent(projectId)}/assets`,
      {
        method: "POST",
        body: file,
        headers: {
          "content-type": "application/octet-stream",
          "x-greenlight-filename": encodeURIComponent(file.name),
          "x-greenlight-mime": file.type || "application/octet-stream",
          "x-greenlight-source": "trueforge_sandbox",
          "x-greenlight-session-id": origin.sessionId,
          "x-greenlight-turn-id": origin.turnId,
          "x-greenlight-sandbox-path": encodeURIComponent(origin.path),
        },
      },
    );
    return response.artifact;
  },
  artifactUrl: (artifactId: string) =>
    `/greenlight-api/artifacts/${encodeURIComponent(artifactId)}`,
};
