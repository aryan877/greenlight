import {
  contentPackageSchema,
  type Artifact,
  type ContentPackage,
  type Project,
  type ProjectBrief,
  type ReleaseSnapshot,
} from "@greenlight/contracts";

export type ProjectSummary = Project & {
  artifact_count: number;
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
  getContentPackage: (artifactId: string) =>
    request<ContentPackage>(
      `/artifacts/${encodeURIComponent(artifactId)}`,
    ).then((value) => contentPackageSchema.parse(value)),
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
  artifactUrl: (artifactId: string) =>
    `/greenlight-api/artifacts/${encodeURIComponent(artifactId)}`,
};
