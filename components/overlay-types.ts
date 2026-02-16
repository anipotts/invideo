import type { RefObject } from "react";
import type { VoiceState } from "@/hooks/useVoiceMode";
import type { TranscriptSegment, TranscriptSource, IntervalSelection } from "@/lib/video-utils";
import type { StoryboardLevel } from "@/lib/storyboard";
import type {
  ParsedQuiz,
  ParsedExplanation,
  LearnModePhase,
  LearnAction,
} from "@/hooks/useLearnMode";
import type { LearnOption } from "@/hooks/useLearnOptions";
import type { UnifiedExchange } from "./ExchangeMessage";
import type { ToolCallData } from "./ToolRenderers";

export interface LearnState {
  phase: LearnModePhase;
  selectedAction: LearnAction | null;
  quiz: ParsedQuiz | null;
  explanation: ParsedExplanation | null;
  introText: string;
  responseContent: string;
  exportableContent: string | null;
  answers: Map<number, string>;
  score: { correct: number; total: number };
  thinking: string | null;
  thinkingDuration: number | null;
  isLoading: boolean;
  error: string | null;
  options: LearnOption[];
  optionsLoading: boolean;
}

export interface LearnHandlers {
  onSelectAction: (action: LearnAction) => void;
  onFocusInput?: () => void;
  onSelectAnswer: (questionIndex: number, optionId: string) => void;
  onNextBatch: () => void;
  onStop: () => void;
}

export interface VoiceControls {
  state: VoiceState;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  onStopPlayback: () => void;
  duration: number;
  error: string | null;
}

/**
 * Slimmed-down props for InteractionOverlay.
 * Voice, Learn, Explore, ReadAloud, and InVideo state are now provided via React contexts
 * (see overlay-contexts.tsx), reducing this from 62 to ~20 core props.
 */
export interface InteractionOverlayProps {
  phase: import('@/hooks/useOverlayPhase').OverlayPhase;
  segments: TranscriptSegment[];
  currentTime: number;
  videoId: string;
  videoTitle?: string;
  transcriptSource?: TranscriptSource;

  // Text streaming state
  isTextStreaming: boolean;
  currentUserText: string;
  currentAiText: string;
  currentToolCalls?: ToolCallData[];
  currentRawAiText?: string;
  textError: string | null;
  onTextSubmit: (text: string) => Promise<void>;
  onStopTextStream: () => void;

  // Voice transcript (from unified mode, for voice mode visual feedback)
  voiceTranscript?: string;
  voiceResponseText?: string;

  // Side panel
  onOpenVideo?: (
    videoId: string,
    title: string,
    channelName: string,
    seekTo?: number,
  ) => void;

  // Unified state
  exchanges: UnifiedExchange[];
  onClearHistory: () => void;

  onSeek: (seconds: number) => void;
  onClose: () => void;
  inputRef?: RefObject<HTMLElement | null>;
  onInputFocus?: () => void;
  onInputBlur?: () => void;

  // Curriculum
  curriculumContext?: string | null;
  curriculumVideoCount?: number;

  // Storyboard data for timestamp hover cards
  storyboardLevels?: StoryboardLevel[];

  // Interval selection
  interval?: IntervalSelection | null;
  onClearInterval?: () => void;

  // Video paused state (for caret color)
  isPaused?: boolean;

  // Settings controls (captions + speed) — rendered in InputStripContent gear dropdown
  showCaptions?: boolean;
  onToggleCaptions?: () => void;
  playbackSpeed?: number;
  onSetSpeed?: (speed: number) => void;
  hasTranscript?: boolean;

  /** Ref bridge for 3-level Escape stacking (drawer dismiss) */
  drawerRef?: import("react").RefObject<{ isOpen: boolean; dismiss: () => void } | null>;
}
