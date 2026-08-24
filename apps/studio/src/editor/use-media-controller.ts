import { useCallback, useEffect, useRef, useState } from "react";

export const useMediaController = () => {
  const mediaRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.82);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const scrubbing = useRef(false);
  const playbackWindow = useRef<{ start: number; end: number } | null>(null);
  const playbackRate = useRef(1);

  const togglePlay = useCallback(async () => {
    const media = mediaRef.current;
    if (!media) return;
    const window = playbackWindow.current;
    if (
      window &&
      (media.currentTime < window.start || media.currentTime >= window.end)
    ) {
      media.currentTime = window.start;
      setCurrentTime(window.start);
    }
    if (media.paused) await media.play();
    else media.pause();
  }, []);

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
      setCurrentTime(next);
      if (mediaRef.current) mediaRef.current.currentTime = next;
    },
    [clampTime],
  );

  const beginScrub = useCallback(() => {
    scrubbing.current = true;
  }, []);

  const previewSeek = useCallback(
    (seconds: number) => {
      const next = clampTime(seconds);
      setCurrentTime(next);
      if (mediaRef.current) mediaRef.current.currentTime = next;
    },
    [clampTime],
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
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
      onTimeUpdate: () => {
        const media = mediaRef.current;
        if (!media || scrubbing.current) return;
        const window = playbackWindow.current;
        if (window && media.currentTime >= window.end) {
          media.pause();
          media.currentTime = window.start;
        }
        setCurrentTime(media.currentTime);
      },
      onLoadedMetadata: () => {
        const media = mediaRef.current;
        if (!media) return;
        media.volume = volume;
        media.muted = muted;
        media.playbackRate = playbackRate.current;
        setDuration(media.duration);
      },
      onEnded: () => setPlaying(false),
    },
  };
};
