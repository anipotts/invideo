'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { VoiceState } from '@/hooks/useVoiceMode';
import type { LearnState, LearnHandlers, VoiceControls } from './overlay-types';
import type { SideVideoEntry } from './SideVideoPanel';
import type { LearnOption } from '@/hooks/useLearnOptions';

// --- Voice Context ---

const VoiceCtx = createContext<VoiceControls | null>(null);

export function useVoiceControls(): VoiceControls {
  const ctx = useContext(VoiceCtx);
  if (!ctx) throw new Error('useVoiceControls must be used within VoiceProvider');
  return ctx;
}

export function VoiceProvider({
  voiceState,
  onStart,
  onStop,
  onCancel,
  onStopPlayback,
  duration,
  error,
  children,
}: {
  voiceState: VoiceState;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  onStopPlayback: () => void;
  duration: number;
  error: string | null;
  children: ReactNode;
}) {
  const value = useMemo<VoiceControls>(
    () => ({ state: voiceState, onStart, onStop, onCancel, onStopPlayback, duration, error }),
    [voiceState, onStart, onStop, onCancel, onStopPlayback, duration, error],
  );
  return <VoiceCtx.Provider value={value}>{children}</VoiceCtx.Provider>;
}

// --- Learn Context ---

interface LearnContextValue {
  state: LearnState;
  handlers: LearnHandlers;
}

const LearnCtx = createContext<LearnContextValue | null>(null);

export function useLearnContext(): LearnContextValue {
  const ctx = useContext(LearnCtx);
  if (!ctx) throw new Error('useLearnContext must be used within LearnProvider');
  return ctx;
}

export function LearnProvider({
  state,
  handlers,
  children,
}: {
  state: LearnState;
  handlers: LearnHandlers;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ state, handlers }), [state, handlers]);
  return <LearnCtx.Provider value={value}>{children}</LearnCtx.Provider>;
}

// --- Explore Context ---

export interface ExploreContextValue {
  exploreMode: boolean;
  onToggle: () => void;
  onSubmit: (text: string) => Promise<void>;
  onStop: () => void;
  error: string | null;
  pills: string[];
  isThinking: boolean;
  thinkingDuration: number | null;
}

const ExploreCtx = createContext<ExploreContextValue | null>(null);

export function useExploreContext(): ExploreContextValue {
  const ctx = useContext(ExploreCtx);
  if (!ctx) throw new Error('useExploreContext must be used within ExploreProvider');
  return ctx;
}

export function ExploreProvider({ value, children }: { value: ExploreContextValue; children: ReactNode }) {
  return <ExploreCtx.Provider value={value}>{children}</ExploreCtx.Provider>;
}

// --- Read Aloud Context ---

export interface ReadAloudContextValue {
  autoReadAloud: boolean;
  onToggle: (enabled: boolean) => void;
  playingMessageId: string | null;
  onPlay: (id: string, text: string) => void;
  isLoading: boolean;
  readAloudProgress: number;
}

const ReadAloudCtx = createContext<ReadAloudContextValue | null>(null);

export function useReadAloudContext(): ReadAloudContextValue {
  const ctx = useContext(ReadAloudCtx);
  if (!ctx) throw new Error('useReadAloudContext must be used within ReadAloudProvider');
  return ctx;
}

export function ReadAloudProvider({ value, children }: { value: ReadAloudContextValue; children: ReactNode }) {
  return <ReadAloudCtx.Provider value={value}>{children}</ReadAloudCtx.Provider>;
}

// --- InVideo Context ---

export interface InVideoContextValue {
  entry: SideVideoEntry | null;
  onClose: () => void;
}

const InVideoCtx = createContext<InVideoContextValue | null>(null);

export function useInVideoContext(): InVideoContextValue {
  const ctx = useContext(InVideoCtx);
  if (!ctx) throw new Error('useInVideoContext must be used within InVideoProvider');
  return ctx;
}

export function InVideoProvider({ value, children }: { value: InVideoContextValue; children: ReactNode }) {
  return <InVideoCtx.Provider value={value}>{children}</InVideoCtx.Provider>;
}
