export type WaveformAnalysis = {
  peaks: number[];
  peak: number;
  rms: number;
};

export const analyzePcm = (
  samples: Float32Array,
  bucketCount = 48,
): WaveformAnalysis => {
  if (samples.length === 0 || bucketCount <= 0) {
    return { peaks: [], peak: 0, rms: 0 };
  }
  const buckets = Math.min(bucketCount, samples.length);
  const peaks = Array.from({ length: buckets }, (_, index) => {
    const start = Math.floor((index * samples.length) / buckets);
    const end = Math.max(
      start + 1,
      Math.floor(((index + 1) * samples.length) / buckets),
    );
    let peak = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      peak = Math.max(peak, Math.abs(samples[cursor] ?? 0));
    }
    return peak;
  });
  let sumSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude);
    sumSquares += sample * sample;
  }
  return {
    peaks,
    peak,
    rms: Math.sqrt(sumSquares / samples.length),
  };
};

export const normalizationGain = (
  rms: number,
  role: "narration" | "dub" | "music" | "effects" | null,
) => {
  if (rms <= 0) return 1;
  const targetRms = role === "music" || role === "effects" ? 0.063 : 0.126;
  return Math.min(2, Math.max(0, targetRms / rms));
};
