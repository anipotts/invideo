'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { formatTimestamp, getSegmentDuration, computeWordTimings, type TranscriptSegment, type TranscriptSource } from '@/lib/video-utils';
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

/** Inline karaoke word highlighting for the active transcript segment. */
function KaraokeWords({
  segment,
  segments,
  segIndex,
  currentTime,
}: {
  segment: TranscriptSegment;
  segments: TranscriptSegment[];
  segIndex: number;
  currentTime: number;
}) {
  const next = segIndex + 1 < segments.length ? segments[segIndex + 1] : undefined;
  const duration = getSegmentDuration(segment, next);
  const words = computeWordTimings(segment, duration);
  if (words.length === 0) return <>{segment.text}</>;

  const currentMs = currentTime * 1000;

  // Find active word index
  let activeWordIndex = -1;
  for (let i = words.length - 1; i >= 0; i--) {
    if (currentMs >= words[i].startMs) {
      activeWordIndex = i;
      break;
    }
  }

  return (
    <>
      {words.map((wt, i) => {
        const isActive = i === activeWordIndex;
        const isSpoken = i < activeWordIndex;

        // Color/weight only — no layout-shifting padding/bg
        // Parent has text-chalk-text, so upcoming must override to be dimmer
        let className: string;
        if (isActive) {
          className = 'text-white font-semibold';
        } else if (isSpoken) {
          className = 'text-chalk-text';
        } else {
          // Upcoming — noticeably dimmer than spoken
          className = 'text-slate-500';
        }

        return (
          <span key={`${segment.offset}-w-${i}`} className={className}>
            {i > 0 ? ' ' : ''}{wt.text}
          </span>
        );
      })}
    </>
  );
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
  // InVideo variant: scroll active segment to top (compact panel, context below)
  // All other variants: scroll to center (traditional transcript view)
  useEffect(() => {
    if (userScrolled || !activeRef.current || !scrollRef.current) return;
    const scrollBlock = variant === 'invideo' ? 'start' : 'center';
    activeRef.current.scrollIntoView({ block: scrollBlock, behavior: 'smooth' });
  }, [activeIndex, userScrolled, variant]);

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
          // Wave state: when not searching, determine if segment is spoken or upcoming
          const isPast = !search && activeIndex >= 0 && !isActive && i < activeIndex;
          const isFuture = !search && activeIndex >= 0 && !isActive && i > activeIndex;
          const segChapter = chapterOffsets.has(seg.offset) ? getChapterLabel(seg.offset) : null;

          return (
            <div key={`${seg.offset}-${i}`}>
              {/* Chapter divider */}
              {segChapter && (
                <div className={isMobile ? 'px-3 pt-3 pb-0.5' : 'px-4 pt-5 pb-1.5'}>
                  <div className="flex items-center gap-2.5">
                    <div className="h-px flex-1 bg-chalk-border/20" />
                    <span className="text-[10px] text-slate-500 font-medium tracking-wide uppercase shrink-0">{segChapter}</span>
                    <div className="h-px flex-1 bg-chalk-border/20" />
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
                  ? `group flex gap-2 cursor-pointer transition-colors duration-300 mx-2 my-1 px-2.5 py-2 rounded-lg ${
                    isActive
                      ? 'bg-white/[0.12] border border-chalk-accent/30'
                      : 'bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.10] hover:border-white/[0.14]'
                  }`
                  : `group flex gap-3 cursor-pointer transition-colors duration-300 ${
                    isMobile ? 'px-3 py-1 active:scale-[0.99]' : 'px-4 py-1.5'
                  } ${
                    isActive
                      ? 'bg-chalk-accent/[0.10] border-l-2 border-l-chalk-accent'
                      : 'border-l-2 border-l-transparent hover:bg-white/[0.04] hover:border-l-white/[0.12]'
                  }`
                }
              >
                <span className={`shrink-0 text-[10px] font-mono tabular-nums pt-0.5 select-none transition-colors duration-300 ${
                  isActive
                    ? 'text-chalk-accent font-medium'
                    : isPast
                      ? (isInVideo ? 'text-slate-400' : 'text-slate-500 group-hover:text-slate-400')
                      : isFuture
                        ? (isInVideo ? 'text-slate-600' : 'text-slate-700 group-hover:text-slate-600')
                        : (isInVideo ? 'text-slate-500' : 'text-slate-600 group-hover:text-slate-500')
                }`}>
                  {formatTimestamp(seg.offset)}
                </span>
                <span className={`transition-colors duration-300 ${
                  isMobile ? 'text-[11px] leading-snug' : isInVideo ? 'text-[11px] leading-snug' : 'text-[12px] leading-relaxed'
                } ${
                  isActive
                    ? 'text-chalk-text font-[450]'
                    : isPast
                      ? (isInVideo ? 'text-slate-200' : 'text-slate-300')
                      : isFuture
                        ? (isInVideo ? 'text-slate-500' : 'text-slate-600 group-hover:text-slate-500')
                        : (isInVideo ? 'text-slate-300' : 'text-slate-400 group-hover:text-slate-300')
                }`}>
                  {isActive && !search ? (
                    <KaraokeWords
                      segment={seg}
                      segments={segments}
                      segIndex={i}
                      currentTime={currentTime}
                    />
                  ) : (
                    search ? highlightMatch(seg.text, search) : seg.text
                  )}
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
      <mark className="bg-amber-400/25 text-amber-200 rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}
