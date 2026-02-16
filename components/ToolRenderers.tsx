'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatTimestamp } from '@/lib/video-utils';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { ChalkIcon } from './ChalkIcon';

// Tool result types matching the server-side tool outputs

export interface CiteMomentResult {
  type: 'cite_moment';
  timestamp: string;
  timestamp_seconds: number;
  label: string;
  context: string;
  transcript_line: string;
  video_id: string;
}

export interface ReferenceVideoResult {
  type: 'reference_video';
  video_id: string;
  timestamp_seconds: number | null;
  video_title: string;
  channel_name: string;
  reason: string;
  thumbnail_url: string;
  caption_excerpt: string | null;
  relationship?: string;
  shared_concepts?: string[];
}

export interface SearchResult {
  type: 'search_results';
  query: string;
  results: Array<{
    kind: string;
    video_id: string;
    title: string;
    channel_name: string | null;
    mention_type?: string;
  }>;
  message?: string;
}

export interface PrerequisiteChainResult {
  type: 'prerequisite_chain';
  concept_id: string;
  chain: Array<{
    concept_id: string;
    display_name: string;
    depth: number;
    best_video_id: string | null;
    best_video_title: string | null;
  }>;
  message?: string;
}

export interface QuizResult {
  type: 'quiz';
  questions: Array<{
    question: string;
    question_type: string;
    correct_answer: string;
    distractors: string[];
    explanation: string;
    difficulty: string;
    bloom_level: string | null;
    concept: string | null;
    timestamp_seconds: number | null;
  }>;
  message?: string;
}

export interface ChapterContextResult {
  type: 'chapter_context';
  chapter: {
    title: string;
    start_seconds: number;
    end_seconds: number | null;
    summary: string | null;
    concepts: string[];
  } | null;
  moments: Array<{
    moment_type: string;
    timestamp_seconds: number;
    content: string;
  }>;
  message?: string;
}

export interface AlternativeExplanationsResult {
  type: 'alternative_explanations';
  concept: string;
  alternatives: Array<{
    video_id: string;
    video_title: string;
    channel_name: string | null;
    pedagogical_approach: string | null;
    timestamp_seconds: number;
    context_snippet: string;
  }>;
  message?: string;
}

export interface LearningPathResult {
  type: 'learning_path';
  from_concept: string;
  to_concept: string;
  steps: Array<{
    step: number;
    concept_id: string;
    display_name: string;
    best_video_id: string | null;
    best_video_title: string | null;
  }>;
  message?: string;
}

export type ToolResult =
  | CiteMomentResult
  | ReferenceVideoResult
  | SearchResult
  | PrerequisiteChainResult
  | QuizResult
  | ChapterContextResult
  | AlternativeExplanationsResult
  | LearningPathResult;

export interface ToolCallData {
  toolName: string;
  result: ToolResult;
}

// === UI Components ===

const relationshipLabels: Record<string, string> = {
  prerequisite: 'Prerequisite',
  follow_up: 'Follow-up',
  related: 'Related',
  deeper_dive: 'Deeper Dive',
  alternative_explanation: 'Alt. Explanation',
  builds_on: 'Builds On',
  contrasts: 'Contrasts',
};

function getRelationshipLabel(reason: string): string {
  const lower = reason.toLowerCase();
  if (lower.includes('prerequisite')) return 'Prerequisite';
  if (lower.includes('follow-up') || lower.includes('followup') || lower.includes('follow up')) return 'Follow-up';
  if (lower.includes('deep dive') || lower.includes('deeper')) return 'Deep Dive';
  if (lower.includes('alternative')) return 'Alternative';
  if (lower.includes('supplement') || lower.includes('complementary')) return 'Supplement';
  return 'Related';
}

export const approachLabels: Record<string, string> = {
  visual_geometric: 'Visual',
  algebraic_symbolic: 'Algebraic',
  intuitive_analogy: 'Analogy',
  formal_proof: 'Proof',
  code_implementation: 'Code',
  worked_example: 'Example',
  historical_narrative: 'History',
  comparative: 'Comparison',
  socratic: 'Socratic',
};

/**
 * Inline citation link for a specific video moment.
 * Renders as a TimestampLink-style inline [M:SS] with a subtle label suffix.
 * The aria-label pattern triggers the existing TimestampTooltip in MessagePanel
 * (storyboard thumbnail + transcript context on hover).
 */
export function CiteMomentCard({
  result,
  onSeek,
}: {
  result: CiteMomentResult;
  onSeek: (seconds: number) => void;
}) {
  return (
    <button
      onClick={() => onSeek(result.timestamp_seconds)}
      className="inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded-md font-mono text-xs align-middle bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 hover:text-blue-300 transition-all duration-300 cursor-pointer"
      aria-label={`Seek to ${result.timestamp} in video`}
      data-cite-label={result.label}
      data-cite-context={result.context}
    >
      {result.timestamp}
      {result.label && (
        <span className="font-sans text-[11px] text-slate-400 max-w-[180px] truncate">{result.label}</span>
      )}
    </button>
  );
}

/**
 * Card showing a referenced video with thumbnail, title, channel, and reason.
 */
export function ReferenceVideoCard({
  result,
  onOpenVideo,
  currentVideoId,
  onSeek,
}: {
  result: ReferenceVideoResult;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
  currentVideoId?: string;
  onSeek?: (seconds: number) => void;
}) {
  const handleClick = () => {
    // Same-video references seek the main player instead of opening side panel
    if (currentVideoId && result.video_id === currentVideoId && result.timestamp_seconds != null && onSeek) {
      onSeek(result.timestamp_seconds);
      return;
    }
    if (onOpenVideo) {
      onOpenVideo(result.video_id, result.video_title, result.channel_name, result.timestamp_seconds ?? undefined);
    }
  };

  const handleNewTab = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = result.timestamp_seconds
      ? `/watch?v=${result.video_id}&t=${Math.floor(result.timestamp_seconds)}`
      : `/watch?v=${result.video_id}`;
    window.open(url, '_blank');
  };

  const badge = result.relationship
    ? (relationshipLabels[result.relationship] || result.relationship)
    : getRelationshipLabel(result.reason);

  return (
    <div
      onClick={handleClick}
      className="flex gap-3 p-3 rounded-lg bg-white/[0.03] backdrop-blur-sm hover:bg-white/[0.05] border border-white/[0.06] hover:border-white/[0.10] cursor-pointer transition-all duration-150 group my-2"
    >
      <div className="flex-shrink-0 w-28 h-16 rounded-md overflow-hidden bg-chalk-border relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={result.thumbnail_url}
          alt={result.video_title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {result.timestamp_seconds !== null && (
          <span className="absolute bottom-0.5 right-0.5 bg-black/80 text-white text-[10px] px-1 rounded font-mono">
            {formatTimestamp(result.timestamp_seconds)}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-200 line-clamp-2">{result.video_title}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-slate-400">{result.channel_name}</span>
          <span className="text-slate-600">&middot;</span>
          <span className="text-[11px] text-slate-500">{badge}</span>
        </div>
        <div className="text-xs text-slate-500 mt-1 line-clamp-2">{result.reason}</div>
        {result.shared_concepts && result.shared_concepts.length > 0 && (
          <div className="text-[11px] text-slate-500 mt-1">
            {result.shared_concepts.slice(0, 5).join(', ')}
          </div>
        )}
      </div>
      <div className="flex flex-col items-center gap-1 flex-shrink-0">
        {onOpenVideo && (
          <button
            onClick={(e) => { e.stopPropagation(); handleClick(); }}
            className="group p-1.5 rounded-md text-chalk-accent/60 hover:text-chalk-accent hover:bg-chalk-accent/10 transition-colors"
            title="Watch in chalk"
          >
            <ChalkIcon size={16} />
          </button>
        )}
        <button
          onClick={handleNewTab}
          className="p-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-all duration-150"
          title="Open in new tab"
        >
          <ArrowSquareOut size={14} />
        </button>
      </div>
    </div>
  );
}

/**
 * Prerequisite chain visualization — shows concepts to learn first.
 */
export function PrerequisiteChainCard({
  result,
  onOpenVideo,
}: {
  result: PrerequisiteChainResult;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
}) {
  if (result.message || result.chain.length === 0) {
    return null;
  }

  // Group by depth — filter out items without video links, max 4 per level
  const byDepth = new Map<number, typeof result.chain>();
  for (const item of result.chain) {
    if (!item.best_video_id) continue;
    if (!byDepth.has(item.depth)) byDepth.set(item.depth, []);
    const group = byDepth.get(item.depth)!;
    if (group.length < 4) group.push(item);
  }

  if (byDepth.size === 0) return null;

  const sortedDepths = [...byDepth.entries()].sort((a, b) => a[0] - b[0]);

  const depthLabels = ['Start here', 'Then', 'Finally'];

  return (
    <div className="p-3 rounded-lg bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] my-2">
      <div className="text-[11px] text-slate-500 uppercase tracking-wider font-mono mb-2">
        Prerequisites
      </div>
      <div className="space-y-0">
        {sortedDepths.map(([depth, items], depthIdx) => (
          <div key={depth} className="flex items-start gap-2">
            {/* Tree connector */}
            <div className="flex flex-col items-center flex-shrink-0 w-5 pt-1">
              {depthIdx < sortedDepths.length - 1 ? (
                <svg width="20" height="20" viewBox="0 0 20 20" className="text-chalk-accent/50">
                  <path d="M10 0 V12 H18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 20 20" className="text-chalk-accent/50">
                  <path d="M10 0 V12 H18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </div>
            {/* Label + chips */}
            <div className="flex-1 min-w-0 pb-2">
              <div className="text-[10px] text-chalk-accent/70 font-mono mb-1">
                {depthLabels[depthIdx] || `Step ${depthIdx + 1}`}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {items.map((item) => (
                  <button
                    key={item.concept_id}
                    onClick={() => {
                      if (item.best_video_id && onOpenVideo) {
                        onOpenVideo(item.best_video_id, item.best_video_title || item.display_name, '', undefined);
                      }
                    }}
                    className="px-2 py-0.5 rounded text-xs transition-all duration-150 bg-white/[0.04] border border-white/[0.06] text-chalk-accent hover:bg-white/[0.08] cursor-pointer"
                    title={item.best_video_title ? `Watch: ${item.best_video_title}` : item.display_name}
                  >
                    {item.display_name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Interactive quiz card with mode selector: "One by one", "All at once", or "Something else".
 * Sequential mode appends questions into the chat like a conversation.
 */
export function QuizCard({
  result,
  onSeek,
}: {
  result: QuizResult;
  onSeek: (seconds: number) => void;
}) {
  if (result.message || result.questions.length === 0) {
    return null;
  }

  const [mode, setMode] = useState<'select' | 'sequential' | 'all' | 'dismissed'>(
    result.questions.length === 1 ? 'all' : 'select'
  );
  const [answeredCount, setAnsweredCount] = useState(0);
  const [scores, setScores] = useState<boolean[]>([]);

  const handleAnswered = useCallback((correct: boolean) => {
    setScores(prev => [...prev, correct]);
    setAnsweredCount(prev => prev + 1);
  }, []);

  const handleSomethingElse = useCallback(() => {
    setMode('dismissed');
    setTimeout(() => {
      const input = document.querySelector('[role="textbox"][contenteditable="true"]') as HTMLElement;
      if (input) input.focus();
    }, 50);
  }, []);

  const total = result.questions.length;

  // Mode selector
  if (mode === 'select') {
    return (
      <div className="my-1">
        <div className="text-[15px] text-slate-300 leading-relaxed mb-2">{total} questions ready?</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode('sequential')}
            className="px-2.5 py-1 rounded-md text-xs border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm hover:bg-white/[0.08] hover:border-white/[0.15] text-slate-300 hover:text-white transition-colors"
          >
            <span className="font-mono text-[10px] text-slate-500 mr-1">A.</span>
            One by one
          </button>
          <button
            onClick={() => setMode('all')}
            className="px-2.5 py-1 rounded-md text-xs border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm hover:bg-white/[0.08] hover:border-white/[0.15] text-slate-300 hover:text-white transition-colors"
          >
            <span className="font-mono text-[10px] text-slate-500 mr-1">B.</span>
            All at once
          </button>
          <button
            onClick={handleSomethingElse}
            className="px-2.5 py-1 rounded-md text-xs border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm hover:bg-white/[0.08] hover:border-white/[0.15] text-slate-300 hover:text-white transition-colors"
          >
            <span className="font-mono text-[10px] text-slate-500 mr-1">C.</span>
            Something else
          </button>
        </div>
      </div>
    );
  }

  // Dismissed — user chose "Something else"
  if (mode === 'dismissed') {
    return (
      <div className="my-1">
        <div className="text-[15px] text-slate-300 leading-relaxed mb-2">{total} questions ready?</div>
        <div className="flex items-center gap-2">
          <button disabled className="px-2.5 py-1 rounded-md text-xs border border-white/[0.04] bg-white/[0.02] text-slate-600">
            <span className="font-mono text-[10px] text-slate-600 mr-1">A.</span>One by one
          </button>
          <button disabled className="px-2.5 py-1 rounded-md text-xs border border-white/[0.04] bg-white/[0.02] text-slate-600">
            <span className="font-mono text-[10px] text-slate-600 mr-1">B.</span>All at once
          </button>
          <button disabled className="px-2.5 py-1 rounded-md text-xs border border-chalk-accent/20 bg-chalk-accent/5 text-slate-500">
            <span className="font-mono text-[10px] text-slate-500 mr-1">C.</span>Something else
          </button>
        </div>
      </div>
    );
  }

  // All at once
  if (mode === 'all') {
    const allDone = answeredCount >= total;
    const correct = scores.filter(Boolean).length;
    return (
      <div className="space-y-2 my-2">
        {result.questions.map((q, i) => (
          <QuizQuestion key={i} question={q} onSeek={onSeek} onAnswered={handleAnswered} questionNumber={i + 1} total={total} />
        ))}
        {allDone && <QuizSummary correct={correct} total={total} />}
      </div>
    );
  }

  // Sequential mode — questions append like a conversation
  const correct = scores.filter(Boolean).length;
  const allDone = answeredCount >= total;
  const visibleCount = Math.min(answeredCount + 1, total);

  return (
    <div className="space-y-2 my-2">
      {result.questions.slice(0, visibleCount).map((q, i) => (
        <QuizQuestion
          key={i}
          question={q}
          onSeek={onSeek}
          onAnswered={i === answeredCount ? handleAnswered : undefined}
          questionNumber={i + 1}
          total={total}
        />
      ))}
      {allDone && <QuizSummary correct={correct} total={total} />}
    </div>
  );
}

function QuizSummary({ correct, total }: { correct: number; total: number }) {
  const label = correct === total ? 'Perfect score!' : correct >= total * 0.7 ? 'Nice work!' : 'Keep studying!';
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
      <div className="text-[11px] text-slate-500 uppercase tracking-wider font-mono">Quiz Complete</div>
      <div className="text-sm text-slate-200 font-medium">{correct}/{total}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}

function QuizQuestion({
  question: q,
  onSeek,
  onAnswered,
  questionNumber,
  total,
}: {
  question: QuizResult['questions'][0];
  onSeek: (seconds: number) => void;
  onAnswered?: (correct: boolean) => void;
  questionNumber?: number;
  total?: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const cardRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    // On mount, if this is the active question (not yet answered), scroll into view
    if (!selected && onAnswered) {
      setTimeout(() => node.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isAnswered = selected !== null;
  const isCorrect = selected === q.correct_answer;

  // Build shuffled options with minimum 3 (correct + distractors)
  const options = useState(() => {
    const all = [q.correct_answer, ...(q.distractors || [])];
    while (all.length < 3) {
      all.push(all.length === 1 ? 'None of the above' : 'All of the above');
    }
    const unique = [...new Set(all)];
    for (let i = unique.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unique[i], unique[j]] = [unique[j], unique[i]];
    }
    return unique;
  })[0];

  // Keyboard support: A/B/C/D keys select corresponding option
  useEffect(() => {
    if (isAnswered || !onAnswered) return;
    const handler = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable) return;

      const idx = e.key.toUpperCase().charCodeAt(0) - 65;
      if (idx >= 0 && idx < options.length) {
        setSelected(options[idx]);
        onAnswered(options[idx] === q.correct_answer);
        setTimeout(() => setFeedbackVisible(true), 50);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isAnswered, options, q.correct_answer, onAnswered]);

  const handleSelect = (opt: string) => {
    if (isAnswered || !onAnswered) return;
    setSelected(opt);
    onAnswered(opt === q.correct_answer);
    setTimeout(() => setFeedbackVisible(true), 50);
  };

  return (
    <div ref={cardRef} className="p-3 rounded-lg bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] transition-all duration-300">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] text-slate-500 uppercase tracking-wider font-mono">Quiz</span>
        {questionNumber && total && <span className="text-[11px] text-slate-400 font-mono">{questionNumber}/{total}</span>}
        <span className="text-[11px] text-slate-500">({q.difficulty})</span>
        {q.timestamp_seconds !== null && (
          <button
            onClick={() => onSeek(q.timestamp_seconds!)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-mono text-[11px] align-middle bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 hover:text-blue-300 transition-all duration-300 cursor-pointer ml-auto"
          >
            {formatTimestamp(q.timestamp_seconds!)}
          </button>
        )}
      </div>
      <div className="text-sm text-slate-200 mb-3">{q.question}</div>
      <div className="space-y-1.5">
        {options.map((opt, i) => {
          const isThis = selected === opt;
          const isCorrectOpt = opt === q.correct_answer;
          let optClass = 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06] text-slate-300';
          if (isAnswered) {
            if (isCorrectOpt) {
              optClass = 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200';
            } else if (isThis && !isCorrectOpt) {
              optClass = 'bg-red-500/10 border-red-500/30 text-red-300';
            } else {
              optClass = 'bg-white/[0.02] border-white/[0.04] text-slate-500';
            }
          }
          return (
            <button
              key={i}
              onClick={() => handleSelect(opt)}
              disabled={isAnswered}
              className={`w-full text-left px-3 py-2 rounded-md border text-xs transition-all duration-200 ${optClass} ${!isAnswered ? 'cursor-pointer' : ''}`}
            >
              <span className="font-mono text-[10px] text-slate-500 mr-2">{String.fromCharCode(65 + i)}.</span>
              {opt}
            </button>
          );
        })}
      </div>
      <div
        className="overflow-hidden transition-all duration-300 ease-out"
        style={{
          maxHeight: feedbackVisible ? '120px' : '0px',
          opacity: feedbackVisible ? 1 : 0,
          marginTop: feedbackVisible ? '8px' : '0px',
        }}
      >
        <div className="text-xs">
          <span className={isCorrect ? 'text-emerald-400 font-medium' : 'text-red-400/80'}>
            {isCorrect ? 'Correct.' : `Incorrect. The answer is: ${q.correct_answer}`}
          </span>
          {q.explanation && <div className="text-slate-500 mt-1 leading-relaxed">{q.explanation}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * Chapter context card — shows current chapter info and nearby moments.
 */
export function ChapterContextCard({
  result,
  onSeek,
}: {
  result: ChapterContextResult;
  onSeek: (seconds: number) => void;
}) {
  if (!result.chapter && result.moments.length === 0) return null;

  return (
    <div className="p-3 rounded-lg bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] my-2">
      <div className="text-[11px] text-slate-500 uppercase tracking-wider font-mono mb-2">
        Chapter
      </div>
      {result.chapter && (
        <div className="mb-2">
          <button
            onClick={() => onSeek(result.chapter!.start_seconds)}
            className="text-sm font-medium text-slate-200 hover:text-chalk-accent transition-colors"
          >
            {result.chapter.title}
          </button>
          {result.chapter.summary && (
            <div className="text-xs text-slate-400 mt-1">{result.chapter.summary}</div>
          )}
        </div>
      )}
      {result.moments.length > 0 && (
        <div className="space-y-1 mt-2">
          {result.moments.map((m, i) => (
            <button
              key={i}
              onClick={() => onSeek(m.timestamp_seconds)}
              className="flex items-start gap-1.5 w-full text-left text-xs hover:bg-white/[0.04] rounded px-1 py-0.5 transition-colors"
            >
              <span className="text-chalk-accent font-mono flex-shrink-0">
                [{formatTimestamp(m.timestamp_seconds)}]
              </span>
              <span className="text-slate-300 line-clamp-1">{m.content}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Alternative explanations — rich cards with thumbnails, channel, approach, context.
 */
export function AlternativeExplanationsCard({
  result,
  onOpenVideo,
}: {
  result: AlternativeExplanationsResult;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
}) {
  if (result.message || result.alternatives.length === 0) return null;

  // Deduplicate by video_id
  const seen = new Set<string>();
  const unique = result.alternatives.filter(alt => {
    if (seen.has(alt.video_id)) return false;
    seen.add(alt.video_id);
    return true;
  });

  if (unique.length === 0) return null;

  return (
    <div className="my-2 space-y-2">
      <div className="text-[11px] text-slate-500 uppercase tracking-wider font-mono">
        {unique.length === 1 ? 'Different take on' : `${unique.length} other approaches to`} <span className="text-slate-400 normal-case">{result.concept}</span>
      </div>
      {unique.slice(0, 4).map((alt, i) => (
        <div
          key={i}
          onClick={() => onOpenVideo?.(alt.video_id, alt.video_title, alt.channel_name || '', alt.timestamp_seconds)}
          className="flex gap-3 p-2.5 rounded-lg bg-white/[0.03] backdrop-blur-sm hover:bg-white/[0.05] border border-white/[0.06] hover:border-white/[0.10] cursor-pointer transition-all duration-150 group"
        >
          {/* Thumbnail */}
          <div className="flex-shrink-0 w-24 h-[54px] rounded-md overflow-hidden bg-chalk-border/50 relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://i.ytimg.com/vi/${alt.video_id}/mqdefault.jpg`}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <span className="absolute bottom-0.5 right-0.5 bg-black/80 text-white text-[9px] px-0.5 rounded font-mono leading-tight">
              {formatTimestamp(alt.timestamp_seconds)}
            </span>
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <div className="flex items-center gap-2">
              <div className="text-[13px] text-slate-200 leading-tight line-clamp-1 flex-1 min-w-0">{alt.video_title}</div>
              <ChalkIcon size={14} className="text-slate-600 group-hover:text-chalk-accent transition-colors flex-shrink-0" />
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              {alt.channel_name && <span className="text-[11px] text-slate-500">{alt.channel_name}</span>}
              {alt.pedagogical_approach && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-chalk-accent/10 text-chalk-accent/70 border border-chalk-accent/20">
                  {approachLabels[alt.pedagogical_approach] || alt.pedagogical_approach}
                </span>
              )}
            </div>
            {alt.context_snippet && (
              <div className="text-[11px] text-slate-500 leading-snug line-clamp-1 mt-1 italic">&ldquo;{alt.context_snippet}&rdquo;</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Learning path — shows step-by-step concept progression.
 */
export function LearningPathCard({
  result,
  onOpenVideo,
}: {
  result: LearningPathResult;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
}) {
  if (result.steps.length === 0) {
    return (
      <div className="p-3 rounded-lg bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] my-2">
        <div className="text-[11px] text-slate-500 uppercase tracking-wider font-mono mb-2">Learning Path</div>
        <div className="text-xs text-slate-400">
          {result.message || `No direct path found between "${result.from_concept}" and "${result.to_concept}".`}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-lg bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] my-2">
      <div className="text-[11px] text-slate-500 uppercase tracking-wider font-mono mb-2">
        Learning Path
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {result.steps.map((step, i) => (
          <div key={`${step.concept_id}-${i}`} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-500 text-xs">&rsaquo;</span>}
            <button
              onClick={() => {
                if (step.best_video_id && onOpenVideo) {
                  onOpenVideo(step.best_video_id, step.best_video_title || step.display_name, '', undefined);
                }
              }}
              className={`text-xs transition-colors ${
                step.best_video_id
                  ? 'text-chalk-accent hover:underline cursor-pointer'
                  : 'text-slate-300'
              }`}
              title={step.best_video_title || step.display_name}
            >
              {step.display_name}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// === Compact Tool Strip (for conversation history) ===

const DRAWER_TYPES = new Set([
  'reference_video', 'prerequisite_chain', 'quiz',
  'chapter_context', 'alternative_explanations', 'learning_path',
]);

export function isDrawerTool(tc: ToolCallData): boolean {
  if (!DRAWER_TYPES.has(tc.result.type)) return false;
  // Filter out empty results
  const r = tc.result;
  switch (r.type) {
    case 'learning_path': return (r as LearningPathResult).steps.length > 0;
    case 'quiz': return (r as QuizResult).questions.length > 0;
    case 'alternative_explanations': return (r as AlternativeExplanationsResult).alternatives.length > 0;
    case 'prerequisite_chain': return (r as PrerequisiteChainResult).chain.length > 0;
    default: return true;
  }
}

/**
 * Compact strip of mini-cards for tool calls in conversation history.
 */
export function CompactToolStrip({
  toolCalls,
  onSeek,
  onOpenVideo,
}: {
  toolCalls: ToolCallData[];
  onSeek: (seconds: number) => void;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (toolCalls.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {toolCalls.map((tc, i) => {
          const r = tc.result;
          const isExpanded = expandedIndex === i;
          const baseClass = `px-2 py-1 rounded text-[11px] border backdrop-blur-sm transition-all duration-150 cursor-pointer ${
            isExpanded
              ? 'bg-white/[0.08] border-chalk-accent/30 text-slate-200 ring-1 ring-chalk-accent/20'
              : 'bg-white/[0.03] border-white/[0.06] text-slate-400 hover:bg-white/[0.05] hover:text-slate-300'
          }`;

          let label: string | null = null;

          if (r.type === 'reference_video') {
            label = r.video_title.length > 30 ? r.video_title.slice(0, 30) + '...' : r.video_title;
          } else if (r.type === 'quiz') {
            const count = r.questions?.length || 0;
            label = `${count} question${count !== 1 ? 's' : ''}`;
          } else if (r.type === 'prerequisite_chain') {
            label = `${r.chain.length} prerequisite${r.chain.length !== 1 ? 's' : ''}`;
          } else if (r.type === 'chapter_context') {
            label = r.chapter?.title || 'Chapter';
          } else if (r.type === 'alternative_explanations') {
            label = `${r.alternatives.length} alternative${r.alternatives.length !== 1 ? 's' : ''}`;
          } else if (r.type === 'learning_path') {
            const first = r.steps[0]?.display_name || '';
            const last = r.steps[r.steps.length - 1]?.display_name || '';
            label = `${first} \u203A ${last}`;
          } else if (r.type === 'search_results') {
            return null;
          }

          if (!label) return null;

          return (
            <button
              key={i}
              onClick={() => setExpandedIndex(isExpanded ? null : i)}
              className={baseClass}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Expanded card */}
      {expandedIndex !== null && toolCalls[expandedIndex] && (
        <div className="animate-in slide-in-from-top-1 fade-in duration-200">
          <ToolResultRenderer
            toolCall={toolCalls[expandedIndex]}
            onSeek={onSeek}
            onOpenVideo={onOpenVideo}
          />
        </div>
      )}
    </div>
  );
}

// === Registry / Renderer ===

/**
 * Renders a tool result based on its type.
 */
export function ToolResultRenderer({
  toolCall,
  onSeek,
  onOpenVideo,
  currentVideoId,
}: {
  toolCall: ToolCallData;
  onSeek: (seconds: number) => void;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
  currentVideoId?: string;
}) {
  const { result } = toolCall;

  switch (result.type) {
    case 'cite_moment':
      return <CiteMomentCard result={result} onSeek={onSeek} />;
    case 'reference_video':
      return <ReferenceVideoCard result={result} onOpenVideo={onOpenVideo} currentVideoId={currentVideoId} onSeek={onSeek} />;
    case 'prerequisite_chain':
      return <PrerequisiteChainCard result={result} onOpenVideo={onOpenVideo} />;
    case 'quiz':
      return <QuizCard result={result} onSeek={onSeek} />;
    case 'chapter_context':
      return <ChapterContextCard result={result} onSeek={onSeek} />;
    case 'alternative_explanations':
      return <AlternativeExplanationsCard result={result} onOpenVideo={onOpenVideo} />;
    case 'learning_path':
      return <LearningPathCard result={result} onOpenVideo={onOpenVideo} />;
    case 'search_results':
      // Never render search_results in chat — they're internal data for the AI
      return null;
    default:
      return null;
  }
}

/**
 * Parses a stream chunk to separate text and tool results.
 * Tool results are delimited by \x1D (group separator).
 */
export function parseStreamWithToolCalls(fullText: string): {
  text: string;
  toolCalls: ToolCallData[];
} {
  const toolCalls: ToolCallData[] = [];
  let cleanText = '';
  let remaining = fullText;

  while (remaining.length > 0) {
    const startIdx = remaining.indexOf('\x1D');
    if (startIdx === -1) {
      cleanText += remaining;
      break;
    }

    cleanText += remaining.slice(0, startIdx);

    const endIdx = remaining.indexOf('\x1D', startIdx + 1);
    if (endIdx === -1) {
      break;
    }

    const jsonStr = remaining.slice(startIdx + 1, endIdx);
    try {
      const parsed = JSON.parse(jsonStr) as ToolCallData;
      if (parsed.toolName && parsed.result) {
        toolCalls.push(parsed);
      }
    } catch {
      // Malformed JSON, skip
    }

    remaining = remaining.slice(endIdx + 1);
  }

  return { text: cleanText, toolCalls };
}

/**
 * A segment of a parsed stream — either text or a tool call result.
 */
export type StreamSegment =
  | { type: 'text'; content: string }
  | { type: 'tool'; toolCall: ToolCallData };

/**
 * Parses raw stream text into ordered segments of text and tool calls.
 */
export function parseStreamToSegments(rawText: string): StreamSegment[] {
  const segments: StreamSegment[] = [];
  let remaining = rawText;

  while (remaining.length > 0) {
    const startIdx = remaining.indexOf('\x1D');
    if (startIdx === -1) {
      if (remaining.length > 0) {
        segments.push({ type: 'text', content: remaining });
      }
      break;
    }

    if (startIdx > 0) {
      segments.push({ type: 'text', content: remaining.slice(0, startIdx) });
    }

    const endIdx = remaining.indexOf('\x1D', startIdx + 1);
    if (endIdx === -1) {
      break;
    }

    const jsonStr = remaining.slice(startIdx + 1, endIdx);
    try {
      const parsed = JSON.parse(jsonStr) as ToolCallData;
      if (parsed.toolName && parsed.result) {
        segments.push({ type: 'tool', toolCall: parsed });
      }
    } catch {
      // Malformed JSON, skip
    }

    remaining = remaining.slice(endIdx + 1);
  }

  return segments;
}

/**
 * Reorders segments so tool calls never appear before text.
 * Any tool segment that precedes the first text segment is deferred to after it.
 * Once text has started rendering, subsequent tools appear inline in stream order.
 */
export function reorderToolsAfterText(segments: StreamSegment[]): StreamSegment[] {
  const shouldDefer = (seg: StreamSegment) => seg.type === 'tool';

  const result: StreamSegment[] = [];
  const deferred: StreamSegment[] = [];
  let hasRenderedText = false;

  for (const seg of segments) {
    if (shouldDefer(seg) && !hasRenderedText) {
      deferred.push(seg);
    } else {
      if (seg.type === 'text') {
        hasRenderedText = true;
        result.push(seg);
        if (deferred.length > 0) {
          result.push(...deferred);
          deferred.length = 0;
        }
      } else {
        result.push(seg);
      }
    }
  }

  result.push(...deferred);
  return result;
}
