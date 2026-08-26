import {
  soundEffectPresetRegistry,
  type GenerateSoundEffectInput,
  type SoundEffectPresetId,
} from "@greenlight/contracts";

const SAMPLE_RATE = 48_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const hashPreset = (preset: SoundEffectPresetId, variant: number) =>
  [...preset].reduce((hash, character) => {
    return Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0;
  }, 2_166_136_261 ^ variant);

const clamp = (value: number) => Math.max(-1, Math.min(1, value));
const smoothstep = (value: number) => value * value * (3 - 2 * value);

const envelope = (progress: number, attack: number, release: number) => {
  const attackGain = smoothstep(Math.min(1, progress / attack));
  const releaseGain = smoothstep(
    Math.min(1, Math.max(0, (1 - progress) / release)),
  );
  return attackGain * releaseGain;
};

const synthSample = (
  preset: SoundEffectPresetId,
  time: number,
  duration: number,
  random: () => number,
) => {
  const progress = time / duration;
  const noise = random() * 2 - 1;
  const sine = (frequency: number, phase = 0) =>
    Math.sin(2 * Math.PI * frequency * time + phase);

  switch (preset) {
    case "whoosh":
      return (
        noise * (0.25 + 0.75 * progress) * envelope(progress, 0.08, 0.4) +
        0.18 * sine(140 + progress * 720)
      );
    case "pop":
      return (
        (0.65 * sine(210 - progress * 90) + 0.35 * noise) *
        Math.exp(-progress * 12)
      );
    case "impact":
      return (
        (0.82 * sine(72 - progress * 30) + 0.22 * noise) *
        Math.exp(-progress * 7)
      );
    case "riser":
      return (
        (0.55 * sine(120 + progress * progress * 1_600) + 0.3 * noise) *
        envelope(progress, 0.45, 0.08)
      );
    case "drone":
      return (
        (0.5 * sine(55) + 0.25 * sine(82.5) + 0.15 * sine(110)) *
        envelope(progress, 0.12, 0.18)
      );
    case "notification":
      return (
        (sine(660) + 0.65 * sine(990)) *
        Math.exp(-progress * 5) *
        (progress < 0.48 || progress > 0.62 ? 1 : 0)
      );
    case "glitch":
      return (
        (0.65 * noise + 0.35 * sine(180 + Math.floor(progress * 14) * 75)) *
        (Math.floor(progress * 32) % 3 === 0 ? 1 : 0.35) *
        envelope(progress, 0.03, 0.08)
      );
    case "transition_sweep":
      return (
        (0.45 * noise + 0.45 * sine(1_100 - progress * 900)) *
        envelope(progress, 0.06, 0.35)
      );
    case "bass_hit":
      return (
        (0.9 * sine(96 - progress * 58) + 0.12 * noise) *
        Math.exp(-progress * 8)
      );
    case "ambient_noise":
      return (
        (0.65 * noise + 0.2 * sine(48) + 0.1 * sine(71)) *
        envelope(progress, 0.08, 0.08)
      );
  }
};

const encodeWav = (samples: Int16Array) => {
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const dataSize = samples.length * bytesPerSample;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(CHANNELS, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * CHANNELS * bytesPerSample, 28);
  wav.writeUInt16LE(CHANNELS * bytesPerSample, 32);
  wav.writeUInt16LE(BITS_PER_SAMPLE, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index += 1) {
    wav.writeInt16LE(samples[index] ?? 0, 44 + index * bytesPerSample);
  }
  return wav;
};

export const generateSoundEffect = (input: GenerateSoundEffectInput) => {
  const durationSeconds =
    input.duration_seconds ??
    soundEffectPresetRegistry[input.preset_id].default_duration_seconds;
  const sampleCount = Math.max(1, Math.round(durationSeconds * SAMPLE_RATE));
  const random = seededRandom(hashPreset(input.preset_id, input.variant));
  const samples = new Int16Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / SAMPLE_RATE;
    const sample = synthSample(input.preset_id, time, durationSeconds, random);
    samples[index] = Math.round(clamp(sample * input.intensity) * 32_767);
  }
  return {
    bytes: encodeWav(samples),
    durationSeconds: sampleCount / SAMPLE_RATE,
    sampleRate: SAMPLE_RATE,
  };
};
