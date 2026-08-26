import { extname } from "node:path";

import type { Artifact } from "@greenlight/contracts";

import { probeImportedMedia } from "../providers/media-metadata.js";
import type { MediaLibraryProvider } from "../providers/media-library.js";
import type { ArtifactStore } from "../storage/artifacts.js";
import type { GreenlightStore } from "../storage/store.js";

export const importLibraryAsset = async (input: {
  artifacts: ArtifactStore;
  library: MediaLibraryProvider;
  projectId: string;
  provider: "pexels" | "openverse";
  providerAssetId: string;
  store: GreenlightStore;
  use: "broll" | "music" | "sound_effect";
}): Promise<{
  artifact: Artifact;
  licenseArtifact: Artifact;
  cached: boolean;
}> => {
  if (!input.store.getProject(input.projectId))
    throw new Error("project_not_found");

  const existing = input.store
    .listArtifacts(input.projectId)
    .find(
      (artifact) =>
        artifact.provenance.source === "media_library" &&
        artifact.provenance.provider === input.provider &&
        artifact.provenance.provider_asset_id === input.providerAssetId &&
        artifact.provenance.use === input.use,
    );
  if (existing) {
    const licenseArtifactId = existing.provenance.license_artifact_id;
    if (typeof licenseArtifactId === "string") {
      const licenseArtifact = input.store.getArtifact(licenseArtifactId);
      if (licenseArtifact?.kind === "media_license") {
        return { artifact: existing, licenseArtifact, cached: true };
      }
    }
  }

  const resolved = await input.library.resolve({
    provider: input.provider,
    providerAssetId: input.providerAssetId,
    use: input.use,
  });
  const licenseArtifact = await input.artifacts.importJson({
    projectId: input.projectId,
    kind: "media_license",
    value: resolved.receipt,
    provenance: {
      producer: "greenlight",
      source: "provider_license_receipt",
      provider: resolved.receipt.provider,
      provider_asset_id: resolved.receipt.provider_asset_id,
      verified_at: resolved.receipt.verified_at,
    },
  });
  const extension = extname(resolved.filename).toLowerCase();
  const metadata = await probeImportedMedia(extension, resolved.bytes);
  const artifact = await input.artifacts.importBuffer({
    projectId: input.projectId,
    kind: resolved.kind,
    filename: resolved.filename,
    bytes: resolved.bytes,
    provenance: {
      producer: "greenlight",
      source: "media_library",
      original_filename: resolved.filename,
      title: resolved.result.title,
      provider: resolved.result.provider,
      provider_asset_id: resolved.result.provider_asset_id,
      use: resolved.result.use,
      source_url: resolved.result.source_url,
      license_artifact_id: licenseArtifact.id,
      media_metadata: metadata,
      media_probe_status: metadata ? "measured" : "unavailable",
    },
  });
  return { artifact, licenseArtifact, cached: false };
};
