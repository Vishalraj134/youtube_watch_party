import React, { useEffect, useRef, useState } from 'react';

// Global promise to guarantee YouTube API is injected and ready only once
let ytApiPromise = null;

function loadYouTubeIframeApi() {
  if (window.YT && window.YT.Player) {
    return Promise.resolve(window.YT);
  }

  if (ytApiPromise) {
    return ytApiPromise;
  }

  ytApiPromise = new Promise((resolve) => {
    // If script tag already exists on page
    if (!document.getElementById('youtube-iframe-api')) {
      const tag = document.createElement('script');
      tag.id = 'youtube-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }

    const previousOnReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousOnReady === 'function') previousOnReady();
      resolve(window.YT);
    };
  });

  return ytApiPromise;
}

export default function YouTubePlayer({
  videoId,
  initialTime = 0,
  initialPlaybackStatus = 'paused',
  canControl = false,
  onPlayerReady,
  onLocalStateChange,
  onTimeUpdate,
  onError,
}) {
  const containerId = useRef(`yt-player-${Math.random().toString(36).slice(2, 9)}`);
  const playerRef = useRef(null);
  const isPlayerReadyRef = useRef(false);
  const currentLoadedVideoIdRef = useRef(videoId || 'aqz-KE-bpKQ');
  const pendingVideoIdRef = useRef(null);
  const timeIntervalRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playerError, setPlayerError] = useState(null);

  // Keep latest references to external callbacks to prevent stale closures inside YouTube event listeners
  const onPlayerReadyRef = useRef(onPlayerReady);
  onPlayerReadyRef.current = onPlayerReady;

  const onLocalStateChangeRef = useRef(onLocalStateChange);
  onLocalStateChangeRef.current = onLocalStateChange;

  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Helper to load or cue video in player without destroying iframe
  const loadOrCueVideo = (vid, startSec = 0, status = 'paused') => {
    if (!playerRef.current) return;
    try {
      if (status === 'playing') {
        if (typeof playerRef.current.loadVideoById === 'function') {
          playerRef.current.loadVideoById({ videoId: vid, startSeconds: startSec });
        } else if (typeof playerRef.current.cueVideoById === 'function') {
          playerRef.current.cueVideoById({ videoId: vid, startSeconds: startSec });
          playerRef.current.playVideo?.();
        }
      } else {
        if (typeof playerRef.current.cueVideoById === 'function') {
          playerRef.current.cueVideoById({ videoId: vid, startSeconds: startSec });
        } else if (typeof playerRef.current.loadVideoById === 'function') {
          playerRef.current.loadVideoById({ videoId: vid, startSeconds: startSec });
          playerRef.current.pauseVideo?.();
        }
      }
      currentLoadedVideoIdRef.current = vid;
      pendingVideoIdRef.current = null;
    } catch (err) {
      console.error('[YouTubePlayer] Failed to cue/load video by ID:', err);
    }
  };

  // 1. Initialize player ONCE on component mount
  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setPlayerError(null);

    loadYouTubeIframeApi().then((YT) => {
      if (isCancelled) return;

      if (timeIntervalRef.current) {
        clearInterval(timeIntervalRef.current);
      }

      try {
        const player = new YT.Player(containerId.current, {
          videoId: currentLoadedVideoIdRef.current,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: initialPlaybackStatus === 'playing' ? 1 : 0,
            controls: 1, // Native YouTube controls enabled alongside custom sync controls
            modestbranding: 1,
            rel: 0,
            enablejsapi: 1,
            origin: window.location.origin,
            playsinline: 1,
          },
          events: {
            onReady: (event) => {
              if (isCancelled) return;
              playerRef.current = event.target;
              isPlayerReadyRef.current = true;
              setIsLoading(false);

              // If a video change occurred while player was initializing, load it now!
              if (pendingVideoIdRef.current && pendingVideoIdRef.current !== currentLoadedVideoIdRef.current) {
                const targetVid = pendingVideoIdRef.current;
                pendingVideoIdRef.current = null;
                loadOrCueVideo(targetVid, 0, 'paused');
              } else {
                // Seek to initial sync time
                if (initialTime > 0) {
                  event.target.seekTo(initialTime, true);
                }

                if (initialPlaybackStatus === 'playing') {
                  event.target.playVideo();
                }
              }

              // Poll current playback time and duration every 250ms
              timeIntervalRef.current = setInterval(() => {
                if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
                  const current = playerRef.current.getCurrentTime() || 0;
                  const duration = playerRef.current.getDuration() || 0;
                  onTimeUpdateRef.current?.(current, duration);
                }
              }, 250);

              onPlayerReadyRef.current?.(event.target);
            },
            onStateChange: (event) => {
              if (isCancelled) return;
              const state = event.data;
              const currentTime = playerRef.current?.getCurrentTime?.() || 0;
              onLocalStateChangeRef.current?.(state, currentTime);
            },
            onError: (event) => {
              if (isCancelled) return;
              let errorMsg = 'An error occurred loading the YouTube video.';
              switch (event.data) {
                case 2:
                  errorMsg = 'Invalid YouTube video URL or ID.';
                  break;
                case 5:
                  errorMsg = 'HTML5 player error. The video cannot be played.';
                  break;
                case 100:
                  errorMsg = 'Video not found or has been marked private by its owner.';
                  break;
                case 101:
                case 150:
                  errorMsg = 'This video owner does not allow embedding outside YouTube.';
                  break;
                default:
                  break;
              }
              setPlayerError(errorMsg);
              setIsLoading(false);
              onErrorRef.current?.(errorMsg);
            },
          },
        });
      } catch (err) {
        console.error('[YouTubePlayer] Initialization error:', err);
        setPlayerError('Failed to initialize YouTube IFrame Player.');
        setIsLoading(false);
      }
    });

    return () => {
      isCancelled = true;
      isPlayerReadyRef.current = false;
      if (timeIntervalRef.current) {
        clearInterval(timeIntervalRef.current);
      }
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
      }
    };
  }, []);

  // 2. Handle subsequent videoId changes smoothly without destroying the DOM iframe
  useEffect(() => {
    if (!videoId) return;

    // Reset error state on video change
    setPlayerError(null);

    // If this video is already loaded, nothing to do
    if (currentLoadedVideoIdRef.current === videoId && !pendingVideoIdRef.current) {
      return;
    }

    if (isPlayerReadyRef.current && playerRef.current) {
      if (import.meta.env?.DEV) {
        console.log(`[YouTubePlayer] Loading new videoId via API: ${videoId}`);
      }
      loadOrCueVideo(videoId, initialTime || 0, initialPlaybackStatus);
    } else {
      if (import.meta.env?.DEV) {
        console.log(`[YouTubePlayer] Player not ready yet. Retaining pending videoId: ${videoId}`);
      }
      pendingVideoIdRef.current = videoId;
    }
  }, [videoId]);

  return (
    <div className="yt-player-wrapper">
      {/* Loading state indicator */}
      {isLoading && (
        <div className="yt-player-loading-overlay">
          <div className="spinner-sm" style={{ width: 28, height: 28 }} />
          <span>Connecting to YouTube Engine...</span>
        </div>
      )}

      {/* Embedding error banner */}
      {playerError && (
        <div className="yt-player-error-overlay">
          <div className="yt-error-title">Playback Error</div>
          <div className="yt-error-desc">{playerError}</div>
          <div className="yt-error-hint">Please paste another YouTube video URL below.</div>
        </div>
      )}

      {/* Actual IFrame Host Element */}
      <div id={containerId.current} className="yt-iframe-container" />
    </div>
  );
}
