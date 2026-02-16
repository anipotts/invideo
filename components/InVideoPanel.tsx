'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { TranscriptPanel } from './TranscriptPanel';
import { VideoPlayer } from './VideoPlayer';
import { useTranscriptStream } from '@/hooks/useTranscriptStream';
import { useVideoTitle } from '@/hooks/useVideoTitle';
import { X, ArrowSquareOut, CaretDown, CaretUp, CircleNotch } from '@phosphor-icons/react';
import { ChalkIcon } from './ChalkIcon';
import { formatTimestamp } from '@/lib/video-utils';
import type { PlayerHandle } from './VideoPlayer';
import type { SideVideoEntry } from './SideVideoPanel';

interface InVideoPanelProps {
  entry: SideVideoEntry;
  onClose: () => void;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
  onTranscriptReady?: (segments: import('@/lib/video-utils').TranscriptSegment[]) => void;
}

export function InVideoPanel({ entry, onClose, onOpenVideo, onTranscriptReady }: InVideoPanelProps) {
  const playerRef = useRef<PlayerHandle>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [showTranscript, setShowTranscript] = useState(true);

  const {
    segments,
    status,
    statusMessage,
    source,
    progress,
    error,
  } = useTranscriptStream(entry.videoId);

  const { title: fetchedTitle } = useVideoTitle(entry.videoId);
  const displayTitle = fetchedTitle || entry.title;

  const isLoading = status === 'connecting' || status === 'extracting' || status === 'queued' || status === 'transcribing';

  // Pause player on unmount to prevent "provider destroyed" errors
  // during Vidstack's YouTube iframe teardown
  useEffect(() => {
    return () => {
      try { playerRef.current?.pause(); } catch { /* already destroyed */ }
    };
  }, []);

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleSeek = useCallback((seconds: number) => {
    try {
      if (playerRef.current) {
        playerRef.current.currentTime = seconds;
      }
    } catch { /* provider may be destroyed */ }
  }, []);

  // Notify parent when transcript segments become available
  useEffect(() => {
    if (segments.length > 0 && onTranscriptReady) {
      onTranscriptReady(segments);
    }
  }, [segments, onTranscriptReady]);

  // Seek to entry timestamp once player is ready
  const seekPending = useRef(entry.seekTo ?? null);

  useEffect(() => {
    seekPending.current = entry.seekTo ?? null;
  }, [entry.seekTo, entry.videoId]);

  const handleReady = useCallback(() => {
    // Delay seek + play to ensure YouTube iframe is fully initialized
    setTimeout(() => {
      if (seekPending.current != null && playerRef.current) {
        playerRef.current.currentTime = seekPending.current;
        seekPending.current = null;
      }
      try { playerRef.current?.play(); } catch { /* ignore autoplay restrictions */ }
    }, 300);
  }, []);

  const handleNewTab = () => {
    const url = entry.seekTo
      ? `/watch?v=${entry.videoId}&t=${Math.floor(entry.seekTo)}`
      : `/watch?v=${entry.videoId}`;
    window.open(url, '_blank');
  };

  const handleMakeMain = () => {
    const url = entry.seekTo
      ? `/watch?v=${entry.videoId}&t=${Math.floor(entry.seekTo)}`
      : `/watch?v=${entry.videoId}`;
    window.location.href = url;
  };

  // Staggered entrance animation — content fades in after panel width transition
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setEntered(true), 200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="w-full h-full flex flex-col pointer-events-auto">
      {/* Header — title + close only */}
      <div
        className="flex-none flex items-center gap-2 px-3 pt-3 pb-2 transition-all duration-200 ease-out"
        style={{ opacity: entered ? 1 : 0, transform: entered ? 'translateY(0)' : 'translateY(4px)' }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-slate-500 truncate leading-tight">
            {entry.channelName}
          </div>
          <div className="text-xs text-slate-300 truncate leading-tight">
            {displayTitle}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Mini player — full width with rounded corners */}
      <div
        className="flex-none px-2 transition-all duration-200 ease-out"
        style={{
          opacity: entered ? 1 : 0,
          transform: entered ? 'translateY(0)' : 'translateY(6px)',
          transitionDelay: '50ms',
        }}
      >
        <div className="relative overflow-hidden rounded-lg">
          {entered ? (
            <VideoPlayer
              playerRef={playerRef}
              videoId={entry.videoId}
              onTimeUpdate={handleTimeUpdate}
              onReady={handleReady}
            />
          ) : (
            <div className="w-full aspect-video bg-black/40 rounded-lg animate-pulse" />
          )}
        </div>
      </div>

      {/* Toolbar row — seek badge + Transcript + New tab + Watch, all in one row */}
      <div
        className="flex-none flex items-center gap-1.5 px-3 py-2 transition-all duration-200 ease-out"
        style={{
          opacity: entered ? 1 : 0,
          transform: entered ? 'translateY(0)' : 'translateY(4px)',
          transitionDelay: '120ms',
        }}
      >
        {entry.seekTo != null && entry.seekTo > 0 && (
          <span className="text-[10px] font-mono text-chalk-accent/70">
            {formatTimestamp(entry.seekTo)}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setShowTranscript(v => !v)}
          className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md transition-colors whitespace-nowrap ${
            showTranscript
              ? 'bg-chalk-accent/15 text-chalk-accent'
              : 'text-slate-500 hover:text-slate-300 bg-white/[0.04]'
          }`}
          title="Toggle transcript"
        >
          Transcript
          {showTranscript ? <CaretUp size={9} /> : <CaretDown size={9} />}
        </button>
        <button
          onClick={handleNewTab}
          className="flex items-center p-1 rounded-md text-slate-500 hover:text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
          title="Open in new tab"
        >
          <ArrowSquareOut size={13} />
        </button>
        <button
          onClick={handleMakeMain}
          className="group flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md text-slate-500 hover:text-chalk-accent bg-white/[0.04] hover:bg-chalk-accent/10 transition-colors whitespace-nowrap"
          title="Watch as main video"
        >
          <ChalkIcon size={11} />
          Watch
        </button>
        {isLoading && (
          <div className="flex items-center gap-1.5 ml-auto">
            <CircleNotch size={12} className="text-chalk-accent/60 animate-spin" />
            <span className="text-[10px] text-slate-500 truncate">{statusMessage || 'Loading...'}</span>
          </div>
        )}
      </div>

      {/* Transcript — glassmorphic invideo variant */}
      {showTranscript && (
        <div
          className="flex-1 min-h-0 overflow-hidden transition-opacity duration-200 ease-out"
          style={{ opacity: entered ? 1 : 0, transitionDelay: '180ms' }}
        >
          <TranscriptPanel
            segments={segments}
            currentTime={currentTime}
            onSeek={handleSeek}
            status={status}
            statusMessage={statusMessage}
            source={source}
            progress={progress}
            error={error ?? undefined}
            variant="invideo"
            videoId={entry.videoId}
            videoTitle={displayTitle}
          />
        </div>
      )}
    </div>
  );
}
