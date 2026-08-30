import { useEffect, useState } from "react";

import { greenlightApi } from "../api/greenlight.js";
import {
  analyzePcm,
  type WaveformAnalysis,
} from "../editor/audio-waveforms.js";

const cache = new Map<string, WaveformAnalysis>();

export const useAudioWaveforms = (artifactIds: string[]) => {
  const [analyses, setAnalyses] = useState<Map<string, WaveformAnalysis>>(
    () => new Map(),
  );
  const key = [...new Set(artifactIds)].sort().join("|");

  useEffect(() => {
    const ids = key ? key.split("|") : [];
    if (ids.length === 0 || typeof AudioContext === "undefined") {
      setAnalyses(new Map());
      return;
    }
    let cancelled = false;
    const context = new AudioContext();
    void Promise.all(
      ids.map(async (artifactId) => {
        const cached = cache.get(artifactId);
        if (cached) return [artifactId, cached] as const;
        const response = await fetch(greenlightApi.artifactUrl(artifactId));
        if (!response.ok) throw new Error("Audio artifact unavailable");
        const buffer = await context.decodeAudioData(
          await response.arrayBuffer(),
        );
        const analysis = analyzePcm(buffer.getChannelData(0));
        cache.set(artifactId, analysis);
        return [artifactId, analysis] as const;
      }),
    )
      .then((entries) => {
        if (!cancelled) setAnalyses(new Map(entries));
      })
      .catch(() => {
        if (!cancelled) {
          setAnalyses(
            new Map(
              ids.flatMap((id) => {
                const value = cache.get(id);
                return value ? ([[id, value]] as const) : [];
              }),
            ),
          );
        }
      })
      .finally(() => void context.close());
    return () => {
      cancelled = true;
      void context.close();
    };
  }, [key]);

  return analyses;
};
