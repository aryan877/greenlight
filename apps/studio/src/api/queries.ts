import { useQuery } from "@tanstack/react-query";

import { greenlightApi } from "./greenlight.js";

export const greenlightKeys = {
  all: ["greenlight"] as const,
  projects: () => [...greenlightKeys.all, "projects"] as const,
  project: (projectId: string) =>
    [...greenlightKeys.projects(), projectId] as const,
  artifact: (artifactId: string) =>
    [...greenlightKeys.all, "artifacts", artifactId] as const,
};

export const useProjects = () =>
  useQuery({
    queryKey: greenlightKeys.projects(),
    queryFn: greenlightApi.listProjects,
    refetchInterval: 5_000,
  });

export const useProject = (projectId: string | null) =>
  useQuery({
    queryKey: greenlightKeys.project(projectId ?? "none"),
    queryFn: () => greenlightApi.getProject(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: 3_000,
  });

export const useContentPackage = (artifactId: string | null) =>
  useQuery({
    queryKey: greenlightKeys.artifact(artifactId ?? "none"),
    queryFn: () => greenlightApi.getContentPackage(artifactId!),
    enabled: Boolean(artifactId),
  });

export const useEvidenceLedger = (artifactId: string | null) =>
  useQuery({
    queryKey: greenlightKeys.artifact(artifactId ?? "none"),
    queryFn: () => greenlightApi.getEvidenceLedger(artifactId!),
    enabled: Boolean(artifactId),
  });
