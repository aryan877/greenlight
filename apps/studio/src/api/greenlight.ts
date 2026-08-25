import {
  contentPackageSchema,
  type Artifact,
  type ContentPackage,
  type EditorPatchInput,
  type Project,
  type ProjectBrief,
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

export type YouTubeConnection = {
  connected: boolean;
  channel_title: string | null;
  custom_url: string | null;
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
  getVoiceCapabilities: () => request<VoiceCapabilities>("/voice"),
  getYouTubeConnection: () => request<YouTubeConnection>("/youtube"),
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
    const response = await request<{ artifact: Artifact }>(
      `/projects/${encodeURIComponent(projectId)}/assets`,
      {
        method: "POST",
        body: file,
        headers: {
          "content-type": "application/octet-stream",
          "x-greenlight-filename": encodeURIComponent(file.name),
          "x-greenlight-mime": file.type || "application/octet-stream",
        },
      },
    );
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
