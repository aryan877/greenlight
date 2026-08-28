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
