'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { TranscriptPanel } from './TranscriptPanel';
import { useTranscriptStream } from '@/hooks/useTranscriptStream';
import { useVideoTitle } from '@/hooks/useVideoTitle';
import { X, ArrowSquareOut, CaretDown, CaretUp, CircleNotch } from '@phosphor-icons/react';
import { formatTimestamp } from '@/lib/video-utils';
import type { MediaPlayerInstance } from '@vidstack/react';
import type { SideVideoEntry } from './SideVideoPanel';

const VideoPlayer = dynamic(() => import('./VideoPlayer').then((m) => m.VideoPlayer), { ssr: false });

interface InVideoPanelProps {
  entry: SideVideoEntry;
  onClose: () => void;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
  onTranscriptReady?: (segments: import('@/lib/video-utils').TranscriptSegment[]) => void;
}

export function InVideoPanel({ entry, onClose, onOpenVideo, onTranscriptReady }: InVideoPanelProps) {
  const playerRef = useRef<MediaPlayerInstance>(null);
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

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleSeek = useCallback((seconds: number) => {
    if (playerRef.current) {
      playerRef.current.currentTime = seconds;
    }
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
    if (seekPending.current != null && playerRef.current) {
      playerRef.current.currentTime = seekPending.current;
      seekPending.current = null;
    }
  }, []);

  return (
    <div className="w-full h-full flex flex-col pointer-events-auto">
      {/* Header — mirrors KnowledgeDrawer structure */}
      <div className="flex-none flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-slate-500 truncate leading-tight">
            {entry.channelName}
          </div>
          <div className="text-xs text-slate-300 truncate leading-tight">
            {displayTitle}
          </div>
        </div>
        <button
          onClick={() => {
            const url = entry.seekTo
              ? `/watch?v=${entry.videoId}&t=${Math.floor(entry.seekTo)}`
              : `/watch?v=${entry.videoId}`;
            window.open(url, '_blank');
          }}
          className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
          title="Open in new tab"
        >
          <ArrowSquareOut size={14} />
        </button>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Mini player — full width with rounded corners */}
      <div className="flex-none px-2">
        <div className="relative overflow-hidden rounded-lg">
          <VideoPlayer
            playerRef={playerRef}
            videoId={entry.videoId}
            onTimeUpdate={handleTimeUpdate}
            onReady={handleReady}
          />
        </div>
        {/* Seek-to badge */}
        {entry.seekTo != null && entry.seekTo > 0 && (
          <div className="px-1 pt-1">
            <span className="text-[10px] font-mono text-chalk-accent/70">
              @ {formatTimestamp(entry.seekTo)}
            </span>
          </div>
        )}
      </div>

      {/* Transcript toggle + loading */}
      <div className="flex-none flex items-center gap-2 px-3 py-1.5">
        <button
          onClick={() => setShowTranscript(v => !v)}
          className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md transition-colors ${
            showTranscript
              ? 'bg-chalk-accent/15 text-chalk-accent'
              : 'text-slate-500 hover:text-slate-300 bg-white/[0.04]'
          }`}
        >
          Transcript
          {showTranscript ? <CaretUp size={10} /> : <CaretDown size={10} />}
        </button>
        {isLoading && (
          <div className="flex items-center gap-1.5">
            <CircleNotch size={12} className="text-chalk-accent/60 animate-spin" />
            <span className="text-[10px] text-slate-500 truncate">{statusMessage || 'Loading...'}</span>
          </div>
        )}
      </div>

      {/* Transcript — glassmorphic invideo variant */}
      {showTranscript && (
        <div className="flex-1 min-h-0 overflow-hidden">
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
