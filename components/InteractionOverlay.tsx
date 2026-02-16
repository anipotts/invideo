"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { storageKey } from "@/lib/brand";
import type { InteractionOverlayProps } from "./overlay-types";
import { OverlayBackdrop } from "./OverlayBackdrop";
import { MessagePanel } from "./MessagePanel";
import { InputStripContent } from "./InputStripContent";
import { VideoTimeProvider } from "./VideoTimeContext";
import {
  useVoiceControls,
  useLearnContext,
  useExploreContext,
  useReadAloudContext,
  useInVideoContext,
} from "./overlay-contexts";

/* --- Main component: InteractionOverlay (thin shell) --- */

export function InteractionOverlay({
  phase,
  segments,
  currentTime,
  videoId,
  videoTitle,
  transcriptSource,

  // Text
  isTextStreaming,
  currentUserText,
  currentAiText,
  currentToolCalls,
  currentRawAiText,
  textError,
  onTextSubmit,
  onStopTextStream,
  onOpenVideo,

  // Voice transcript (from unified mode)
  voiceTranscript,
  voiceResponseText,

  // Unified
  exchanges,
  onClearHistory,

  onSeek,
  onClose,
  inputRef,
  onInputFocus,
  onInputBlur,
  curriculumContext,
  curriculumVideoCount,

  storyboardLevels,
  interval,
  onClearInterval,
  isPaused,
  showCaptions,
  onToggleCaptions,
  playbackSpeed,
  onSetSpeed,
  hasTranscript,
  drawerRef,
}: InteractionOverlayProps) {
  const [input, setInput] = useState("");
  const [inputStripHeight, setInputStripHeight] = useState(72);

  // Consume contexts
  const voiceControls = useVoiceControls();
  const { state: learnState, handlers: learnHandlers } = useLearnContext();
  const { exploreMode, onSubmit: exploreSubmit, onToggle: exploreToggle, onStop: exploreStop, error: exploreError, isThinking: exploreIsThinking, thinkingDuration: exploreThinkingDuration } = useExploreContext();
  const readAloud = useReadAloudContext();
  const inVideo = useInVideoContext();

  const visible = phase === 'chatting';
  const isTextMode = voiceControls.state === "idle";
  const hasMessages = exchanges.length > 0 || isTextStreaming || !!currentAiText;

  // One-time cleanup of old localStorage keys
  useEffect(() => {
    try {
      localStorage.removeItem(storageKey("chat-model"));
      localStorage.removeItem("chalk-auto-pause-chat");
    } catch {
      /* ignore */
    }
  }, []);

  const isLearnModeActive = learnState.phase !== "idle";
  const hasContent =
    exchanges.length > 0 ||
    isTextStreaming ||
    !!currentUserText ||
    !!currentAiText ||
    voiceControls.state !== "idle" ||
    isLearnModeActive ||
    exploreMode;

  const handleSubmit = useCallback(async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");

    if (isLearnModeActive) {
      learnHandlers.onStop();
    }

    if (exploreMode) {
      await exploreSubmit(text);
    } else {
      await onTextSubmit(text);
    }
  }, [input, exploreMode, exploreSubmit, isLearnModeActive, learnHandlers, onTextSubmit]);

  const handlePillSelect = useCallback(
    (option: string) => {
      exploreSubmit(option);
    },
    [exploreSubmit],
  );

  const focusInput = useCallback(() => {
    inputRef?.current?.focus();
  }, [inputRef]);

  const showExploreUI = exploreMode;

  return (
    <>
      {/* Message overlay — visible when chatting, AnimatePresence for exit */}
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 md:inset-auto md:top-0 md:left-0 md:right-0 md:aspect-video z-10 flex flex-col md:rounded-xl md:overflow-hidden"
          >
            <OverlayBackdrop visible={visible} onClick={onClose} grainActive={hasMessages} />
            <VideoTimeProvider currentTime={currentTime} isPaused={false}>
              <MessagePanel
                hasContent={hasContent}
                expanded={visible}
                exchanges={exchanges}
                segments={segments}
                videoId={videoId}
                onSeek={onSeek}
                onClose={onClose}
                onOpenVideo={onOpenVideo}
                isTextStreaming={isTextStreaming}
                currentUserText={currentUserText}
                currentAiText={currentAiText}
                currentToolCalls={currentToolCalls}
                currentRawAiText={currentRawAiText}
                textError={textError}
                voiceState={voiceControls.state}
                voiceTranscript={voiceTranscript ?? ""}
                voiceResponseText={voiceResponseText ?? ""}
                voiceError={voiceControls.error}
                showExploreUI={showExploreUI}
                exploreMode={exploreMode}
                exploreError={exploreError}
                isThinking={exploreIsThinking}
                thinkingDuration={exploreThinkingDuration}
                submitExploreMessage={exploreSubmit}
                playingMessageId={readAloud.playingMessageId}
                onPlayMessage={readAloud.onPlay}
                isReadAloudLoading={readAloud.isLoading}
                readAloudProgress={readAloud.readAloudProgress}
                handlePillSelect={handlePillSelect}
                focusInput={focusInput}
                learnState={learnState}
                learnHandlers={learnHandlers}
                videoTitle={videoTitle}
                tooltipSegments={segments}
                storyboardLevels={storyboardLevels}
                inVideoEntry={inVideo.entry}
                onCloseInVideo={inVideo.onClose}
                isPaused={isPaused}
                drawerRef={drawerRef}
              />
            </VideoTimeProvider>
            {/* Dynamic spacer for input strip on mobile */}
            <div className="md:hidden flex-none" style={{ height: inputStripHeight }} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input strip -- below video on desktop, bottom-pinned on mobile */}
      <InputStripContent
        phase={phase}
        input={input}
        setInput={setInput}
        handleSubmit={handleSubmit}
        isTextStreaming={isTextStreaming}
        exploreMode={exploreMode}
        toggleExploreMode={exploreToggle}
        onStopStream={() => {
          if (exploreMode) {
            exploreStop();
          } else {
            onStopTextStream();
          }
        }}
        inputRef={inputRef}
        onInputFocus={onInputFocus}
        onInputBlur={onInputBlur}
        voiceControls={voiceControls}
        recordingDuration={voiceControls.duration}
        exchanges={exchanges}
        onClearHistory={onClearHistory}
        onClose={onClose}
        curriculumContext={curriculumContext}
        curriculumVideoCount={curriculumVideoCount}
        onHeightChange={setInputStripHeight}
        interval={interval}
        onClearInterval={onClearInterval}
        showCaptions={showCaptions}
        onToggleCaptions={onToggleCaptions}
        playbackSpeed={playbackSpeed}
        onSetSpeed={onSetSpeed}
        hasTranscript={hasTranscript}
      />
    </>
  );
}
