import { useCallback, useEffect, useRef, useState } from "react";

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
  }, []);

  useEffect(() => stopVirtualPlayback, [stopVirtualPlayback]);

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
        let previous = performance.now();
        const advance = (now: number) => {
          if (!playingRef.current) return;
          const elapsedSeconds =
            ((now - previous) / 1000) * playbackRate.current;
          previous = now;
          const next = Math.min(end, currentTimeRef.current + elapsedSeconds);
          updateCurrentTime(next);
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
      if (media.paused) await media.play();
      else media.pause();
    },
    [stopVirtualPlayback, updateCurrentTime],
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
    },
    [clampTime, updateCurrentTime],
  );

  const beginScrub = useCallback(() => {
    scrubbing.current = true;
  }, []);

  const previewSeek = useCallback(
    (seconds: number) => {
      const next = clampTime(seconds);
      updateCurrentTime(next);
      if (mediaRef.current) mediaRef.current.currentTime = next;
    },
    [clampTime, updateCurrentTime],
  );

  const endScrub = useCallback(
    (seconds: number) => {
      previewSeek(seconds);
      scrubbing.current = false;
    },
    [previewSeek],
  );

  const updateVolume = useCallback((next: number) => {
    const safe = Math.max(0, Math.min(1, next));
    setVolume(safe);
    if (mediaRef.current) mediaRef.current.volume = safe;
    if (safe > 0) {
      setMuted(false);
      if (mediaRef.current) mediaRef.current.muted = false;
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      if (mediaRef.current) mediaRef.current.muted = next;
      return next;
    });
  }, []);

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
    mediaEvents: {
      onPlay: () => {
        playingRef.current = true;
        setPlaying(true);
      },
      onPause: () => {
        playingRef.current = false;
        setPlaying(false);
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
      },
      onLoadedMetadata: () => {
        const media = mediaRef.current;
        if (!media) return;
        media.volume = volume;
        media.muted = muted;
        media.playbackRate = playbackRate.current;
        setDuration(media.duration);
      },
      onEnded: () => {
        playingRef.current = false;
        setPlaying(false);
      },
    },
  };
};
