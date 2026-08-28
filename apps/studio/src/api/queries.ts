import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EditorPatchInput,
  GenerateSoundEffectInput,
  MediaLibraryResult,
} from "@greenlight/contracts";

import { greenlightApi } from "./greenlight.js";

export const greenlightKeys = {
  all: ["greenlight"] as const,
  projects: () => [...greenlightKeys.all, "projects"] as const,
  project: (projectId: string) =>
    [...greenlightKeys.projects(), projectId] as const,
  artifact: (artifactId: string) =>
    [...greenlightKeys.all, "artifacts", artifactId] as const,
  imageGeneration: () => [...greenlightKeys.all, "image-generation"] as const,
  voice: () => [...greenlightKeys.all, "voice"] as const,
  youtube: () => [...greenlightKeys.all, "youtube"] as const,
  mediaLibrary: () => [...greenlightKeys.all, "media-library"] as const,
  mediaSearch: (query: string, use: string) =>
    [...greenlightKeys.mediaLibrary(), "search", use, query] as const,
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
    queryFn: async () => ({
      artifactId: artifactId!,
      content: await greenlightApi.getContentPackage(artifactId!),
    }),
    enabled: Boolean(artifactId),
  });

export const useVoiceCapabilities = () =>
  useQuery({
    queryKey: greenlightKeys.voice(),
    queryFn: greenlightApi.getVoiceCapabilities,
    staleTime: 60_000,
  });

export const useImageGenerationCapabilities = () =>
  useQuery({
    queryKey: greenlightKeys.imageGeneration(),
    queryFn: greenlightApi.getImageGenerationCapabilities,
    refetchInterval: 60_000,
    retry: false,
    staleTime: 30_000,
  });

export const useYouTubeConnection = () =>
  useQuery({
    queryKey: greenlightKeys.youtube(),
    queryFn: greenlightApi.getYouTubeConnection,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

export const useMediaLibraryCapabilities = () =>
  useQuery({
    queryKey: greenlightKeys.mediaLibrary(),
    queryFn: greenlightApi.getMediaLibraryCapabilities,
    staleTime: 60_000,
  });

export const useMediaLibrarySearch = (
  query: string,
  use: "broll" | "music" | "sound_effect",
  enabled = true,
) =>
  useQuery({
    queryKey: greenlightKeys.mediaSearch(query, use),
    queryFn: () => greenlightApi.searchMediaLibrary({ query, use, limit: 12 }),
    enabled: enabled && query.trim().length >= 2,
    staleTime: 60_000,
  });

export const useImportMediaLibraryAsset = (projectId: string | null) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (result: MediaLibraryResult) =>
      greenlightApi.importMediaLibraryAsset(projectId!, result),
    onSuccess: async () => {
      if (!projectId) return;
      await client.invalidateQueries({
        queryKey: greenlightKeys.project(projectId),
      });
    },
  });
};

export const useGenerateSoundEffect = (projectId: string | null) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<GenerateSoundEffectInput, "project_id">) =>
      greenlightApi.generateSoundEffect(projectId!, input),
    onSuccess: async () => {
      if (!projectId) return;
      await client.invalidateQueries({
        queryKey: greenlightKeys.project(projectId),
      });
    },
  });
};

export const useVoiceSample = (projectId: string) =>
  useMutation({
    mutationFn: (input: {
      locale?: string;
      script: string;
      voice_id: string;
    }) => greenlightApi.createVoiceSample(projectId, input),
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

export const useApplyEditorPatch = (projectId: string | null) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: EditorPatchInput) =>
      greenlightApi.applyEditorPatch(projectId!, patch),
    onSuccess: async () => {
      if (!projectId) return;
      await Promise.all([
        client.invalidateQueries({
          queryKey: greenlightKeys.project(projectId),
        }),
        client.invalidateQueries({ queryKey: greenlightKeys.projects() }),
      ]);
    },
  });
};

export const useRestoreContentRevision = (projectId: string | null) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { baseArtifactId: string; targetArtifactId: string }) =>
      greenlightApi.restoreContentRevision(
        projectId!,
        input.targetArtifactId,
        input.baseArtifactId,
      ),
    onSuccess: async () => {
      if (!projectId) return;
      await Promise.all([
        client.invalidateQueries({
          queryKey: greenlightKeys.project(projectId),
        }),
        client.invalidateQueries({ queryKey: greenlightKeys.projects() }),
      ]);
    },
  });
};
