'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { formatTimestamp, type TranscriptSegment, type TranscriptSource } from '@/lib/video-utils';
import type { TranscriptStatus, QueueProgress } from '@/hooks/useTranscriptStream';
import { XCircle, Chats } from '@phosphor-icons/react';
import { generateChapters } from '@/lib/chapters';

interface TranscriptPanelProps {
  segments: TranscriptSegment[];
  currentTime: number;
  onSeek: (seconds: number) => void;
  status: TranscriptStatus;
  statusMessage?: string;
  source?: TranscriptSource | null;
  progress?: number;
  error?: string;
  variant?: 'sidebar' | 'inline' | 'mobile' | 'invideo';
  onClose?: () => void;
  onRetry?: () => void;
  onAskAbout?: (timestamp: number, text: string) => void;
  videoId?: string;
  videoTitle?: string;
  queueProgress?: QueueProgress | null;
}

export function TranscriptPanel({
  segments,
  currentTime,
  onSeek,
  status,
  statusMessage,
  source,
  progress,
  error,
  variant = 'sidebar',
  onClose,
  onRetry,
  onAskAbout,
  queueProgress,
}: TranscriptPanelProps) {
  const [search, setSearch] = useState('');
  const [userScrolled, setUserScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const chapters = useMemo(() => generateChapters(segments), [segments]);

  // Find active segment index
  const activeIndex = useMemo(() => {
    if (segments.length === 0) return -1;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (currentTime >= segments[i].offset) return i;
    }
    return 0;
  }, [segments, currentTime]);

  // Filter by search
  const filteredSegments = useMemo(() => {
    if (!search.trim()) return segments;
    const q = search.toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [segments, search]);

  // Get chapter offset set for dividers
  const chapterOffsets = useMemo(() => new Set(chapters.map((c) => c.offset)), [chapters]);

  // Find chapter label for offset
  const getChapterLabel = useCallback((offset: number) => {
    return chapters.find((c) => c.offset === offset)?.label;
  }, [chapters]);

  // Auto-scroll to active segment
  useEffect(() => {
    if (userScrolled || !activeRef.current || !scrollRef.current) return;
    activeRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex, userScrolled]);

  // Reset user-scrolled flag after 5s of inactivity
  useEffect(() => {
    if (!userScrolled) return;
    const timeout = setTimeout(() => setUserScrolled(false), 5000);
    return () => clearTimeout(timeout);
  }, [userScrolled]);

  const handleScroll = useCallback(() => {
    setUserScrolled(true);
  }, []);

  // Keyboard: / to focus search
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === '/' && !(e.target as HTMLElement)?.closest('input, textarea')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  const isLoading = status === 'connecting' || status === 'extracting' || status === 'queued' || status === 'transcribing';
  const isSidebar = variant === 'sidebar' || variant === 'invideo';
  const isMobile = variant === 'mobile';
  const isInVideo = variant === 'invideo';

  return (
    <div className={`flex flex-col ${isSidebar || isMobile ? 'h-full' : 'max-h-[400px]'} ${isInVideo ? '' : 'bg-chalk-bg'}`}>
      {/* Header — search + close in one row, hidden on mobile and invideo */}
      {!isMobile && !isInVideo && (
        <div className="flex-none flex items-center gap-2 px-3 py-2 border-b border-chalk-border/20">
          {status === 'error' ? (
            <div className="flex-1 px-3 py-1.5 rounded-lg bg-red-500/[0.06] border border-red-500/20 text-xs text-slate-500 flex items-center justify-between">
              <span>Transcript couldn&apos;t be loaded, sorry.</span>
              {onRetry && (
                <button onClick={onRetry} className="ml-2 text-chalk-accent hover:underline flex-shrink-0">
                  Retry
                </button>
              )}
            </div>
          ) : isLoading ? (
            <div className="relative flex-1">
              <div className="w-full px-3 py-1.5 rounded-lg bg-chalk-surface/40 border border-chalk-border/20 text-xs text-slate-500 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 border border-chalk-accent/40 border-t-chalk-accent rounded-full animate-spin flex-shrink-0" />
                  <span className="truncate">{statusMessage || 'Loading transcript...'}</span>
                </div>
                {queueProgress && queueProgress.progressPct > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/15 text-blue-400 tabular-nums flex-shrink-0">
                    {queueProgress.progressPct}%
                  </span>
                )}
              </div>
              <div className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-white/[0.04] overflow-hidden">
                {(progress ?? 0) > 0 && (progress ?? 0) < 100 ? (
                  <div
                    className="h-full bg-chalk-accent/40 rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                ) : (
                  <div className="h-full w-[40%] bg-chalk-accent/40 rounded-full animate-indeterminate" />
                )}
              </div>
            </div>
          ) : (
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search transcript... (/)"
              aria-label="Search transcript"
              className="flex-1 px-3 py-1.5 rounded-lg bg-chalk-surface/40 border border-chalk-border/20 text-xs text-chalk-text placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-chalk-accent/40 transition-colors"
            />
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors flex-shrink-0"
              title="Close transcript"
              aria-label="Close transcript"
            >
              <XCircle size={14} />
            </button>
          )}
        </div>
      )}

      {/* Status / Loading — mobile only (desktop handled in unified row above) */}
      {isMobile && (isLoading || status === 'error') && (
        <div className="flex-none px-3 py-2">
          {status === 'error' ? (
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <span>Transcript couldn&apos;t be loaded, sorry.</span>
              {onRetry && (
                <button onClick={onRetry} className="text-chalk-accent hover:underline">
                  Retry
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border border-chalk-accent/40 border-t-chalk-accent rounded-full animate-spin" />
              <span className="text-xs text-slate-500">{statusMessage || 'Loading...'}</span>
            </div>
          )}
        </div>
      )}


      {/* Segments */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto ${isMobile ? 'overscroll-contain' : ''}`}
      >
        {filteredSegments.length === 0 && !isLoading && segments.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-slate-500">No transcript available yet</p>
          </div>
        )}

        {filteredSegments.length === 0 && search && segments.length > 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-slate-500">No matches for &ldquo;{search}&rdquo;</p>
          </div>
        )}

        {filteredSegments.map((seg, i) => {
          const isActive = !search && segments[activeIndex] === seg;
          const segChapter = chapterOffsets.has(seg.offset) ? getChapterLabel(seg.offset) : null;

          return (
            <div key={`${seg.offset}-${i}`}>
              {/* Chapter divider */}
              {segChapter && (
                <div className={isMobile ? 'px-3 pt-2 pb-0.5' : 'px-4 pt-4 pb-1'}>
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-chalk-border/30" />
                    <span className="text-[10px] text-slate-500 font-medium shrink-0">{segChapter}</span>
                    <div className="h-px flex-1 bg-chalk-border/30" />
                  </div>
                </div>
              )}

              <div
                ref={isActive ? activeRef : undefined}
                role="button"
                tabIndex={0}
                onClick={() => onSeek(seg.offset)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSeek(seg.offset);
                  }
                }}
                className={isInVideo
                  ? `group flex gap-2 cursor-pointer transition-all duration-150 mx-2 my-0.5 px-2.5 py-1.5 rounded-lg ${
                    isActive
                      ? 'bg-white/[0.12] border border-chalk-accent/30'
                      : 'bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.10] hover:border-white/[0.14]'
                  }`
                  : `group flex gap-3 cursor-pointer transition-colors ${
                    isMobile ? 'px-3 py-1 active:scale-[0.99]' : 'px-4 py-1.5'
                  } ${
                    isActive
                      ? 'bg-chalk-accent/[0.08] border-l-2 border-l-chalk-accent'
                      : 'border-l-2 border-l-transparent hover:bg-white/[0.03]'
                  }`
                }
              >
                <span className={`shrink-0 text-[10px] font-mono pt-0.5 ${
                  isActive ? 'text-chalk-accent' : isInVideo ? 'text-slate-500' : 'text-slate-600'
                }`}>
                  {formatTimestamp(seg.offset)}
                </span>
                <span className={`${
                  isMobile ? 'text-[11px] leading-snug' : isInVideo ? 'text-[11px] leading-snug' : 'text-[12px] leading-relaxed'
                } ${
                  isActive ? 'text-chalk-text' : isInVideo ? 'text-slate-300' : 'text-slate-400'
                }`}>
                  {search ? highlightMatch(seg.text, search) : seg.text}
                </span>
                {onAskAbout && !isMobile && !isInVideo && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAskAbout(seg.offset, seg.text);
                    }}
                    className="shrink-0 self-start mt-0.5 opacity-0 group-hover:opacity-100 text-slate-600 hover:text-chalk-accent transition-all"
                    title="Ask about this"
                    aria-label="Ask about this segment"
                  >
                    <Chats size={12} weight="bold" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-500/20 text-yellow-200 rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}
