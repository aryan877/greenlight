import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

export const useCreateProject = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: greenlightApi.createProject,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: greenlightKeys.projects() });
    },
  });
};

export const useContentPackage = (artifactId: string | null) =>
  useQuery({
    queryKey: greenlightKeys.artifact(artifactId ?? "none"),
    queryFn: () => greenlightApi.getContentPackage(artifactId!),
    enabled: Boolean(artifactId),
  });

export const useUploadAsset = (projectId: string | null) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => greenlightApi.uploadAsset(projectId!, file),
    onSuccess: async () => {
      if (projectId) {
        await client.invalidateQueries({
          queryKey: greenlightKeys.project(projectId),
        });
      }
    },
  });
};
