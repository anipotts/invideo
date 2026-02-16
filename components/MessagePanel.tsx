"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { motion } from "framer-motion";
import {
  ExchangeMessage,
  renderRichContent,
  type UnifiedExchange,
} from "./ExchangeMessage";
import { ToolResultRenderer, isDrawerTool, parseStreamToSegments, reorderToolsAfterText, type ToolCallData } from "./ToolRenderers";
import dynamic from "next/dynamic";
const KnowledgeDrawer = dynamic(
  () => import("./KnowledgeDrawer").then((m) => m.KnowledgeDrawer),
  { ssr: false }
);
import type { DrawerExchangeGroup } from "./KnowledgeDrawer";
const InVideoPanel = dynamic(
  () => import("./InVideoPanel").then((m) => m.InVideoPanel),
  { ssr: false }
);
import { ExplorePills } from "./ExplorePills";
import { LearnModeQuiz } from "./LearnModeQuiz";
import type { VoiceState } from "@/hooks/useVoiceMode";
import type { TranscriptSegment } from "@/lib/video-utils";
import { getStoryboardFrame, type StoryboardLevel } from "@/lib/storyboard";
import { createPortal } from "react-dom";
import type { LearnState, LearnHandlers } from "./overlay-types";
import type { SideVideoEntry } from "./SideVideoPanel";

/* --- Learn mode error boundary --- */

class LearnErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="py-6 text-center">
          <p className="mb-3 text-sm text-slate-400">Something went wrong</p>
          <button
            onClick={() => {
              this.setState({ hasError: false });
              this.props.onReset();
            }}
            className="text-xs text-chalk-accent hover:underline"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* --- Thinking timer --- */

/** Live "thinking for x.y s" / "thought for x.y s" timer */
function TalkingTimer({
  isThinking,
  thinkingDuration,
}: {
  isThinking: boolean;
  thinkingDuration: number | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isThinking) {
      startRef.current = null;
      return;
    }
    startRef.current = Date.now();
    const interval = setInterval(() => {
      if (startRef.current) setElapsed(Date.now() - startRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, [isThinking]);

  if (!isThinking && thinkingDuration === null) return null;

  const seconds = isThinking ? elapsed / 1000 : (thinkingDuration ?? 0) / 1000;
  const label = isThinking ? "talking" : "talked";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-1.5 py-1"
    >
      {isThinking && (
        <div className="w-1.5 h-1.5 rounded-full bg-chalk-accent animate-pulse" />
      )}
      <span className="text-xs text-slate-400 font-mono">
        {label} for {seconds.toFixed(1)}s
      </span>
    </motion.div>
  );
}

/* --- Timestamp hover tooltip --- */

/**
 * Timestamp hover tooltip. Positioned directly above the trigger button via portal.
 * pointer-events: none — disappears the instant the mouse leaves the timestamp.
 * No timers, no debounce, no lingering.
 */
function TimestampTooltip({
  seconds,
  segments,
  position,
  storyboardLevels,
  citeLabel,
  citeContext,
}: {
  seconds: number;
  segments: TranscriptSegment[];
  position: { x: number; y: number };
  storyboardLevels?: StoryboardLevel[];
  citeLabel?: string;
  citeContext?: string;
}) {
  // Find nearest segment for fallback text
  let lo = 0, hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].offset < seconds) lo = mid + 1;
    else hi = mid - 1;
  }
  const nearestText = segments[Math.max(0, lo - 1)]?.text || '';

  const formatTs = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const preferLevel = storyboardLevels && storyboardLevels.length > 2 ? 2 : 1;
  const frame = storyboardLevels && storyboardLevels.length > 0
    ? getStoryboardFrame(storyboardLevels, seconds, preferLevel)
    : null;

  const thumbW = 130;
  const clampedX = Math.max(180, Math.min(position.x, window.innerWidth - 180));

  return createPortal(
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{
        left: clampedX,
        top: position.y - 8,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <div
        className="bg-chalk-surface/95 backdrop-blur-md border border-chalk-border/60 rounded-lg overflow-hidden shadow-2xl shadow-black/40 flex"
        style={{ width: frame ? 340 : 220 }}
      >
        {/* Storyboard thumbnail */}
        {frame && (() => {
          const level = storyboardLevels?.[Math.min(preferLevel, (storyboardLevels?.length ?? 1) - 1)];
          const cols = level?.cols ?? 5;
          const rows = level?.rows ?? 5;
          const scale = thumbW / frame.width;
          const thumbH = Math.round(frame.height * scale);
          const posMatch = frame.backgroundPosition.match(/-?(\d+)(?:px)?\s+-?(\d+)/);
          const origX = posMatch ? parseInt(posMatch[1]) : 0;
          const origY = posMatch ? parseInt(posMatch[2]) : 0;
          return (
            <div className="relative flex-shrink-0 overflow-hidden" style={{ width: thumbW, height: thumbH }}>
              <div
                className="w-full h-full"
                style={{
                  backgroundImage: `url(${frame.url})`,
                  backgroundPosition: `-${Math.round(origX * scale)}px -${Math.round(origY * scale)}px`,
                  backgroundSize: `${Math.round(frame.width * cols * scale)}px ${Math.round(frame.height * rows * scale)}px`,
                  backgroundRepeat: 'no-repeat',
                }}
              />
              <span className="absolute bottom-1 left-1 bg-black/80 text-white text-[10px] font-mono px-1 py-0.5 rounded">
                {formatTs(seconds)}
              </span>
            </div>
          );
        })()}

        {/* Info panel */}
        <div className="flex-1 min-w-0 p-2.5 flex flex-col justify-center">
          {citeLabel ? (
            <>
              <div className="text-[12px] font-medium text-slate-200 leading-tight truncate">{citeLabel}</div>
              {citeContext && (
                <div className="text-[10px] text-slate-400 leading-snug mt-0.5 line-clamp-2">{citeContext}</div>
              )}
            </>
          ) : (
            <>
              {!frame && (
                <span className="text-[11px] font-mono text-chalk-accent mb-0.5">{formatTs(seconds)}</span>
              )}
              <div className="text-[11px] text-slate-400 leading-snug line-clamp-2">{nearestText}</div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* --- Fingerprint helper for deduplicating drawer tool calls --- */

function toolFingerprint(tc: ToolCallData): string {
  const r = tc.result;
  switch (r.type) {
    case 'reference_video': return `ref:${r.video_id}`;
    case 'learning_path': return `lp:${r.from_concept}->${r.to_concept}`;
    case 'quiz': return `quiz:${r.questions.length}:${r.questions[0]?.question?.slice(0, 30)}`;
    case 'alternative_explanations': return `alt:${r.concept}`;
    case 'prerequisite_chain': return `prereq:${r.concept_id}`;
    default: return `${r.type}:${JSON.stringify(r).slice(0, 50)}`;
  }
}

/* --- MessagePanel --- */

export interface MessagePanelProps {
  hasContent: boolean;
  expanded: boolean;
  exchanges: UnifiedExchange[];
  segments: TranscriptSegment[];
  videoId: string;
  onSeek: (seconds: number) => void;
  onClose: () => void;
  onOpenVideo?: (
    videoId: string,
    title: string,
    channelName: string,
    seekTo?: number,
  ) => void;

  // Streaming state
  isTextStreaming: boolean;
  currentUserText: string;
  currentAiText: string;
  currentToolCalls?: ToolCallData[];
  currentRawAiText?: string;
  textError: string | null;

  // Voice state (for non-explore fallback rendering)
  voiceState: VoiceState;
  voiceTranscript: string;
  voiceResponseText: string;
  voiceError: string | null;

  // Explore state
  showExploreUI: boolean;
  exploreMode: boolean;
  exploreError: string | null;
  isThinking: boolean;
  thinkingDuration: number | null;
  submitExploreMessage: (text: string) => void;

  // Read aloud
  playingMessageId: string | null;
  onPlayMessage: (id: string, text: string) => void;
  isReadAloudLoading: boolean;
  readAloudProgress: number;

  // Explore pill selection
  handlePillSelect: (option: string) => void;
  focusInput: () => void;

  // Learn mode
  learnState: LearnState;
  learnHandlers: LearnHandlers;
  videoTitle?: string;

  // Tooltip segments
  tooltipSegments: TranscriptSegment[];
  storyboardLevels?: StoryboardLevel[];

  // InVideo panel (reference video inside overlay)
  inVideoEntry?: SideVideoEntry | null;
  onCloseInVideo?: () => void;

  // Video paused state (for caret color)
  isPaused?: boolean;

  // Clear conversation
  onClearHistory?: () => void;

  /** Ref bridge for 3-level Escape stacking */
  drawerRef?: React.RefObject<{ isOpen: boolean; dismiss: () => void } | null>;
}

export function MessagePanel({
  hasContent,
  expanded,
  exchanges,
  segments,
  videoId,
  onSeek,
  onClose,
  onOpenVideo,
  isTextStreaming,
  currentUserText,
  currentAiText,
  currentToolCalls,
  currentRawAiText,
  textError,
  voiceState,
  voiceTranscript,
  voiceResponseText,
  voiceError,
  showExploreUI,
  exploreMode,
  exploreError,
  isThinking,
  thinkingDuration,
  submitExploreMessage,
  playingMessageId,
  onPlayMessage,
  isReadAloudLoading,
  readAloudProgress,
  handlePillSelect,
  focusInput,
  learnState,
  learnHandlers,
  videoTitle,
  tooltipSegments,
  storyboardLevels,
  inVideoEntry,
  onCloseInVideo,
  drawerRef,
}: MessagePanelProps) {
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [drawerDismissed, setDrawerDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Delayed unmount for InVideoPanel — gives Vidstack time to tear down its
  // YouTube provider before React removes the component from the tree.
  const lastInVideoEntryRef = useRef<SideVideoEntry | null>(null);
  const [deferredInVideoEntry, setDeferredInVideoEntry] = useState<SideVideoEntry | null>(null);

  useEffect(() => {
    if (inVideoEntry) {
      lastInVideoEntryRef.current = inVideoEntry;
      setDeferredInVideoEntry(inVideoEntry);
    } else if (lastInVideoEntryRef.current) {
      // Keep rendering during close animation, then unmount
      const timer = setTimeout(() => {
        lastInVideoEntryRef.current = null;
        setDeferredInVideoEntry(null);
      }, 350); // slightly longer than the 300ms CSS width transition
      return () => clearTimeout(timer);
    }
  }, [inVideoEntry]);

  // Timestamp tooltip state — no timers, instant show/hide
  const [tooltipInfo, setTooltipInfo] = useState<{
    seconds: number;
    position: { x: number; y: number };
    citeLabel?: string;
    citeContext?: string;
  } | null>(null);

  const handleTimestampSeek = useCallback(
    (seconds: number) => {
      onSeek(seconds);
      onClose();
    },
    [onSeek, onClose],
  );

  const isLearnModeActive = learnState.phase !== "idle";
  const prevDrawerCountRef = useRef(0);

  // === Knowledge Drawer state derivation ===
  // Accumulate ALL drawer-worthy tool calls from ALL exchanges, grouped by exchange (deduped)
  const exchangeGroups: DrawerExchangeGroup[] = useMemo(() => {
    const groups: DrawerExchangeGroup[] = [];
    const seen = new Set<string>();
    for (const ex of exchanges) {
      const drawerTools = (ex.toolCalls?.filter(tc => isDrawerTool(tc)) ?? [])
        .filter(tc => {
          const fp = toolFingerprint(tc);
          if (seen.has(fp)) return false;
          seen.add(fp);
          return true;
        });
      if (drawerTools.length > 0) {
        groups.push({
          exchangeId: ex.id,
          userText: ex.userText,
          toolCalls: drawerTools,
        });
      }
    }
    return groups;
  }, [exchanges]);

  // Filter drawer tools from current streaming state
  const streamingDrawerCalls = useMemo(
    () => (currentToolCalls ?? []).filter(tc => isDrawerTool(tc)),
    [currentToolCalls],
  );

  const totalDrawerCount = useMemo(
    () => exchangeGroups.reduce((s, g) => s + g.toolCalls.length, 0) + streamingDrawerCalls.length,
    [exchangeGroups, streamingDrawerCalls],
  );

  // Reopen drawer only when NEW drawer items arrive (not on every stream start)
  useEffect(() => {
    if (totalDrawerCount > prevDrawerCountRef.current) {
      setDrawerDismissed(false);
    }
    prevDrawerCountRef.current = totalDrawerCount;
  }, [totalDrawerCount]);

  // Memoize streaming segment parsing to avoid O(n^2) re-parse on each char
  const streamSegments = useMemo(
    () => currentRawAiText ? reorderToolsAfterText(parseStreamToSegments(currentRawAiText)) : [],
    [currentRawAiText],
  );

  // Drawer is open when there are any accumulated tools or streaming tools
  const isDrawerOpen = totalDrawerCount > 0 && !drawerDismissed;

  // Sync drawer state to parent ref for 3-level Escape stacking
  useEffect(() => {
    if (drawerRef) {
      (drawerRef as React.MutableRefObject<{ isOpen: boolean; dismiss: () => void } | null>).current = {
        isOpen: isDrawerOpen,
        dismiss: () => setDrawerDismissed(true),
      };
    }
  }, [drawerRef, isDrawerOpen]);

  // Auto-scroll
  const scrollToBottom = useCallback((smooth = false) => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "instant",
      });
    }
  }, []);

  // Scroll to bottom on new content (rAF to avoid race with DOM paint)
  useEffect(() => {
    if (!canScrollDown) {
      requestAnimationFrame(() => scrollToBottom());
    }
  }, [
    exchanges,
    currentAiText,
    currentUserText,
    scrollToBottom,
    canScrollDown,
  ]);

  // Always scroll to bottom when user sends a message
  useEffect(() => {
    if (currentUserText) {
      requestAnimationFrame(() => scrollToBottom());
    }
  }, [currentUserText, scrollToBottom]);

  // Always scroll to bottom when messages area expands
  useEffect(() => {
    if (expanded) {
      requestAnimationFrame(() => scrollToBottom(true));
    }
  }, [expanded, scrollToBottom]);

  // Auto-scroll when Explore mode toggles on/off
  const prevExploreRef = useRef(exploreMode);
  useEffect(() => {
    if (exploreMode !== prevExploreRef.current) {
      // Toggled ON: smooth scroll so user sees starting pills
      // Toggled OFF: smooth scroll to show latest content cleanly
      requestAnimationFrame(() => scrollToBottom(true));
    }
    prevExploreRef.current = exploreMode;
  }, [exploreMode, scrollToBottom]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setCanScrollDown(scrollHeight - scrollTop - clientHeight > 60);
  }, []);

  // Timestamp tooltip via event delegation — instant show/hide, no debounce
  const handleMouseOver = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const button = target.closest('button[aria-label^="Seek to"]');
    if (button) {
      const label = button.getAttribute("aria-label") || "";
      const match = label.match(/Seek to (\d+):(\d{2})(?::(\d{2}))? in video/);
      if (match) {
        let seconds: number;
        if (match[3]) {
          seconds =
            parseInt(match[1]) * 3600 +
            parseInt(match[2]) * 60 +
            parseInt(match[3]);
        } else {
          seconds = parseInt(match[1]) * 60 + parseInt(match[2]);
        }
        const rect = button.getBoundingClientRect();
        const citeLabel = button.getAttribute("data-cite-label") || undefined;
        const citeContext = button.getAttribute("data-cite-context") || undefined;
        setTooltipInfo({
          seconds,
          position: { x: rect.left + rect.width / 2, y: rect.top },
          citeLabel,
          citeContext,
        });
      }
    }
  }, []);

  const handleMouseOut = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const button = target.closest('button[aria-label^="Seek to"]');
    if (button) {
      setTooltipInfo(null);
    }
  }, []);

  return (
    <>
      <div
        className={`relative z-[1] flex flex-col w-full flex-1 min-h-0 pointer-events-none transition-opacity duration-150 ${
          hasContent ? "items-center" : "justify-end items-center"
        }`}
      >
        {/* Mobile grip indicator for swipe-to-close */}
        <div className="flex-shrink-0 mx-auto mb-3 w-8 h-1 rounded-full pointer-events-auto md:hidden bg-white/20" />

        {/* Messages + Knowledge Drawer — overlay layout (panels don't push chat) */}
        {hasContent && (
          <div className="flex-1 w-full min-h-0 relative pointer-events-auto" data-message-panel>
            {/* Knowledge Drawer — desktop only, LEFT side, absolute overlay */}
            <div className={`hidden md:flex absolute top-0 left-0 h-full z-10 overflow-hidden transition-[width] duration-300 ease-out ${
              isDrawerOpen ? 'w-[280px] border-r border-white/[0.10] bg-black/30 backdrop-blur-md shadow-[4px_0_16px_rgba(0,0,0,0.3)]' : 'w-0'
            }`}>
              {totalDrawerCount > 0 && (
                <div className={`min-w-[280px] h-full transition-opacity duration-200 ease-out ${
                  isDrawerOpen ? 'opacity-100 delay-150' : 'opacity-0'
                }`}>
                  <KnowledgeDrawer
                    exchangeGroups={exchangeGroups}
                    streamingCalls={streamingDrawerCalls}
                    isStreaming={isTextStreaming && streamingDrawerCalls.length > 0}
                    onSeek={handleTimestampSeek}
                    onOpenVideo={onOpenVideo}
                    onClose={() => setDrawerDismissed(true)}
                    currentVideoId={videoId}
                  />
                </div>
              )}
            </div>

            {/* Drawer reopen toggle — shown when drawer has content but is dismissed */}
            {drawerDismissed && totalDrawerCount > 0 && (
              <button
                onClick={() => setDrawerDismissed(false)}
                className="hidden md:flex absolute top-0 left-0 h-full z-10 items-center justify-center w-8 border-r border-white/[0.10] text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-colors"
                title="Show related content"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            )}

            {/* Chat column — full width, content centered, never moves */}
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              onMouseOver={handleMouseOver}
              onMouseOut={handleMouseOut}
              className="w-full h-full overflow-y-auto scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            >
            <div className="flex flex-col gap-3 md:gap-4 px-3 py-3 md:py-4 md:px-4 w-full md:max-w-3xl md:mx-auto">
              {/* Unified conversation history -- all exchanges in chronological order */}
              {exchanges.map((exchange, i) => {
                const justCommitted = i === exchanges.length - 1 && Date.now() - Number(exchange.id) < 500;
                const prev = i > 0 ? exchanges[i - 1] : null;

                // Separator: time gap > 5 min or mode change
                let separator: React.ReactNode = null;
                if (prev) {
                  const timeGap = exchange.timestamp - prev.timestamp;
                  const modeChange = exchange.mode !== prev.mode;
                  if (timeGap > 300 || modeChange) {
                    const formatTs = (s: number) => {
                      const m = Math.floor(s / 60);
                      const sec = Math.floor(s % 60);
                      return `${m}:${sec.toString().padStart(2, "0")}`;
                    };
                    const label = modeChange
                      ? exchange.mode === "explore" ? "explore mode" : "chat mode"
                      : formatTs(exchange.timestamp);
                    separator = (
                      <div key={`sep-${exchange.id}`} className="flex items-center gap-3 py-1">
                        <div className="flex-1 h-px bg-chalk-border/20" />
                        <span className="text-[10px] text-slate-600 font-mono">{label}</span>
                        <div className="flex-1 h-px bg-chalk-border/20" />
                      </div>
                    );
                  }
                }

                return (
                  <React.Fragment key={exchange.id}>
                    {separator}
                    <ExchangeMessage
                      exchange={exchange}
                      skipEntrance={justCommitted}
                      onSeek={handleTimestampSeek}
                      videoId={videoId}
                      onPlayMessage={onPlayMessage}
                      isPlaying={playingMessageId === exchange.id}
                      isReadAloudLoading={
                        isReadAloudLoading &&
                        playingMessageId === exchange.id
                      }
                      onOpenVideo={onOpenVideo}
                      readAloudProgress={
                        playingMessageId === exchange.id ? readAloudProgress : 0
                      }
                    />
                  </React.Fragment>
                );
              })}

              {/* Current streaming exchange */}
              {(currentUserText ||
                currentAiText ||
                (!showExploreUI &&
                  (voiceTranscript || voiceResponseText))) && (
                <div className="space-y-3">
                  {(currentUserText ||
                    (!showExploreUI && voiceTranscript)) && (
                    <div className="flex justify-end w-full">
                      <div className="max-w-[85%] px-3.5 py-2 rounded-lg bg-white/[0.10] backdrop-blur-sm border border-white/[0.12] text-white text-sm leading-relaxed break-words">
                        {currentUserText || voiceTranscript}
                      </div>
                    </div>
                  )}
                  {/* Thinking/streaming indicator */}
                  {isTextStreaming && !currentAiText && (
                    showExploreUI && (isThinking || thinkingDuration !== null)
                      ? <TalkingTimer isThinking={isThinking} thinkingDuration={thinkingDuration} />
                      : !showExploreUI && (
                        <div className="flex items-center gap-2 py-1">
                          <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-chalk-accent/40 animate-pulse" />
                            <span className="w-1.5 h-1.5 rounded-full bg-chalk-accent/40 animate-pulse [animation-delay:150ms]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-chalk-accent/40 animate-pulse [animation-delay:300ms]" />
                          </div>
                        </div>
                      )
                  )}
                  {(currentAiText ||
                    (!showExploreUI && voiceResponseText)) && (
                    <div className="flex justify-start w-full">
                      <div className="max-w-[90%]">
                        <div className="text-[15px] text-slate-300 leading-relaxed whitespace-pre-wrap break-words">
                          {currentRawAiText && currentToolCalls && currentToolCalls.length > 0 ? (
                            // Segment-based rendering: route drawer tools to KnowledgeDrawer
                            <>
                              {streamSegments.map((seg, i) => {
                                if (seg.type === 'text') {
                                  if (!seg.content.trim()) return null;
                                  // Trim trailing newlines if next segment is cite_moment so pill flows inline
                                  let content = seg.content;
                                  const next = streamSegments[i + 1];
                                  if (next && next.type === 'tool' && next.toolCall.result.type === 'cite_moment') {
                                    content = content.replace(/\s*\n+\s*$/, ' ');
                                  }
                                  return <span key={`stream-seg-${i}`}>{renderRichContent(content, handleTimestampSeek, videoId)}</span>;
                                }
                                if (seg.toolCall.result.type === 'cite_moment') {
                                  return (
                                    <ToolResultRenderer
                                      key={`stream-tool-${i}`}
                                      toolCall={seg.toolCall}
                                      onSeek={handleTimestampSeek}
                                      onOpenVideo={onOpenVideo}
                                      currentVideoId={videoId}
                                    />
                                  );
                                }
                                return (
                                  <div key={`stream-tool-${i}`} className="my-2">
                                    <ToolResultRenderer
                                      toolCall={seg.toolCall}
                                      onSeek={handleTimestampSeek}
                                      onOpenVideo={onOpenVideo}
                                      currentVideoId={videoId}
                                    />
                                  </div>
                                );
                              })}
                            </>
                          ) : (
                            // Plain text rendering (no tool calls or voice mode)
                            renderRichContent(
                              currentAiText || voiceResponseText,
                              handleTimestampSeek,
                              videoId,
                            )
                          )}
                          {(isTextStreaming ||
                            voiceState === "thinking") && (
                            <span className="inline-block w-0.5 h-4 bg-chalk-accent animate-pulse ml-0.5 align-middle" />
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Explore mode: initial options -- shown at bottom after all exchanges */}
              {showExploreUI &&
                !exchanges.some((e) => e.mode === "explore") &&
                !isTextStreaming &&
                !isLearnModeActive && (
                  <div className="flex flex-col justify-end w-full mt-auto">
                    <motion.p
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                      className="mb-3 text-sm text-slate-400"
                    >
                      Pick a starting point, or just ask.
                    </motion.p>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        "Summarize with timestamps",
                        "Quiz me on this",
                        "Key takeaways so far",
                      ].map((label, i) => (
                        <motion.button
                          key={label}
                          initial={{ opacity: 0, scale: 0.8, y: 12, filter: 'blur(4px)' }}
                          animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                          transition={{
                            delay: 0.1 + i * 0.07,
                            type: 'spring',
                            stiffness: 500,
                            damping: 30,
                            mass: 0.8,
                          }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => submitExploreMessage(label)}
                          className="px-3 py-1.5 rounded-lg text-xs text-slate-300 bg-white/[0.04] backdrop-blur-sm border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.15] hover:text-white transition-colors"
                        >
                          {label}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                )}

              {/* Explore pills — always at bottom, pulled from last explore exchange */}
              {exploreMode && !isTextStreaming && (() => {
                const lastExplore = [...exchanges].reverse().find((e) => e.mode === "explore");
                if (lastExplore?.explorePills && lastExplore.explorePills.length > 0) {
                  return (
                    <ExplorePills
                      options={lastExplore.explorePills}
                      onSelect={handlePillSelect}
                      onFocusInput={focusInput}
                    />
                  );
                }
                return null;
              })()}

              {/* Error message */}
              {(textError || voiceError || exploreError) && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="px-3 py-2 text-xs text-rose-400 rounded-lg border bg-rose-500/10 border-rose-500/20"
                >
                  {textError || voiceError || exploreError}
                </motion.div>
              )}

              {/* Learn mode content */}
              {isLearnModeActive && (
                <LearnErrorBoundary onReset={learnHandlers.onStop}>
                  <LearnModeQuiz
                    phase={learnState.phase}
                    quiz={learnState.quiz}
                    explanation={learnState.explanation}
                    introText={learnState.introText}
                    responseContent={learnState.responseContent}
                    exportableContent={learnState.exportableContent}
                    answers={learnState.answers}
                    score={learnState.score}
                    selectedAction={learnState.selectedAction}
                    thinking={learnState.thinking}
                    thinkingDuration={learnState.thinkingDuration}
                    isLoading={learnState.isLoading}
                    error={learnState.error}
                    learnOptions={learnState.options}
                    learnOptionsLoading={learnState.optionsLoading}
                    videoTitle={videoTitle}
                    videoId={videoId}
                    onSelectAnswer={learnHandlers.onSelectAnswer}
                    onSelectAction={learnHandlers.onSelectAction}
                    onFocusInput={learnHandlers.onFocusInput}
                    onNextBatch={learnHandlers.onNextBatch}
                    onStop={learnHandlers.onStop}
                    onSeek={handleTimestampSeek}
                  />
                </LearnErrorBoundary>
              )}

              {/* Scroll to bottom */}
              <div className={`sticky bottom-3 flex justify-center z-10 transition-opacity duration-200 ${
                canScrollDown ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}>
                <button
                  onClick={() => scrollToBottom(true)}
                  className="flex items-center justify-center w-8 h-8 rounded-full bg-chalk-surface/90 backdrop-blur-sm border border-white/[0.10] text-slate-400 hover:text-slate-200 shadow-lg shadow-black/30 transition-colors"
                  aria-label="Scroll to bottom"
                  tabIndex={canScrollDown ? 0 : -1}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
            </div>
            </div>

            {/* InVideo Panel — desktop only, RIGHT side, absolute overlay */}
            <div className={`hidden md:flex absolute top-0 right-0 h-full z-10 overflow-hidden transition-[width] duration-300 ease-out ${
              inVideoEntry ? 'w-[280px] border-l border-white/[0.10] bg-black/30 backdrop-blur-md shadow-[-4px_0_16px_rgba(0,0,0,0.3)]' : 'w-0'
            }`}>
              {deferredInVideoEntry && (
                <div className={`min-w-[280px] h-full transition-opacity duration-200 ease-out ${
                  inVideoEntry ? 'opacity-100 delay-150' : 'opacity-0'
                }`}>
                  <InVideoPanel
                    entry={deferredInVideoEntry}
                    onClose={onCloseInVideo ?? (() => {})}
                    onOpenVideo={onOpenVideo}
                  />
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Timestamp tooltip — pointer-events:none, disappears instantly on mouse leave */}
      {tooltipInfo && (
        <TimestampTooltip
          seconds={tooltipInfo.seconds}
          segments={tooltipSegments}
          position={tooltipInfo.position}
          storyboardLevels={storyboardLevels}
          citeLabel={tooltipInfo.citeLabel}
          citeContext={tooltipInfo.citeContext}
        />
      )}
    </>
  );
}
