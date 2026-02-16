'use client';

import { useRef } from 'react';
import { MediaPlayer, MediaProvider, type MediaPlayerInstance } from '@vidstack/react';
import { storageKey } from '@/lib/brand';
import { DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default';
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';

function safePlayerCall(player: MediaPlayerInstance | null, fn: (p: MediaPlayerInstance) => void): void {
  if (!player) return;
  try {
    fn(player);
  } catch {
    // Player proxy in invalid state — ignore
  }
}

interface VideoPlayerProps {
  videoId: string;
  onPause?: () => void;
  onPlay?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  onRateChange?: (rate: number) => void;
  onReady?: () => void;
  playerRef?: React.RefObject<MediaPlayerInstance | null>;
}

export function VideoPlayer({ videoId, onPause, onPlay, onTimeUpdate, onRateChange, onReady, playerRef }: VideoPlayerProps) {
  const internalRef = useRef<MediaPlayerInstance>(null);
  const player = playerRef || internalRef;

  return (
    <div className="relative">
    <MediaPlayer
      ref={player}
      src={`youtube/${videoId}`}
      playsInline
      keyDisabled
      aspectRatio="16/9"
      onPause={() => onPause?.()}
      onPlay={() => onPlay?.()}
      onRateChange={() => {
        try {
          if (player.current) onRateChange?.(player.current.playbackRate);
        } catch { /* ignore */ }
      }}
      onTimeUpdate={(e) => {
        try {
          const detail = e as unknown as { currentTime: number };
          if (typeof detail?.currentTime === 'number') {
            onTimeUpdate?.(detail.currentTime);
          }
        } catch {
          // Vidstack $state proxy may throw during teardown
        }
      }}
      onCanPlay={() => {
        try {
          const savedSpeed = localStorage.getItem(storageKey('playback-speed'));
          if (savedSpeed && player.current) {
            safePlayerCall(player.current, (pl) => { pl.playbackRate = parseFloat(savedSpeed); });
          }
        } catch { /* localStorage may throw in private browsing */ }
        onReady?.();
      }}
      className="w-full rounded-none md:rounded-2xl overflow-hidden bg-black"
    >
      <MediaProvider />
      <DefaultVideoLayout icons={defaultLayoutIcons} />
    </MediaPlayer>
    </div>
  );
}
