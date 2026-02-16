"use client";

import { useState, useRef, useCallback, useEffect, Suspense, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { InteractionOverlay } from "@/components/InteractionOverlay";
import {
  VoiceProvider,
  LearnProvider,
  ExploreProvider,
  ReadAloudProvider,
  InVideoProvider,
} from "@/components/overlay-contexts";
import type { LearnState, LearnHandlers } from "@/components/overlay-types";
import { useTranscriptStream } from "@/hooks/useTranscriptStream";
import { useVideoTitle } from "@/hooks/useVideoTitle";
import { useOverlayPhase } from "@/hooks/useOverlayPhase";
import { formatTimestamp, type IntervalSelection } from "@/lib/video-utils";
import { storageKey } from "@/lib/brand";
import { ChalkboardSimple, Play, ArrowBendUpLeft, SpinnerGap, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { KaraokeCaption } from "@/components/KaraokeCaption";
import { AppBar } from "@/components/AppBar";
import { VoiceCloneConsent } from "@/components/VoiceCloneConsent";
import type { MediaPlayerInstance } from "@vidstack/react";

import { useUnifiedMode } from "@/hooks/useUnifiedMode";
import { useVoiceClone } from "@/hooks/useVoiceClone";
import { useLearnMode } from "@/hooks/useLearnMode";
import { useLearnOptions } from "@/hooks/useLearnOptions";
import { useCurriculumContext } from "@/hooks/useCurriculumContext";
import { useKnowledgeContext } from "@/hooks/useKnowledgeContext";
import type { SideVideoEntry } from "@/components/SideVideoPanel";
import { parseStoryboardSpec } from "@/lib/storyboard";
import { ChapterTimeline } from "@/components/ChapterTimeline";

const VideoPlayer = dynamic(
  () =>
    import("@/components/VideoPlayer").then((m) => ({
      default: m.VideoPlayer,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex justify-center items-center w-full rounded-xl animate-pulse aspect-video bg-chalk-surface/30">
        <div className="flex flex-col gap-3 items-center">
          <div className="flex justify-center items-center w-12 h-12 rounded-full bg-chalk-surface/50">
            <Play size={24} weight="fill" className="text-slate-500" />
          </div>
          <span className="text-xs text-slate-500">Loading player...</span>
        </div>
      </div>
    ),
  },
);

/* --- Mobile collapse/expand components --- */

function SectionGrip({
  onTap,
  sectionName,
}: {
  onTap: () => void;
  sectionName: string;
}) {
  return (
    <button
      onClick={onTap}
      aria-expanded="true"
      aria-label={`Collapse ${sectionName}`}
      className="md:hidden flex-none h-6 w-full flex items-center justify-center cursor-pointer active:bg-white/[0.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-chalk-accent"
    >
      <div className="w-8 h-[3px] rounded-full bg-white/[0.25] active:scale-x-150 transition-transform" />
    </button>
  );
}

function WhisperBar({
  label,
  meta,
  onTap,
}: {
  label: string;
  meta?: string;
  onTap: () => void;
}) {
  return (
    <button
      onClick={onTap}
      aria-expanded="false"
      aria-label={`Expand ${label}`}
      className="md:hidden w-full h-10 flex items-center justify-between px-4 active:bg-white/[0.04] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-chalk-accent"
    >
      <span className="text-[11px] text-slate-400 font-medium tracking-wide">
        {label}
      </span>
      <div className="flex gap-2 items-center">
        {meta && (
          <span className="text-[10px] text-slate-400 font-mono">{meta}</span>
        )}
        <span className="text-xs text-slate-400">&#9662;</span>
      </div>
    </button>
  );
}


function WatchContent() {
  const searchParams = useSearchParams();
  const videoId = searchParams.get("v") || "";
  const urlStartTime = searchParams.get("t");
  const playlistId = searchParams.get("list") || null;
  const shouldAutoplay = searchParams.get("autoplay") === "1";
  const forceStt = searchParams.get("force-stt") === "true";
  const navRouter = useRouter();

  const { segments, status, statusMessage, error, source, progress, durationSeconds, metadata, storyboardSpec, queueProgress } =
    useTranscriptStream(videoId || null, forceStt);

  const storyboardLevels = useMemo(
    () => (storyboardSpec ? parseStoryboardSpec(storyboardSpec) : []),
    [storyboardSpec],
  );
  const { title: videoTitle, channelName } = useVideoTitle(videoId || null);

  // Prefer hook title/channel, fall back to transcript metadata
  const effectiveTitle = videoTitle || metadata?.title || null;
  const effectiveChannel = channelName || metadata?.author || null;

  const [currentTime, setCurrentTime] = useState(0);
  const [isPaused, setIsPaused] = useState(true);
  const { phase, dispatch: overlayDispatch } = useOverlayPhase();
  const chatting = phase === 'chatting';

  const [showTranscript, setShowTranscript] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
  const [inVideoEntry, setInVideoEntry] = useState<SideVideoEntry | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<IntervalSelection | null>(null);
  const [continueFrom, setContinueFrom] = useState<number | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [transcriptCollapsed, setTranscriptCollapsed] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Load preferences after mount to avoid hydration mismatch
  useEffect(() => {
    try {
      const layout = localStorage.getItem(storageKey("mobile-layout"));
      if (layout) {
        const { tc } = JSON.parse(layout);
        if (tc) setTranscriptCollapsed(true);
      }
      const cc = localStorage.getItem(storageKey("show-captions"));
      if (cc === "true") setShowCaptions(true);

      // Transcript: Chrome extension always gets it open; otherwise restore saved pref or default to open on wide screens
      if (shouldAutoplay) {
        setShowTranscript(true);
      } else {
        const savedTranscript = localStorage.getItem(storageKey("show-transcript"));
        if (savedTranscript !== null) {
          setShowTranscript(savedTranscript === "true");
        } else if (window.innerWidth >= 1280) {
          setShowTranscript(true);
        }
      }
    } catch {
      /* ignore */
    }
  }, [shouldAutoplay]);

  // Persist mobile collapse state
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey("mobile-layout"),
        JSON.stringify({ tc: transcriptCollapsed }),
      );
    } catch {
      /* ignore */
    }
  }, [transcriptCollapsed]);

  // Persist caption toggle
  useEffect(() => {
    try {
      localStorage.setItem(storageKey("show-captions"), String(showCaptions));
    } catch {
      /* ignore */
    }
  }, [showCaptions]);

  // Persist transcript sidebar toggle
  useEffect(() => {
    try {
      localStorage.setItem(storageKey("show-transcript"), String(showTranscript));
    } catch {
      /* ignore */
    }
  }, [showTranscript]);
  const playerRef = useRef<MediaPlayerInstance>(null);
  const progressSaveRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const currentTimeRef = useRef(0);
  const segmentsRef = useRef(segments);
  const inputRef = useRef<HTMLElement>(null);
  const wasPlayingRef = useRef(false);
  const hasPlayedOnce = useRef(false);
  const wasPlayingBeforeVoice = useRef(false);

  const hasSegments = segments.length > 0;

  // Sync refs outside of render (React 19 safe)
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  // Auto-pause/resume on phase transitions
  // Use isPaused React state (reliable) instead of playerRef.current?.paused (proxy can be stale during init)
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (prev === phase) return; // Only act on actual phase transitions

    if (prev === 'watching' && phase === 'chatting') {
      // Entering chatting: capture play state from React state and pause
      wasPlayingRef.current = !isPaused;
      try {
        playerRef.current?.pause();
      } catch { /* Vidstack proxy may throw */ }
    } else if (prev === 'chatting' && phase === 'watching') {
      // Exiting to watching: resume if was playing
      if (wasPlayingRef.current) {
        try { playerRef.current?.play(); } catch { /* ignore */ }
        wasPlayingRef.current = false;
      }
    }
  }, [phase, isPaused]);

  // Save to recent videos (localStorage) so landing page shows them
  useEffect(() => {
    if (!videoId) return;
    try {
      const key = storageKey("recent-videos");
      const recent: Array<{
        id: string;
        url: string;
        title?: string;
        channelName?: string;
        timestamp: number;
      }> = JSON.parse(localStorage.getItem(key) || "[]");
      const existing = recent.find((v) => v.id === videoId);
      const filtered = recent.filter((v) => v.id !== videoId);
      filtered.unshift({
        id: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: effectiveTitle || existing?.title,
        channelName: effectiveChannel || existing?.channelName,
        timestamp: Date.now(),
      });
      localStorage.setItem(key, JSON.stringify(filtered.slice(0, 10)));
    } catch {
      /* ignore */
    }
  }, [videoId, effectiveTitle, effectiveChannel]);

  // Voice clone hook — now channel-level
  const { voiceId, isCloning, needsConsent, grantConsent, declineConsent } = useVoiceClone({
    videoId: videoId || null,
    channelName: effectiveChannel,
    enabled: true, // eagerly clone on page load so voiceId is ready before first chat
  });

  // Knowledge graph context (populated by batch enrichment)
  const { knowledgeContext } = useKnowledgeContext(videoId);

  // Cross-video curriculum context (loads sibling video transcripts for playlist)
  const curriculum = useCurriculumContext(playlistId, videoId);

  // Unified interaction mode (text + voice + read aloud + explore)
  const unified = useUnifiedMode({
    segments,
    currentTime,
    videoId: videoId || "",
    videoTitle: effectiveTitle ?? undefined,
    voiceId,
    transcriptSource: source ?? undefined,
    knowledgeContext,
    curriculumContext: curriculum.curriculumContext,
    interval: selectedInterval,
  });

  // Learn mode (Opus 4.6 adaptive learning)
  const learnMode = useLearnMode({
    segments,
    currentTime,
    videoId: videoId || "",
    videoTitle: effectiveTitle ?? undefined,
  });

  // Pre-generated learn options (lazy — only fetched when learn mode is first opened)
  const { options: learnOptions, isLoading: learnOptionsLoading } =
    useLearnOptions({
      segments,
      videoTitle: effectiveTitle ?? undefined,
      channelName: effectiveChannel,
      enabled: unified.exploreMode,
    });

  // Load saved progress (priority: ?t= param > #t= hash > localStorage)
  useEffect(() => {
    if (!videoId) return;
    try {
      // URL ?t= param (e.g. ?t=120, ?t=2m30s)
      if (urlStartTime) {
        const parsed = parseFloat(urlStartTime);
        if (!isNaN(parsed) && parsed > 0) {
          setContinueFrom(parsed);
          return;
        }
      }
      const hash = window.location.hash;
      const hashMatch = hash.match(/^#t=(\d+(?:\.\d+)?)$/);
      if (hashMatch) {
        const seconds = parseFloat(hashMatch[1]);
        if (seconds > 0) {
          setContinueFrom(seconds);
          return;
        }
      }
      const saved = localStorage.getItem(storageKey(`progress-${videoId}`));
      if (saved) {
        const seconds = parseFloat(saved);
        if (seconds > 5) setContinueFrom(seconds);
      }
    } catch {
      /* ignore */
    }
  }, [videoId, urlStartTime]);

  // Save progress every 5s (refs avoid interval churn on every time update)
  const durationSecondsRef = useRef(durationSeconds);
  useEffect(() => { durationSecondsRef.current = durationSeconds; }, [durationSeconds]);

  useEffect(() => {
    if (!videoId) return;
    progressSaveRef.current = setInterval(() => {
      const t = currentTimeRef.current;
      if (t > 5) {
        localStorage.setItem(storageKey(`progress-${videoId}`), String(t));
        const dur = durationSecondsRef.current;
        if (dur && dur > 0) {
          localStorage.setItem(
            storageKey(`duration-${videoId}`),
            String(dur),
          );
        }
      }
    }, 5000);
    return () => clearInterval(progressSaveRef.current);
  }, [videoId]);

  // Seek to saved position once player is available
  useEffect(() => {
    if (continueFrom === null || !playerRef.current) return;
    const timer = setInterval(() => {
      try {
        if (playerRef.current && playerRef.current.duration > 0) {
          playerRef.current.currentTime = continueFrom;
          clearInterval(timer);
        }
      } catch {
        /* Vidstack $state proxy may throw during init */
      }
    }, 200);
    return () => clearInterval(timer);
  }, [continueFrom]);

  // Autoplay when arriving from Chrome extension (?autoplay=1)
  useEffect(() => {
    if (!shouldAutoplay || !playerRef.current) return;
    const timer = setInterval(() => {
      try {
        if (playerRef.current && playerRef.current.duration > 0) {
          playerRef.current.play();
          clearInterval(timer);
        }
      } catch { /* Vidstack proxy may throw during init */ }
    }, 300);
    return () => clearInterval(timer);
  }, [shouldAutoplay]);

  // Keyboard detection for mobile
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handleResize = () => {
      setKeyboardOpen(vv.height < window.innerHeight * 0.75);
    };
    vv.addEventListener("resize", handleResize);
    return () => vv.removeEventListener("resize", handleResize);
  }, []);

  const handleRateChange = useCallback((rate: number) => {
    setPlaybackSpeed(rate);
  }, []);

  const handleSetSpeed = useCallback((speed: number) => {
    try {
      if (playerRef.current) {
        playerRef.current.playbackRate = speed;
        setPlaybackSpeed(speed);
        localStorage.setItem(storageKey("playback-speed"), String(speed));
      }
    } catch { /* Vidstack proxy may throw */ }
  }, []);

  const handlePause = useCallback(() => {
    setIsPaused(true);
  }, []);

  const handlePlay = useCallback(() => {
    setIsPaused(false);
    hasPlayedOnce.current = true;
  }, []);

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleSeek = useCallback((seconds: number) => {
    try {
      if (playerRef.current) {
        playerRef.current.currentTime = seconds;
        playerRef.current.play();
      }
    } catch {
      /* Vidstack $state proxy may throw */
    }
  }, []);

  const handleAskAbout = useCallback((_timestamp: number, _text: string) => {
    overlayDispatch({ type: 'CONTENT_ARRIVED' });
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [overlayDispatch]);

  const handleIntervalSelect = useCallback((sel: IntervalSelection) => {
    setSelectedInterval(sel);
  }, []);

  const handleIntervalClear = useCallback(() => {
    setSelectedInterval(null);
  }, []);

  // InVideo panel: open a reference video inside the overlay
  const wasPlayingBeforeInVideoRef = useRef(false);
  const handleOpenVideo = useCallback((vid: string, title: string, channelName: string, seekTo?: number) => {
    setInVideoEntry({ videoId: vid, title, channelName, seekTo });
    // Auto-pause main video
    try {
      wasPlayingBeforeInVideoRef.current = !playerRef.current?.paused;
      playerRef.current?.pause();
    } catch { /* Vidstack proxy may throw */ }
  }, []);

  const handleCloseInVideo = useCallback(() => {
    setInVideoEntry(null);
    // Auto-resume main video if it was playing before
    if (wasPlayingBeforeInVideoRef.current) {
      try { playerRef.current?.play(); } catch { /* ignore */ }
      wasPlayingBeforeInVideoRef.current = false;
    }
  }, []);

  // Toggle explore mode (unified: subsumes both explore chat and learn mode)
  const toggleExploreMode = useCallback(() => {
    const entering = !unified.exploreMode;
    unified.setExploreMode(entering);

    if (entering) {
      // Entering explore mode -- expand overlay
      overlayDispatch({ type: 'CONTENT_ARRIVED' });
      unified.setExplorePills([]);
    } else {
      // Exiting explore mode -- clean up UI state only (exchanges persist in unified model)
      unified.setExplorePills([]);
      unified.stopExploreStream();
      unified.setExploreGoal(null);
      unified.setExploreError(null);
      // Also stop learn mode if active
      if (learnMode.phase !== 'idle') {
        learnMode.stopLearnMode();
      }
    }
  }, [unified.exploreMode, unified, overlayDispatch, learnMode]);

  const handleOpenLearnMode = useCallback(() => {
    learnMode.openActionSelector();
  }, [learnMode.openActionSelector]);

  const handleFocusInput = useCallback(() => {
    learnMode.stopLearnMode();
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [learnMode.stopLearnMode]);

  // Keyboard shortcuts — desktop only (mobile has no physical keyboard)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (window.innerWidth < 768) return;
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable = (e.target as HTMLElement)?.isContentEditable;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || isEditable;

      // Escape: close InVideo panel first, then transition to watching
      if (e.key === "Escape") {
        e.preventDefault();
        if (inVideoEntry) {
          handleCloseInVideo();
          return;
        }
        overlayDispatch({ type: 'ESCAPE' });
        inputRef.current?.blur();
        return;
      }

      // When typing in an input, don't capture shortcuts
      if (inInput) return;

      // Tab or / (slash): activate chat + focus (no character injection)
      if (e.key === "Tab" || e.key === "/") {
        e.preventDefault();
        overlayDispatch({ type: 'ACTIVATE' });
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }

      // Any printable character (no Ctrl/Meta/Alt): type-to-activate.
      // No player keybinds — every keystroke goes to the chat input.
      // Player controls are accessible via the Vidstack UI (click to play/pause, scrub timeline, etc.)
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        overlayDispatch({ type: 'ACTIVATE' });
        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            const sel = window.getSelection();
            if (sel) {
              const range = document.createRange();
              range.selectNodeContents(inputRef.current);
              range.collapse(false);
              range.insertNode(document.createTextNode(e.key));
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
              inputRef.current.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
        });
        return;
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [overlayDispatch, phase, inVideoEntry, handleCloseInVideo]);

  // Click-away: dismiss chat overlay when clicking outside
  useEffect(() => {
    if (phase === 'watching') return;
    function handleClickAway(e: PointerEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('[contenteditable]') || target.closest('textarea') || target.closest('input[type="text"]')) return;
      if (target.closest('[data-input-strip]')) return;
      if (target.closest('[data-message-panel]')) return;
      if (target.closest('[data-scroll-badge]')) return;

      e.stopPropagation();
      overlayDispatch({ type: 'CLICK_AWAY' });
      inputRef.current?.blur();
    }
    document.addEventListener('pointerdown', handleClickAway, true);
    return () => {
      document.removeEventListener('pointerdown', handleClickAway, true);
    };
  }, [phase, overlayDispatch]);

  // Auto-expand chat when NEW exchanges appear (skip hydrated/restored ones)
  const sessionActiveRef = useRef(false);
  useEffect(() => {
    // On first load, if exchanges already exist from localStorage, don't auto-open the overlay
    if (!sessionActiveRef.current && unified.exchanges.length > 0 && !unified.isTextStreaming) {
      sessionActiveRef.current = true;
      return;
    }
    sessionActiveRef.current = true;
    if (unified.exchanges.length > 0 || unified.isTextStreaming) {
      overlayDispatch({ type: 'CONTENT_ARRIVED' });
    }
  }, [unified.exchanges.length, unified.isTextStreaming, overlayDispatch]);

  // Auto-pause video during voice mode, auto-resume when idle
  // Only resume if phase is 'watching' — chatting phase manages its own pause/resume
  useEffect(() => {
    if (unified.voiceState === 'recording') {
      try {
        wasPlayingBeforeVoice.current = !playerRef.current?.paused;
        playerRef.current?.pause();
      } catch { /* Vidstack proxy may throw */ }
    } else if (unified.voiceState === 'idle') {
      if (wasPlayingBeforeVoice.current && phase === 'watching') {
        try { playerRef.current?.play(); } catch { /* ignore */ }
      }
      wasPlayingBeforeVoice.current = false;
    }
  }, [unified.voiceState, phase]);

  // Memoized context values for overlay providers
  const learnStateMemo = useMemo<LearnState>(() => ({
    phase: learnMode.phase,
    selectedAction: learnMode.selectedAction,
    quiz: learnMode.currentQuiz,
    explanation: learnMode.currentExplanation,
    introText: learnMode.introText,
    responseContent: learnMode.responseContent,
    exportableContent: learnMode.exportableContent,
    answers: learnMode.answers,
    score: learnMode.score,
    thinking: learnMode.thinking,
    thinkingDuration: learnMode.thinkingDuration,
    isLoading: learnMode.isLoading,
    error: learnMode.error,
    options: learnOptions,
    optionsLoading: learnOptionsLoading,
  }), [
    learnMode.phase, learnMode.selectedAction, learnMode.currentQuiz,
    learnMode.currentExplanation, learnMode.introText, learnMode.responseContent,
    learnMode.exportableContent, learnMode.answers, learnMode.score,
    learnMode.thinking, learnMode.thinkingDuration, learnMode.isLoading,
    learnMode.error, learnOptions, learnOptionsLoading,
  ]);

  const learnHandlersMemo = useMemo<LearnHandlers>(() => ({
    onSelectAction: learnMode.executeAction,
    onFocusInput: handleFocusInput,
    onSelectAnswer: learnMode.selectAnswer,
    onNextBatch: learnMode.requestNextBatch,
    onStop: learnMode.stopLearnMode,
  }), [learnMode.executeAction, handleFocusInput, learnMode.selectAnswer, learnMode.requestNextBatch, learnMode.stopLearnMode]);

  const exploreValue = useMemo(() => ({
    exploreMode: unified.exploreMode,
    onToggle: toggleExploreMode,
    onSubmit: unified.handleExploreSubmit,
    onStop: unified.stopExploreStream,
    error: unified.exploreError,
    pills: unified.explorePills,
    isThinking: unified.isThinking,
    thinkingDuration: unified.thinkingDuration,
  }), [
    unified.exploreMode, toggleExploreMode, unified.handleExploreSubmit,
    unified.stopExploreStream, unified.exploreError, unified.explorePills,
    unified.isThinking, unified.thinkingDuration,
  ]);

  const readAloudValue = useMemo(() => ({
    autoReadAloud: unified.autoReadAloud,
    onToggle: unified.setAutoReadAloud,
    playingMessageId: unified.playingMessageId,
    onPlay: unified.playMessage,
    isLoading: unified.isReadAloudLoading,
  }), [unified.autoReadAloud, unified.setAutoReadAloud, unified.playingMessageId, unified.playMessage, unified.isReadAloudLoading]);

  const inVideoValue = useMemo(() => ({
    entry: inVideoEntry,
    onClose: handleCloseInVideo,
  }), [inVideoEntry, handleCloseInVideo]);

  if (!videoId) {
    return (
      <div className="flex justify-center items-center h-screen bg-chalk-bg">
        <div className="text-center">
          <p className="mb-4 text-slate-400">No video specified</p>
          <a href="/" className="text-sm text-chalk-accent hover:underline">
            Go back home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] bg-chalk-bg overflow-hidden animate-in fade-in duration-300 px-safe">
      {/* Main area */}
      <div className="flex flex-col min-w-0 flex-1">
        {/* Top bar — hidden on mobile */}
        <div className="hidden md:flex flex-col flex-none bg-chalk-bg/80 backdrop-blur-md relative z-20">
          <AppBar
            compact
            trailing={
              <>
                {/* Video context */}
                <img
                  src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
                  alt=""
                  className="w-14 h-8 rounded object-cover bg-chalk-surface/30 shrink-0 cursor-pointer ring-1 ring-transparent hover:ring-chalk-accent/50 transition-all"
                />
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    {effectiveChannel && (
                      <span className="text-[10px] text-slate-500 truncate">
                        {effectiveChannel}
                      </span>
                    )}
                    <a
                      href={`https://www.youtube.com/watch?v=${videoId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-slate-600 hover:text-[#FF0000] transition-colors"
                      title="Open on YouTube"
                    >
                      <svg width="12" height="9" viewBox="0 0 20 14" fill="currentColor">
                        <path d="M19.6 2.2A2.5 2.5 0 0 0 17.8.4C16.3 0 10 0 10 0S3.7 0 2.2.4A2.5 2.5 0 0 0 .4 2.2C0 3.7 0 7 0 7s0 3.3.4 4.8a2.5 2.5 0 0 0 1.8 1.8C3.7 14 10 14 10 14s6.3 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8C20 10.3 20 7 20 7s0-3.3-.4-4.8zM8 10V4l5.2 3L8 10z"/>
                      </svg>
                    </a>
                  </div>
                  <span className="text-xs truncate text-slate-400">
                    {effectiveTitle || videoId}
                  </span>
                </div>

                {/* Hint text */}
                {phase === 'watching' && effectiveChannel && (
                  <span className="hidden lg:inline text-xs whitespace-nowrap pointer-events-none text-slate-500 shrink-0">
                    Start typing to talk to {effectiveChannel}
                  </span>
                )}

                <div className="flex gap-2 items-center ml-auto shrink-0">
                  <button
                    onClick={() => setShowTranscript((v) => !v)}
                    className={`hidden md:inline-flex items-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 ease-out overflow-hidden whitespace-nowrap ${
                      showTranscript
                        ? 'max-w-0 opacity-0 px-0 border-transparent scale-95 pointer-events-none'
                        : 'max-w-40 opacity-100 px-2.5 scale-100 text-slate-500 hover:text-slate-300 bg-chalk-surface/50 border border-chalk-border/30'
                    }`}
                    tabIndex={showTranscript ? -1 : 0}
                  >
                    Transcript
                    {(status === 'connecting' || status === 'extracting' || status === 'queued' || status === 'transcribing') && (
                      <SpinnerGap size={12} weight="bold" className="animate-spin text-slate-400" />
                    )}
                    {status === 'complete' && (
                      <CheckCircle size={12} weight="fill" className="text-emerald-400" />
                    )}
                    {status === 'error' && (
                      <WarningCircle size={12} weight="fill" className="text-red-400" />
                    )}
                  </button>
                </div>
              </>
            }
          />
          {/* Chapter timeline — replaces header border-b */}
          {hasSegments && durationSeconds && durationSeconds > 0 ? (
            <ChapterTimeline
              segments={segments}
              currentTime={currentTime}
              duration={durationSeconds}
              onSeek={handleSeek}
              keyMoments={knowledgeContext?.video?.key_moments}
              interval={selectedInterval}
              onIntervalSelect={handleIntervalSelect}
              onIntervalClear={handleIntervalClear}
            />
          ) : (
            <div className="h-px bg-chalk-border/30" />
          )}
        </div>

        {/* Mobile header */}
        <div className="md:hidden flex-none flex items-center gap-2 px-2 pb-2 pt-[calc(env(safe-area-inset-top)+8px)] bg-chalk-bg/95 backdrop-blur-md border-b border-chalk-border/30">
          <a
            href="/"
            className="flex items-center p-2.5 -ml-1 text-white/60 active:text-white/90 transition-colors"
            aria-label="Back to home"
          >
            <ArrowBendUpLeft size={18} weight="bold" />
          </a>
          <ChalkboardSimple
            size={16}
            className="flex-shrink-0 text-chalk-text"
          />
          <div className="flex flex-col flex-1 min-w-0">
            {effectiveChannel && (
              <span className="text-[10px] text-slate-500 truncate leading-tight">
                {effectiveChannel}
              </span>
            )}
            <span className="text-xs leading-tight truncate text-slate-400">
              {effectiveTitle || videoId}
            </span>
          </div>
          <button
            onClick={() => setShowCaptions((v) => !v)}
            className={`px-1.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
              showCaptions
                ? "bg-chalk-accent/15 text-chalk-accent border border-chalk-accent/30"
                : "text-slate-500 hover:text-slate-300 bg-chalk-surface/50 border border-chalk-border/30"
            }`}
          >
            CC
          </button>
        </div>

        {/* Video area */}
        <div
          className={`md:flex-1 flex flex-col overflow-hidden relative md:items-center md:justify-center md:max-h-none transition-[flex,height] duration-[250ms] ease-out motion-reduce:transition-none ${
            keyboardOpen
              ? "flex-none h-0"
              : chatting || transcriptCollapsed
                ? "flex-1 min-h-0"
                : "flex-none h-[28dvh]"
          }`}
        >
          {/* Wrapper — max-h-full prevents video from exceeding available space */}
          <div className="overflow-hidden relative z-0 flex-1 md:flex-none flex flex-col items-center justify-center p-0 md:w-full md:px-4 md:max-h-full">
            {/* Container — max-width keeps video from stretching too wide when transcript panel is closed */}
            <div data-video-container data-playing={!isPaused || undefined} className="w-full md:max-w-[calc((100dvh_-_14rem)*16/9)] md:max-h-full md:mx-auto relative flex-1 md:flex-none">
              {/* Video — aspect-video with max-h constraint to prevent overflow */}
              <div
                className="group relative aspect-video md:rounded-xl md:overflow-hidden md:max-h-[calc(100dvh-14rem)]"
                data-paused={isPaused || undefined}
              >
                <VideoPlayer
                  playerRef={playerRef}
                  videoId={videoId}
                  onPause={handlePause}
                  onPlay={handlePlay}
                  onTimeUpdate={handleTimeUpdate}
                  onRateChange={handleRateChange}
                />
                {/* Mobile: absolute overlay captions */}
                {showCaptions && hasSegments && !chatting && (
                  <div className="md:hidden absolute right-0 bottom-0 left-0 z-10 px-2 pt-8 pb-2 bg-gradient-to-t to-transparent pointer-events-none from-black/60">
                    <KaraokeCaption
                      segments={segments}
                      currentTime={currentTime}
                    />
                  </div>
                )}
                {/* Desktop: captions inside video, centered in bottom controls bar */}
                {showCaptions && hasSegments && (
                  <div className={`hidden md:flex absolute left-0 right-0 bottom-[12px] z-10 justify-center pointer-events-none transition-opacity duration-200 ${
                    phase === 'watching' ? 'opacity-100' : 'opacity-0'
                  }`}>
                    <div className="px-3 py-1 rounded-md bg-black/60 backdrop-blur-sm">
                      <KaraokeCaption segments={segments} currentTime={currentTime} />
                    </div>
                  </div>
                )}
                {/* Time chip — top-right of video */}
                {currentTime > 0 && (
                  <button
                    onClick={() => {
                      overlayDispatch({ type: 'ACTIVATE' });
                      requestAnimationFrame(() => {
                        if (inputRef.current) {
                          inputRef.current.focus();
                          const text = `What's happening at [${Math.floor(currentTime / 60)}:${Math.floor(currentTime % 60).toString().padStart(2, '0')}]?`;
                          inputRef.current.textContent = '';
                          inputRef.current.appendChild(document.createTextNode(text));
                          const sel = window.getSelection();
                          if (sel) {
                            const range = document.createRange();
                            range.selectNodeContents(inputRef.current);
                            range.collapse(false);
                            sel.removeAllRanges();
                            sel.addRange(range);
                          }
                          inputRef.current.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                      });
                    }}
                    className="hidden md:inline-flex absolute right-3 top-3 z-10 items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-white/70 bg-black/50 backdrop-blur-sm border border-white/10 hover:bg-black/70 hover:text-white hover:border-white/20 transition-all duration-200"
                  >
                    {formatTimestamp(Math.floor(currentTime))}
                  </button>
                )}
              </div>

              {/* Unified interaction overlay (text + voice + learn) — inside container */}
              <VoiceProvider
                voiceState={unified.voiceState}
                onStart={unified.startRecording}
                onStop={unified.stopRecording}
                onCancel={unified.cancelRecording}
                onStopPlayback={unified.stopPlayback}
                duration={unified.recordingDuration}
                error={unified.voiceError}
              >
                <LearnProvider state={learnStateMemo} handlers={learnHandlersMemo}>
                  <ExploreProvider value={exploreValue}>
                    <ReadAloudProvider value={readAloudValue}>
                      <InVideoProvider value={inVideoValue}>
                        <InteractionOverlay
                          phase={phase}
                          segments={segments}
                          currentTime={currentTime}
                          videoId={videoId}
                          videoTitle={effectiveTitle ?? undefined}
                          transcriptSource={source ?? undefined}
                          isTextStreaming={unified.isTextStreaming}
                          currentUserText={unified.currentUserText}
                          currentAiText={unified.currentAiText}
                          currentToolCalls={unified.currentToolCalls}
                          currentRawAiText={unified.currentRawAiText}
                          textError={unified.textError}
                          onTextSubmit={unified.handleTextSubmit}
                          onStopTextStream={unified.stopTextStream}
                          voiceTranscript={unified.voiceTranscript}
                          voiceResponseText={unified.voiceResponseText}
                          onOpenVideo={handleOpenVideo}
                          exchanges={unified.exchanges}
                          onClearHistory={unified.clearHistory}
                          onSeek={handleSeek}
                          onClose={() => overlayDispatch({ type: 'CLOSE' })}
                          inputRef={inputRef}
                          onInputFocus={() => overlayDispatch({ type: 'ACTIVATE' })}
                          onInputBlur={() => {}}
                          curriculumContext={curriculum.curriculumContext}
                          curriculumVideoCount={curriculum.videoCount}
                          storyboardLevels={storyboardLevels}
                          interval={selectedInterval}
                          onClearInterval={handleIntervalClear}
                          isPaused={isPaused}
                          showCaptions={showCaptions}
                          onToggleCaptions={() => setShowCaptions(v => !v)}
                          playbackSpeed={playbackSpeed}
                          onSetSpeed={handleSetSpeed}
                          hasTranscript={hasSegments}
                        />
                      </InVideoProvider>
                    </ReadAloudProvider>
                  </ExploreProvider>
                </LearnProvider>
              </VoiceProvider>


              {/* Video border — subtle white when playing, faint when paused */}
              <div
                data-video-border
                className={`hidden md:block absolute top-0 left-0 right-0 aspect-video max-h-[calc(100dvh-14rem)] rounded-xl border-[4px] pointer-events-none z-30 transition-colors duration-300 ease-out ${
                  isPaused ? 'border-white/[0.08]' : 'border-white/[0.25]'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Mobile transcript — collapsible */}
        <div
          className={`md:hidden flex flex-col border-t border-chalk-border/40 overflow-hidden transition-[flex,height] duration-[250ms] ease-out motion-reduce:transition-none ${
            keyboardOpen || chatting
              ? "flex-none h-0"
              : transcriptCollapsed
                ? "flex-none h-10"
                : "flex-1 min-h-0"
          }`}
        >
          {transcriptCollapsed && !keyboardOpen ? (
            <WhisperBar
              label="Transcript"
              meta={
                status === "connecting" || status === "extracting"
                  ? "Loading..."
                  : segments.length === 0
                    ? "No transcript"
                    : formatTimestamp(currentTime)
              }
              onTap={() => setTranscriptCollapsed(false)}
            />
          ) : (
            <>
              <SectionGrip
                onTap={() => setTranscriptCollapsed(true)}
                sectionName="transcript"
              />
              <div className="overflow-hidden flex-1 min-h-0">
                <TranscriptPanel
                  segments={segments}
                  currentTime={currentTime}
                  onSeek={handleSeek}
                  status={status}
                  statusMessage={statusMessage}
                  source={source}
                  progress={progress}
                  error={error ?? undefined}
                  variant="mobile"
                  onAskAbout={handleAskAbout}
                  videoId={videoId}
                  videoTitle={effectiveTitle ?? undefined}
                  queueProgress={queueProgress}
                />
              </div>
            </>
          )}
        </div>

        {/* Bottom safe area padding on mobile */}
        <div className="flex-none md:hidden bg-chalk-bg pb-safe" />
      </div>

      {/* Transcript sidebar — right (desktop), responsive widths */}
      <div
        className={`hidden md:flex flex-none overflow-hidden transition-[width] duration-[250ms] ease-out ${
          showTranscript ? "border-l lg:w-[320px] xl:w-[380px] border-chalk-border/30" : "w-0"
        }`}
      >
        <div className="lg:w-[320px] xl:w-[380px] flex-none h-full">
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
            onClose={() => setShowTranscript(false)}
            onAskAbout={handleAskAbout}
            videoId={videoId}
            videoTitle={effectiveTitle ?? undefined}
            queueProgress={queueProgress}
          />
        </div>
      </div>

      {/* Voice clone consent dialog — portal renders above everything */}
      {needsConsent && (
        <VoiceCloneConsent
          channelName={effectiveChannel}
          onAllow={grantConsent}
          onDecline={declineConsent}
        />
      )}
    </div>
  );
}

export default function WatchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center h-screen bg-chalk-bg">
          <div className="w-8 h-8 rounded-full border-2 animate-spin border-chalk-accent/30 border-t-chalk-accent" />
        </div>
      }
    >
      <WatchContent />
    </Suspense>
  );
}
