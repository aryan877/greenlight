import {
  contentPackageSchema,
  evidenceLedgerSchema,
  type Artifact,
  type ContentPackage,
  type EvidenceLedger,
  type Project,
  type ReleaseSnapshot,
} from "@greenlight/contracts";

export type ProjectDetail = {
  artifacts: Artifact[];
  project: Project;
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
  if (!response.ok) throw new Error(`Greenlight API ${response.status}`);
  return response.json() as Promise<T>;
};

export const greenlightApi = {
  listProjects: () =>
    request<{ projects: Project[] }>("/projects").then(
      (response) => response.projects,
    ),
  getProject: (projectId: string) =>
    request<ProjectDetail>(`/projects/${encodeURIComponent(projectId)}`),
  getContentPackage: (artifactId: string) =>
    request<ContentPackage>(
      `/artifacts/${encodeURIComponent(artifactId)}`,
    ).then((value) => contentPackageSchema.parse(value)),
  getEvidenceLedger: (artifactId: string) =>
    request<EvidenceLedger>(
      `/artifacts/${encodeURIComponent(artifactId)}`,
    ).then((value) => evidenceLedgerSchema.parse(value)),
  artifactUrl: (artifactId: string) =>
    `/greenlight-api/artifacts/${encodeURIComponent(artifactId)}`,
};
