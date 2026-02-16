"use client";

import React, { useState, useRef, useEffect, useCallback, type RefObject } from "react";
import { motion } from "framer-motion";
import { TextInput } from "./TextInput";
import type { UnifiedExchange } from "./ExchangeMessage";
import {
  Microphone,
  StopCircle,
  ArrowUp,
  X,
  GearSix,
  Trash,
} from "@phosphor-icons/react";
import type { VoiceControls } from "./overlay-types";
import type { OverlayPhase } from "@/hooks/useOverlayPhase";
import { formatInterval, type IntervalSelection } from "@/lib/video-utils";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function SettingsDropdown({
  showCaptions,
  onToggleCaptions,
  speed,
  onSetSpeed,
  captionsDisabled,
}: {
  showCaptions: boolean;
  onToggleCaptions: () => void;
  speed: number;
  onSetSpeed: (s: number) => void;
  captionsDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center transition-colors flex-shrink-0 text-slate-600 hover:text-slate-400"
        title="Settings"
        aria-label="Settings"
      >
        <GearSix size={14} />
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-0 w-44 rounded-xl border shadow-xl bg-[#0a0a0a] border-chalk-border/50 shadow-black/70 z-50 overflow-hidden">
          <div className="p-1">
            <button
              onClick={() => {
                if (!captionsDisabled) onToggleCaptions();
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-between ${
                captionsDisabled
                  ? "text-slate-600 cursor-not-allowed"
                  : showCaptions
                    ? "text-chalk-text bg-white/[0.06]"
                    : "text-slate-400 hover:text-chalk-text hover:bg-white/[0.04]"
              }`}
              disabled={captionsDisabled}
            >
              Captions
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                  captionsDisabled
                    ? "text-slate-600"
                    : showCaptions
                      ? "bg-chalk-accent/20 text-chalk-accent"
                      : "text-slate-600"
                }`}
              >
                {captionsDisabled ? "---" : showCaptions ? "ON" : "OFF"}
              </span>
            </button>
            <div className="pt-1 mt-1 border-t border-chalk-border/20">
              <div className="px-3 py-1 text-[10px] text-slate-600 font-medium">
                Speed
              </div>
              {SPEED_PRESETS.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    onSetSpeed(s);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors ${
                    speed === s
                      ? "bg-white/[0.08] text-chalk-text font-medium"
                      : "text-slate-400 hover:text-chalk-text hover:bg-white/[0.04]"
                  }`}
                >
                  {s}x{s === 1 ? " (Normal)" : ""}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* --- InputStripContent --- */

export interface InputStripContentProps {
  phase: OverlayPhase;
  input: string;
  setInput: (value: string) => void;
  handleSubmit: () => void;
  isTextStreaming: boolean;
  exploreMode: boolean;
  toggleExploreMode: () => void;
  onStopStream: () => void;
  inputRef?: RefObject<HTMLElement | null>;
  onInputFocus?: () => void;
  onInputBlur?: () => void;

  // Voice controls
  voiceControls: VoiceControls;
  recordingDuration: number;

  // Exchanges for clear button
  exchanges: UnifiedExchange[];
  onClearHistory: () => void;
  onClose?: () => void;

  // Curriculum
  curriculumContext?: string | null;
  curriculumVideoCount?: number;

  // Height reporting for dynamic spacer
  onHeightChange?: (height: number) => void;

  // Interval selection
  interval?: IntervalSelection | null;
  onClearInterval?: () => void;

  // Settings (captions + speed)
  showCaptions?: boolean;
  onToggleCaptions?: () => void;
  playbackSpeed?: number;
  onSetSpeed?: (speed: number) => void;
  hasTranscript?: boolean;
}

export function InputStripContent({
  phase,
  input,
  setInput,
  handleSubmit,
  isTextStreaming,
  exploreMode,
  toggleExploreMode,
  onStopStream,
  inputRef,
  onInputFocus,
  onInputBlur,
  voiceControls,
  recordingDuration,
  exchanges,
  onClearHistory,
  onClose,
  curriculumContext,
  curriculumVideoCount,
  onHeightChange,
  interval,
  onClearInterval,
  showCaptions,
  onToggleCaptions,
  playbackSpeed,
  onSetSpeed,
  hasTranscript,
}: InputStripContentProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const expanded = phase === "chatting";
  const [inputFocused, setInputFocused] = useState(false);

  const handleInputFocus = useCallback(() => {
    setInputFocused(true);
    onInputFocus?.();
  }, [onInputFocus]);

  const handleInputBlur = useCallback(() => {
    setInputFocused(false);
    onInputBlur?.();
  }, [onInputBlur]);

  // Report height changes via ResizeObserver for dynamic spacer
  // Tab key focuses input when input isn't focused
  useEffect(() => {
    const handleTab = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && !e.shiftKey && !inputFocused) {
        e.preventDefault();
        inputRef?.current?.focus();
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [inputFocused, inputRef]);

  useEffect(() => {
    const el = stripRef.current;
    if (!el || !onHeightChange) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        onHeightChange(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeightChange]);

  return (
    <div
      ref={stripRef}
      data-input-strip
      className={`absolute bottom-0 left-0 right-0 z-[32] pointer-events-none md:relative md:inset-auto md:w-full md:z-auto transition-opacity duration-150 ${
        phase === "watching" ? "md:opacity-60" : "md:opacity-100"
      }`}
    >
      <div
        className={`pointer-events-auto px-3 pb-3 md:px-0 md:pb-0 md:pt-3 ${expanded ? "backdrop-blur-md bg-chalk-surface/95 md:bg-transparent md:backdrop-blur-none" : "pt-8 bg-gradient-to-t to-transparent from-black/80 via-black/40 md:from-transparent md:via-transparent md:pt-3 md:bg-none"}`}
      >
        {/* Unified input row — constrained width on desktop, centered */}
        <div className="flex gap-2 items-end md:max-w-3xl md:mx-auto">
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            isStreaming={isTextStreaming}
            onStop={onStopStream}
            placeholder="Ask about this video..."
            inputRef={inputRef}
            autoFocus={false}
            exploreMode={exploreMode}
            onToggleExplore={toggleExploreMode}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            topBar={
              interval ? (
                <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/[0.06]">
                  <span
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-300 bg-amber-500/15 border border-amber-400/30 rounded-full px-2.5 py-1 font-mono"
                    title="Selected interval — double-click timeline or click X to clear"
                  >
                    {formatInterval(interval.startTime, interval.endTime)}
                    {onClearInterval && (
                      <button
                        type="button"
                        onClick={onClearInterval}
                        className="ml-0.5 text-amber-400/60 hover:text-amber-300 transition-colors"
                        aria-label="Clear interval selection"
                      >
                        <X size={10} weight="bold" />
                      </button>
                    )}
                  </span>
                </div>
              ) : undefined
            }
            actions={
              <>
                {/* Keyboard hint: esc (when chatting + input focused) / tab (when input not focused) */}
                {!inputFocused && (
                  <button
                    type="button"
                    onClick={() => inputRef?.current?.focus()}
                    className="hidden md:flex items-center h-8 px-2 rounded-lg text-[11px] font-medium text-slate-600 hover:text-slate-400 transition-colors"
                    title="Focus input (Tab)"
                    aria-label="Focus input"
                  >
                    tab
                  </button>
                )}
                {inputFocused && expanded && onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="hidden md:flex items-center h-8 px-2 rounded-lg text-[11px] font-medium text-slate-600 hover:text-slate-400 transition-colors"
                    title="Close overlay (Esc)"
                    aria-label="Close overlay"
                  >
                    esc
                  </button>
                )}
                {isTextStreaming ? (
                  <button
                    type="button"
                    onClick={onStopStream}
                    className="flex flex-shrink-0 justify-center items-center w-8 h-8 text-red-400 rounded-lg transition-colors bg-red-500/15 hover:bg-red-500/25"
                    title="Stop"
                    aria-label="Stop response"
                  >
                    <StopCircle size={14} weight="fill" />
                  </button>
                ) : voiceControls.state !== "idle" ? (
                  <motion.button
                    className={`flex-shrink-0 h-8 rounded-lg flex items-center justify-center transition-all px-2.5 ${
                      voiceControls.state === "recording"
                        ? "bg-rose-500 shadow-lg shadow-rose-500/30"
                        : voiceControls.state === "speaking"
                          ? "bg-emerald-500/20 hover:bg-emerald-500/30 cursor-pointer"
                          : "bg-chalk-accent/20"
                    }`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                    }}
                    onPointerUp={(e) => {
                      e.preventDefault();
                      if (voiceControls.state === "recording")
                        voiceControls.onStop();
                      else if (voiceControls.state === "speaking")
                        voiceControls.onStopPlayback();
                    }}
                    onPointerLeave={(e) => {
                      e.preventDefault();
                      if (voiceControls.state === "recording")
                        voiceControls.onStop();
                    }}
                    whileTap={{ scale: 0.95 }}
                    aria-label={
                      voiceControls.state === "recording"
                        ? "Recording -- release to stop"
                        : voiceControls.state === "speaking"
                          ? "Stop speaking"
                          : "Processing voice"
                    }
                  >
                    <span
                      className={`text-[11px] font-medium whitespace-nowrap flex items-center gap-1 ${
                        voiceControls.state === "recording"
                          ? "text-white"
                          : voiceControls.state === "speaking"
                            ? "text-emerald-400"
                            : "text-chalk-accent"
                      }`}
                    >
                      {voiceControls.state === "recording" &&
                        `Listening ${formatDuration(recordingDuration)}`}
                      {voiceControls.state === "transcribing" &&
                        "Transcribing..."}
                      {voiceControls.state === "thinking" && "Thinking..."}
                      {voiceControls.state === "speaking" && (
                        <>
                          <StopCircle size={10} weight="fill" /> Stop
                        </>
                      )}
                    </span>
                  </motion.button>
                ) : input.trim() ? (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    className="flex flex-shrink-0 justify-center items-center w-8 h-8 rounded-lg transition-colors bg-chalk-accent/15 text-chalk-accent hover:bg-chalk-accent/25"
                    title="Send"
                    aria-label="Send message"
                  >
                    <ArrowUp size={14} weight="bold" />
                  </button>
                ) : (
                  <motion.button
                    className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.10] transition-all"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      if (voiceControls.state === "idle")
                        voiceControls.onStart();
                    }}
                    onPointerUp={(e) => {
                      e.preventDefault();
                      if (voiceControls.state === "recording")
                        voiceControls.onStop();
                    }}
                    onPointerLeave={(e) => {
                      e.preventDefault();
                      if (voiceControls.state === "recording")
                        voiceControls.onStop();
                    }}
                    whileTap={{ scale: 0.95 }}
                    title="Hold to record voice"
                    aria-label="Hold to record voice"
                  >
                    <Microphone
                      size={16}
                      weight="fill"
                      className="text-white/70"
                    />
                  </motion.button>
                )}
              </>
            }
            leftActions={
              <>
                {showCaptions !== undefined &&
                  onToggleCaptions &&
                  playbackSpeed !== undefined &&
                  onSetSpeed && (
                    <SettingsDropdown
                      showCaptions={showCaptions}
                      onToggleCaptions={onToggleCaptions}
                      speed={playbackSpeed}
                      onSetSpeed={onSetSpeed}
                      captionsDisabled={!hasTranscript}
                    />
                  )}
                {expanded && exchanges.length > 0 && (
                  <button
                    onClick={onClearHistory}
                    className="hidden md:flex items-center justify-center transition-colors flex-shrink-0 text-slate-600 hover:text-slate-400"
                    title="Clear conversation"
                    aria-label="Clear conversation history"
                  >
                    <Trash size={14} />
                  </button>
                )}
              </>
            }
          />
        </div>

        {/* Voice error */}
        {voiceControls.error && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-3 py-2 mt-3 text-xs text-rose-400 rounded-lg bg-rose-500/10"
          >
            {voiceControls.error}
          </motion.div>
        )}
      </div>
    </div>
  );
}
