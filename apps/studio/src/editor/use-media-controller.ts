import { useCallback, useEffect, useRef, useState } from "react";

export type MediaTimelineAudioSource = {
  id: string;
  url: string;
  startSeconds: number;
  endSeconds: number;
  sourceInSeconds: number;
  playbackRate: number;
  gain: number;
};

export const useMediaController = () => {
  const mediaRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.82);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const currentTimeRef = useRef(0);
  const playingRef = useRef(false);
  const animationFrame = useRef<number | null>(null);
  const scrubbing = useRef(false);
  const playbackWindow = useRef<{ start: number; end: number } | null>(null);
  const playbackRate = useRef(1);
  const mutedRef = useRef(false);
  const volumeRef = useRef(0.82);
  const timelineAudioSources = useRef<MediaTimelineAudioSource[]>([]);
  const timelineAudio = useRef(new Map<string, HTMLAudioElement>());

  const syncNativeMute = useCallback((masterMuted: boolean) => {
    if (!mediaRef.current) return;
    mediaRef.current.muted =
      masterMuted || timelineAudioSources.current.length > 0;
  }, []);

  const syncTimelineAudio = useCallback(
    (seconds: number, shouldPlay: boolean) => {
      const sources = timelineAudioSources.current;
      const sourceIds = new Set(sources.map((source) => source.id));
      for (const [id, audio] of timelineAudio.current) {
        if (sourceIds.has(id)) continue;
        audio.pause();
        timelineAudio.current.delete(id);
      }

      for (const source of sources) {
        let audio = timelineAudio.current.get(source.id);
        if (!audio) {
          audio = new Audio(source.url);
          audio.preload = "auto";
          timelineAudio.current.set(source.id, audio);
        } else if (audio.getAttribute("src") !== source.url) {
          audio.pause();
          audio.src = source.url;
        }
        audio.muted = mutedRef.current;
        audio.volume = Math.max(
          0,
          Math.min(1, volumeRef.current * source.gain),
        );
        audio.playbackRate = source.playbackRate;

        const active =
          seconds >= source.startSeconds && seconds < source.endSeconds;
        if (!active) {
          if (!audio.paused) audio.pause();
          continue;
        }

        const expected =
          source.sourceInSeconds +
          (seconds - source.startSeconds) * source.playbackRate;
        if (Math.abs(audio.currentTime - expected) > 0.12) {
          audio.currentTime = Math.max(0, expected);
        }
        if (shouldPlay && audio.paused)
          void audio.play().catch(() => undefined);
        if (!shouldPlay && !audio.paused) audio.pause();
      }
    },
    [],
  );

  const updateCurrentTime = useCallback((seconds: number) => {
    currentTimeRef.current = seconds;
    setCurrentTime(seconds);
  }, []);

  const stopVirtualPlayback = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    if (animationFrame.current !== null) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }
    syncTimelineAudio(currentTimeRef.current, false);
  }, [syncTimelineAudio]);

  useEffect(
    () => () => {
      stopVirtualPlayback();
      for (const audio of timelineAudio.current.values()) audio.pause();
      timelineAudio.current.clear();
    },
    [stopVirtualPlayback],
  );

  const togglePlay = useCallback(
    async (timelineDuration = 0) => {
      const media = mediaRef.current;
      if (!media) {
        if (timelineDuration <= 0) return;
        if (playingRef.current) {
          stopVirtualPlayback();
          return;
        }
        setDuration(timelineDuration);
        const window = playbackWindow.current;
        const start = window?.start ?? 0;
        const end = Math.min(window?.end ?? timelineDuration, timelineDuration);
        if (currentTimeRef.current < start || currentTimeRef.current >= end) {
          updateCurrentTime(start);
        }
        playingRef.current = true;
        setPlaying(true);
        syncTimelineAudio(currentTimeRef.current, true);
        let previous = performance.now();
        const advance = (now: number) => {
          if (!playingRef.current) return;
          const elapsedSeconds =
            ((now - previous) / 1000) * playbackRate.current;
          previous = now;
          const next = Math.min(end, currentTimeRef.current + elapsedSeconds);
          updateCurrentTime(next);
          syncTimelineAudio(next, true);
          if (next >= end) {
            stopVirtualPlayback();
            return;
          }
          animationFrame.current = requestAnimationFrame(advance);
        };
        animationFrame.current = requestAnimationFrame(advance);
        return;
      }
      const window = playbackWindow.current;
      if (
        window &&
        (media.currentTime < window.start || media.currentTime >= window.end)
      ) {
        media.currentTime = window.start;
        updateCurrentTime(window.start);
      }
      if (media.paused) {
        syncTimelineAudio(media.currentTime, true);
        try {
          await media.play();
        } catch {
          syncTimelineAudio(media.currentTime, false);
        }
      } else {
        media.pause();
        syncTimelineAudio(media.currentTime, false);
      }
    },
    [stopVirtualPlayback, syncTimelineAudio, updateCurrentTime],
  );

  const clampTime = useCallback(
    (seconds: number) => {
      const media = mediaRef.current;
      const knownDuration = media?.duration || duration || seconds;
      return Math.max(0, Math.min(seconds, knownDuration));
    },
    [duration],
  );

  const seek = useCallback(
    (seconds: number) => {
      const next = clampTime(seconds);
      updateCurrentTime(next);
      if (mediaRef.current) mediaRef.current.currentTime = next;
      syncTimelineAudio(next, playingRef.current);
    },
    [clampTime, syncTimelineAudio, updateCurrentTime],
  );

  const beginScrub = useCallback(() => {
    scrubbing.current = true;
  }, []);

  const previewSeek = useCallback(
    (seconds: number) => {
      const next = clampTime(seconds);
      updateCurrentTime(next);
      if (mediaRef.current) mediaRef.current.currentTime = next;
      syncTimelineAudio(next, playingRef.current);
    },
    [clampTime, syncTimelineAudio, updateCurrentTime],
  );

  const endScrub = useCallback(
    (seconds: number) => {
      previewSeek(seconds);
      scrubbing.current = false;
    },
    [previewSeek],
  );

  const updateVolume = useCallback(
    (next: number) => {
      const safe = Math.max(0, Math.min(1, next));
      volumeRef.current = safe;
      setVolume(safe);
      if (mediaRef.current) mediaRef.current.volume = safe;
      if (safe > 0) {
        mutedRef.current = false;
        setMuted(false);
        syncNativeMute(false);
      }
      syncTimelineAudio(currentTimeRef.current, playingRef.current);
    },
    [syncNativeMute, syncTimelineAudio],
  );

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      mutedRef.current = next;
      syncNativeMute(next);
      syncTimelineAudio(currentTimeRef.current, playingRef.current);
      return next;
    });
  }, [syncNativeMute, syncTimelineAudio]);

  const setTimelineAudioSources = useCallback(
    (sources: MediaTimelineAudioSource[]) => {
      timelineAudioSources.current = sources;
      syncNativeMute(mutedRef.current);
      syncTimelineAudio(currentTimeRef.current, playingRef.current);
    },
    [syncNativeMute, syncTimelineAudio],
  );

  const setPlaybackWindow = useCallback(
    (window: { start: number; end: number } | null) => {
      playbackWindow.current = window;
    },
    [],
  );

  const setPlaybackRate = useCallback((rate: number) => {
    const safe = Math.max(0.5, Math.min(3, rate));
    playbackRate.current = safe;
    if (mediaRef.current) mediaRef.current.playbackRate = safe;
  }, []);

  return {
    mediaRef,
    playing,
    muted,
    volume,
    currentTime,
    duration,
    togglePlay,
    seek,
    beginScrub,
    previewSeek,
    endScrub,
    updateVolume,
    toggleMute,
    setPlaybackWindow,
    setPlaybackRate,
    setTimelineAudioSources,
    mediaEvents: {
      onPlay: () => {
        playingRef.current = true;
        setPlaying(true);
        syncTimelineAudio(currentTimeRef.current, true);
      },
      onPause: () => {
        playingRef.current = false;
        setPlaying(false);
        syncTimelineAudio(currentTimeRef.current, false);
      },
      onTimeUpdate: () => {
        const media = mediaRef.current;
        if (!media || scrubbing.current) return;
        const window = playbackWindow.current;
        if (window && media.currentTime >= window.end) {
          media.pause();
          media.currentTime = window.start;
        }
        updateCurrentTime(media.currentTime);
        syncTimelineAudio(media.currentTime, !media.paused);
      },
      onLoadedMetadata: () => {
        const media = mediaRef.current;
        if (!media) return;
        media.volume = volume;
        syncNativeMute(muted);
        media.playbackRate = playbackRate.current;
        setDuration(media.duration);
      },
      onEnded: () => {
        playingRef.current = false;
        setPlaying(false);
        syncTimelineAudio(currentTimeRef.current, false);
      },
    },
  };
};
