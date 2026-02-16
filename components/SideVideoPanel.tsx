'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { TranscriptPanel } from './TranscriptPanel';
import { useTranscriptStream } from '@/hooks/useTranscriptStream';
import { useVideoTitle } from '@/hooks/useVideoTitle';
import { X, ArrowLeft, ArrowSquareOut } from '@phosphor-icons/react';
import { ensureYTApi } from '@/lib/youtube-iframe-api';

export interface SideVideoEntry {
  videoId: string;
  title: string;
  channelName: string;
  seekTo?: number;
}

interface SideVideoPanelProps {
  /** Stack of side videos. The last entry is the currently displayed one. */
  stack: SideVideoEntry[];
  onPop: () => void;
  onClose: () => void;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
}

export function SideVideoPanel({ stack, onPop, onClose, onOpenVideo }: SideVideoPanelProps) {
  const entry = stack[stack.length - 1];
  if (!entry) return null;

  return (
    <div className="flex flex-col h-full bg-chalk-bg border-l-2 border-chalk-accent/30">
      {/* Header */}
      <SidePanelHeader
        stack={stack}
        onPop={onPop}
        onClose={onClose}
        entry={entry}
      />

      {/* Content */}
      <SidePanelContent entry={entry} onOpenVideo={onOpenVideo} />
    </div>
  );
}

function SidePanelHeader({
  stack,
  onPop,
  onClose,
  entry,
}: {
  stack: SideVideoEntry[];
  onPop: () => void;
  onClose: () => void;
  entry: SideVideoEntry;
}) {
  return (
    <div className="flex-none flex items-center gap-2 px-4 py-2.5 border-b border-chalk-border/30 bg-chalk-surface/80">
      {/* Back button (only if stack depth > 1) */}
      {stack.length > 1 && (
        <button
          onClick={onPop}
          className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-colors"
          title="Back to previous video"
        >
          <ArrowLeft size={14} weight="bold" />
        </button>
      )}

      {/* Breadcrumb trail */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 text-[10px] text-slate-500 overflow-hidden">
          {stack.map((s, i) => (
            <span key={s.videoId} className="flex items-center gap-1 min-w-0">
              {i > 0 && <span className="text-slate-600">&rsaquo;</span>}
              <span className={`truncate ${i === stack.length - 1 ? 'text-slate-300' : ''}`}>
                {s.title.length > 35 ? s.title.slice(0, 35) + '...' : s.title}
              </span>
            </span>
          ))}
        </div>
        <div className="text-xs text-slate-400 truncate">{entry.channelName}</div>
      </div>

      {/* Open in new tab */}
      <button
        onClick={() => {
          const url = entry.seekTo
            ? `/watch?v=${entry.videoId}&t=${Math.floor(entry.seekTo)}`
            : `/watch?v=${entry.videoId}`;
          window.open(url, '_blank');
        }}
        className="p-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
        title="Open in new tab"
      >
        <ArrowSquareOut size={14} />
      </button>

      {/* Close */}
      <button
        onClick={onClose}
        className="p-2 rounded-md text-slate-400 hover:text-slate-200 hover:bg-white/[0.08] transition-colors"
        title="Close side panel"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function SidePanelContent({ entry, onOpenVideo }: {
  entry: SideVideoEntry;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ytPlayerRef = useRef<any>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Create YouTube player via IFrame API (uses youtube-nocookie.com)
  useEffect(() => {
    let destroyed = false;

    ensureYTApi().then(() => {
      if (destroyed || !containerRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const YT = (window as any).YT;

      ytPlayerRef.current = new YT.Player(containerRef.current, {
        videoId: entry.videoId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          autoplay: 0,
          start: entry.seekTo ? Math.floor(entry.seekTo) : undefined,
          rel: 0,
          modestbranding: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            pollRef.current = setInterval(() => {
              try {
                const t = ytPlayerRef.current?.getCurrentTime?.();
                if (typeof t === 'number') setCurrentTime(t);
              } catch { /* player may be destroyed */ }
            }, 250);
          },
        },
      });
    });

    return () => {
      destroyed = true;
      if (pollRef.current) clearInterval(pollRef.current);
      try { ytPlayerRef.current?.destroy?.(); } catch { /* ignore */ }
      ytPlayerRef.current = null;
    };
  }, [entry.videoId, entry.seekTo]);

  const handleSeek = useCallback((seconds: number) => {
    try { ytPlayerRef.current?.seekTo?.(seconds, true); } catch { /* ignore */ }
  }, []);

  const handleAskAbout = useCallback((_timestamp: number, _text: string) => {
    // Could integrate with the main chat in the future
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* YouTube embed (nocookie domain, IFrame API for time sync) */}
      <div className="flex-none">
        <div className="relative aspect-video bg-black overflow-hidden">
          <div ref={containerRef} className="absolute inset-0 w-full h-full" />
        </div>
        <div className="px-4 py-2">
          <div className="text-sm font-medium text-slate-200 line-clamp-2">{displayTitle}</div>
        </div>
      </div>

      {/* Toggle transcript */}
      <div className="flex-none flex items-center px-4 pb-1">
        <button
          onClick={() => setShowTranscript(v => !v)}
          className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
            showTranscript
              ? 'bg-chalk-accent/15 text-chalk-accent'
              : 'text-slate-500 hover:text-slate-300 bg-white/[0.04]'
          }`}
        >
          Transcript
        </button>
        {entry.seekTo != null && (
          <button
            onClick={() => handleSeek(entry.seekTo!)}
            className="ml-2 text-[11px] font-medium px-2.5 py-1 rounded-md text-slate-500 hover:text-slate-300 bg-white/[0.04] transition-colors"
          >
            Jump to {Math.floor(entry.seekTo / 60)}:{String(Math.floor(entry.seekTo % 60)).padStart(2, '0')}
          </button>
        )}
      </div>

      {/* Transcript */}
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
            variant="sidebar"
            videoId={entry.videoId}
            videoTitle={displayTitle}
            onAskAbout={handleAskAbout}
          />
        </div>
      )}
    </div>
  );
}
