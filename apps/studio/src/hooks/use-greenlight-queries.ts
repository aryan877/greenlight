import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  EditorPatchInput,
  GenerateSoundEffectInput,
  MediaLibraryResult,
} from "@greenlight/contracts";

import { greenlightApi } from "../api/greenlight.js";
import { greenlightKeys } from "../api/query-keys.js";

const requireIdentifier = (value: string | null, name: string): string => {
  if (!value) throw new Error(`${name}_not_selected`);
  return value;
};

export const useProjects = () =>
  useQuery({
    queryKey: greenlightKeys.projects(),
    queryFn: greenlightApi.listProjects,
    refetchInterval: 5_000,
  });

export const useProject = (projectId: string | null) =>
  useQuery({
    queryKey: greenlightKeys.project(projectId ?? "pending"),
    queryFn: projectId ? () => greenlightApi.getProject(projectId) : skipToken,
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
    queryKey: greenlightKeys.artifact(artifactId ?? "pending"),
    queryFn: artifactId
      ? async () => ({
          artifactId,
          content: await greenlightApi.getContentPackage(artifactId),
        })
      : skipToken,
  });

export const useEvidenceLedger = (artifactId: string | null) =>
  useQuery({
    queryKey: greenlightKeys.artifact(artifactId ?? "pending"),
    queryFn: artifactId
      ? () => greenlightApi.getEvidenceLedger(artifactId)
      : skipToken,
  });

export const useQualityReport = (artifactId: string | null) =>
  useQuery({
    queryKey: greenlightKeys.artifact(artifactId ?? "pending"),
    queryFn: artifactId
      ? () => greenlightApi.getQualityReport(artifactId)
      : skipToken,
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
      greenlightApi.importMediaLibraryAsset(
        requireIdentifier(projectId, "project"),
        result,
      ),
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
      greenlightApi.generateSoundEffect(
        requireIdentifier(projectId, "project"),
        input,
      ),
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
    mutationFn: (file: File) =>
      greenlightApi.uploadAsset(requireIdentifier(projectId, "project"), file),
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
      greenlightApi.applyEditorPatch(
        requireIdentifier(projectId, "project"),
        patch,
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

export const useRestoreContentRevision = (projectId: string | null) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { baseArtifactId: string; targetArtifactId: string }) =>
      greenlightApi.restoreContentRevision(
        requireIdentifier(projectId, "project"),
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
