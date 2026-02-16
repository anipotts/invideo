'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { formatTimestamp } from '@/lib/video-utils';
import { type ToolCallData, type ReferenceVideoResult, type CiteMomentResult, type PrerequisiteChainResult, type QuizResult, type AlternativeExplanationsResult, type LearningPathResult, type ToolResult, approachLabels } from './ToolRenderers';
import { ChalkIcon } from './ChalkIcon';
import { CircleNotch, X, CaretDown, CaretRight, ArrowSquareOut } from '@phosphor-icons/react';
import type { UnifiedExchange } from './ExchangeMessage';

// Friendly category names for tool result types
const CATEGORY_LABELS: Record<string, string> = {
  reference_video: 'Videos',
  cite_moment: 'Timestamps',
  prerequisite_chain: 'Foundations',
  quiz: 'Quiz',
  chapter_context: 'Chapter',
  alternative_explanations: 'Other Explanations',
  learning_path: 'Learning Path',
};

function getCategoryLabel(type: string): string {
  return CATEGORY_LABELS[type] || type;
}

// Group tool calls by category
function groupByCategory(calls: ToolCallData[]): Map<string, ToolCallData[]> {
  const groups = new Map<string, ToolCallData[]>();
  for (const tc of calls) {
    const cat = tc.result.type;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(tc);
  }
  return groups;
}

export interface DrawerExchangeGroup {
  exchangeId: string;
  userText: string;
  toolCalls: ToolCallData[];
}

interface KnowledgeDrawerProps {
  /** All accumulated exchange groups with drawer-worthy tool calls */
  exchangeGroups: DrawerExchangeGroup[];
  /** Tool calls from the currently streaming response (not yet committed to an exchange) */
  streamingCalls: ToolCallData[];
  isStreaming: boolean;
  isExtracting?: boolean;
  onSeek: (seconds: number) => void;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
  onClose?: () => void;
  currentVideoId?: string;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2 animate-pulse px-1">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex gap-2.5 p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
          <div className="w-16 h-9 rounded bg-white/[0.06] flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-3/4 rounded bg-white/[0.06]" />
            <div className="h-2 w-1/2 rounded bg-white/[0.04]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Compact horizontal video card for the drawer */
function CompactVideoCard({
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
  const badge = result.relationship
    ? (result.relationship === 'prerequisite' ? 'Prereq'
      : result.relationship === 'follow_up' ? 'Next'
      : result.relationship === 'alternative_explanation' ? 'Alt'
      : result.relationship === 'deeper_dive' ? 'Deep'
      : result.relationship === 'builds_on' ? 'Builds on'
      : result.relationship.charAt(0).toUpperCase() + result.relationship.slice(1))
    : 'Related';

  const handleClick = () => {
    if (currentVideoId && result.video_id === currentVideoId && result.timestamp_seconds != null && onSeek) {
      onSeek(result.timestamp_seconds);
      return;
    }
    onOpenVideo?.(result.video_id, result.video_title, result.channel_name, result.timestamp_seconds ?? undefined);
  };

  return (
    <div
      onClick={handleClick}
      className="group flex gap-2.5 p-2 rounded-lg bg-white/[0.03] backdrop-blur-sm hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] cursor-pointer transition-all duration-150"
    >
      {/* Thumbnail — small horizontal */}
      <div className="flex-shrink-0 w-[72px] aspect-video rounded overflow-hidden bg-chalk-border/50 relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={result.thumbnail_url}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {result.timestamp_seconds !== null && (
          <span className="absolute bottom-0 right-0 bg-black/80 text-white text-[8px] px-0.5 rounded-tl font-mono leading-tight">
            {formatTimestamp(result.timestamp_seconds)}
          </span>
        )}
      </div>

      {/* Text — title + channel + shared concepts */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="text-[12px] text-slate-200 leading-tight line-clamp-2">{result.video_title}</div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[10px] text-slate-500 truncate">{result.channel_name}</span>
          <span className="text-[10px] text-slate-600">&middot;</span>
          <span className="text-[9px] px-1 py-0.5 rounded bg-chalk-accent/8 text-chalk-accent/80">{badge}</span>
        </div>
        {result.shared_concepts && result.shared_concepts.length > 0 && (
          <div className="text-[9px] text-slate-500 truncate mt-0.5">
            {result.shared_concepts.slice(0, 3).join(', ')}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {onOpenVideo && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenVideo(result.video_id, result.video_title, result.channel_name, result.timestamp_seconds ?? undefined);
            }}
            className="group/btn p-1 rounded text-chalk-accent/50 hover:text-chalk-accent hover:bg-chalk-accent/10 transition-colors"
            title="Watch in chalk"
          >
            <ChalkIcon size={13} />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            const url = result.timestamp_seconds
              ? `/watch?v=${result.video_id}&t=${Math.floor(result.timestamp_seconds)}`
              : `/watch?v=${result.video_id}`;
            window.open(url, '_blank');
          }}
          className="p-1 rounded text-slate-600 hover:text-slate-400 hover:bg-white/[0.06] transition-colors"
          title="New tab"
        >
          <ArrowSquareOut size={11} />
        </button>
      </div>
    </div>
  );
}

/** Compact timestamp citation pill for the drawer */
function CompactCitationPill({
  result,
  onSeek,
}: {
  result: CiteMomentResult;
  onSeek: (seconds: number) => void;
}) {
  return (
    <button
      onClick={() => onSeek(result.timestamp_seconds)}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.10] text-slate-300 transition-all duration-150 cursor-pointer"
      title={result.context}
    >
      <span className="font-mono text-[10px] text-chalk-accent">[{result.timestamp}]</span>
      <span className="text-[11px] text-slate-300 truncate max-w-[180px]">{result.label}</span>
    </button>
  );
}

/** Type-safe summary for generic tool results */
function DrawerResultSummary({ result }: { result: ToolResult }) {
  switch (result.type) {
    case 'chapter_context':
      return <span>Chapter: {result.chapter?.title || 'Context'}</span>;
    default:
      return null;
  }
}

/** Expanded prerequisite chain display */
function DrawerPrerequisiteList({
  result,
  onOpenVideo,
}: {
  result: PrerequisiteChainResult;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = result.chain;
  const visible = expanded ? items : items.slice(0, 5);
  const remaining = items.length - 5;

  if (items.length === 0) {
    return <span className="text-[11px] text-slate-500">{result.message || 'No prerequisites found'}</span>;
  }

  // Group by depth for tree rendering
  const byDepth = new Map<number, typeof items>();
  for (const item of visible) {
    if (!byDepth.has(item.depth)) byDepth.set(item.depth, []);
    byDepth.get(item.depth)!.push(item);
  }
  const sortedDepths = [...byDepth.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <div className="space-y-0.5">
      {sortedDepths.map(([depth, depthItems]) => (
        <div key={depth} className="relative" style={{ paddingLeft: `${(depth - 1) * 12}px` }}>
          {depth > 1 && (
            <div className="absolute left-0 top-0 bottom-0 border-l border-chalk-accent/15" style={{ left: `${(depth - 2) * 12 + 5}px` }} />
          )}
          {depthItems.map((item, j) => {
            const hasVideo = item.best_video_id && item.best_video_title;
            return (
              <div
                key={`${item.concept_id}-${j}`}
                className={`flex items-start gap-2 py-1.5 px-2 rounded-md backdrop-blur-sm ${hasVideo ? 'cursor-pointer hover:bg-white/[0.06]' : ''} transition-all duration-150 relative`}
                onClick={() => hasVideo && onOpenVideo?.(item.best_video_id!, item.best_video_title!, '', undefined)}
              >
                {depth > 1 && (
                  <div className="absolute border-t border-chalk-accent/15" style={{ left: '-7px', top: '12px', width: '7px' }} />
                )}
                <span className="text-[8px] font-mono text-chalk-accent/50 bg-chalk-accent/8 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  {depth}
                </span>
                <div className="flex-1 min-w-0">
                  <span className={`text-[11px] ${hasVideo ? 'text-chalk-accent' : 'text-slate-300'} leading-tight`}>
                    {item.display_name}
                  </span>
                  {hasVideo && (
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">{item.best_video_title}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {remaining > 0 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[10px] text-chalk-accent/70 hover:text-chalk-accent px-2 py-1 transition-colors"
        >
          +{remaining} more
        </button>
      )}
    </div>
  );
}

/** Expanded quiz summary display */
function DrawerQuizSummary({
  result,
  onSeek,
}: {
  result: QuizResult;
  onSeek: (seconds: number) => void;
}) {
  if (result.questions.length === 0) {
    return <span className="text-[11px] text-slate-500">{result.message || 'No quiz questions'}</span>;
  }

  // Difficulty breakdown
  const counts = { easy: 0, medium: 0, hard: 0 } as Record<string, number>;
  for (const q of result.questions) counts[q.difficulty] = (counts[q.difficulty] || 0) + 1;
  const diffParts = Object.entries(counts).filter(([, c]) => c > 0);

  return (
    <div className="space-y-1.5">
      {/* Summary header */}
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="text-[11px] text-slate-300">{result.questions.length}q</span>
        <div className="flex items-center gap-1">
          {diffParts.map(([d, c]) => (
            <span key={d} className={`text-[9px] px-1 py-0.5 rounded ${
              d === 'easy' ? 'bg-green-500/10 text-green-400' :
              d === 'hard' ? 'bg-red-500/10 text-red-400' :
              'bg-yellow-500/10 text-yellow-400'
            }`}>{c} {d}</span>
          ))}
        </div>
      </div>
      {result.questions.map((q, i) => (
        <div
          key={i}
          className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-white/[0.03] backdrop-blur-sm border border-white/[0.06]"
        >
          <span className="text-[9px] font-mono text-slate-500 flex-shrink-0 mt-0.5">Q{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-slate-300 leading-tight line-clamp-2">{q.question}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {q.concept && <span className="text-[9px] text-slate-500 truncate max-w-[120px]">{q.concept}</span>}
              {q.timestamp_seconds !== null && (
                <button
                  onClick={() => onSeek(q.timestamp_seconds!)}
                  className="text-[9px] font-mono text-chalk-accent/60 hover:text-chalk-accent transition-colors"
                >
                  [{formatTimestamp(q.timestamp_seconds!)}]
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Expanded alternative explanations display */
function DrawerAlternativesList({
  result,
  onOpenVideo,
}: {
  result: AlternativeExplanationsResult;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
}) {
  if (result.alternatives.length === 0) {
    return <span className="text-[11px] text-slate-500">{result.message || 'No alternatives found'}</span>;
  }

  return (
    <div className="space-y-1">
      {/* Concept header */}
      {result.concept && (
        <div className="px-2 py-0.5 text-[10px] text-slate-400">
          {result.alternatives.length} explanation{result.alternatives.length !== 1 ? 's' : ''} for <span className="text-slate-300">{result.concept}</span>
        </div>
      )}
      {result.alternatives.slice(0, 5).map((alt, i) => (
        <div
          key={`${alt.video_id}-${i}`}
          className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] cursor-pointer hover:bg-white/[0.06] hover:border-white/[0.10] transition-all duration-150"
          onClick={() => onOpenVideo?.(alt.video_id, alt.video_title, alt.channel_name || '', alt.timestamp_seconds)}
        >
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-chalk-accent leading-tight truncate">{alt.video_title}</div>
            <div className="flex items-center gap-1 mt-0.5">
              {alt.channel_name && <span className="text-[10px] text-slate-500 truncate">{alt.channel_name}</span>}
              {alt.pedagogical_approach && (
                <>
                  {alt.channel_name && <span className="text-[10px] text-slate-600">&middot;</span>}
                  <span className="text-[9px] px-1 py-0.5 rounded bg-white/[0.04] text-slate-400 italic">{approachLabels[alt.pedagogical_approach] || alt.pedagogical_approach.replace(/_/g, ' ')}</span>
                </>
              )}
            </div>
            {alt.context_snippet && (
              <div className="text-[10px] text-slate-500 leading-snug line-clamp-1 mt-0.5">{alt.context_snippet}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Expanded learning path display */
function DrawerLearningPath({
  result,
  onOpenVideo,
}: {
  result: LearningPathResult;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
}) {
  if (result.steps.length === 0) {
    return <span className="text-[11px] text-slate-500">{result.message || `No path from "${result.from_concept}" to "${result.to_concept}"`}</span>;
  }

  return (
    <div className="space-y-0.5">
      {/* Path summary header */}
      <div className="px-2 py-0.5 text-[10px] text-slate-400">
        {result.steps.length} step{result.steps.length !== 1 ? 's' : ''}: <span className="text-slate-300">{result.from_concept}</span> &rarr; <span className="text-slate-300">{result.to_concept}</span>
      </div>
      {result.steps.map((step, i) => {
        const hasVideo = step.best_video_id && step.best_video_title;
        return (
          <div key={`${step.concept_id}-${i}`}>
            {i > 0 && (
              <div className="flex items-center pl-3 py-0.5">
                <span className="text-[10px] text-slate-600">&darr;</span>
              </div>
            )}
            <div
              className={`flex items-start gap-2 px-2 py-1.5 rounded-md backdrop-blur-sm ${hasVideo ? 'cursor-pointer hover:bg-white/[0.06]' : ''} transition-all duration-150`}
              onClick={() => hasVideo && onOpenVideo?.(step.best_video_id!, step.best_video_title!, '', undefined)}
            >
              <span className="text-[8px] font-mono text-chalk-accent/60 bg-chalk-accent/10 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                {step.step + 1}
              </span>
              <div className="flex-1 min-w-0">
                <span className={`text-[11px] ${hasVideo ? 'text-chalk-accent' : 'text-slate-300'} leading-tight`}>
                  {step.display_name}
                </span>
                {hasVideo && (
                  <div className="text-[10px] text-slate-500 truncate mt-0.5">{step.best_video_title}</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Build a compact preview string for a set of tool calls */
function buildCollapsedPreview(calls: ToolCallData[]): React.ReactNode[] {
  const previews: React.ReactNode[] = [];
  const cats = new Map<string, ToolCallData[]>();
  for (const tc of calls) {
    const cat = tc.result.type;
    if (!cats.has(cat)) cats.set(cat, []);
    cats.get(cat)!.push(tc);
  }

  for (const [cat, items] of cats) {
    switch (cat) {
      case 'reference_video': {
        const vids = items.map(tc => tc.result as ReferenceVideoResult);
        // Show first thumbnail + count
        previews.push(
          <div key="vid" className="flex items-center gap-1.5">
            <div className="flex -space-x-2">
              {vids.slice(0, 3).map((v, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={v.thumbnail_url}
                  alt=""
                  className="w-6 h-4 rounded-sm object-cover border border-black/40"
                />
              ))}
            </div>
            <span className="text-[10px] text-slate-400">
              {vids.length} video{vids.length !== 1 ? 's' : ''}
            </span>
          </div>
        );
        break;
      }
      case 'quiz': {
        const q = items[0].result as QuizResult;
        const n = q.questions.length;
        const diffs = { easy: 0, medium: 0, hard: 0 } as Record<string, number>;
        for (const qq of q.questions) diffs[qq.difficulty] = (diffs[qq.difficulty] || 0) + 1;
        const parts = Object.entries(diffs).filter(([, c]) => c > 0);
        previews.push(
          <div key="quiz" className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400">{n}q</span>
            {parts.map(([d, c]) => (
              <span key={d} className={`text-[9px] px-1 py-0.5 rounded ${
                d === 'easy' ? 'bg-green-500/10 text-green-400/80' :
                d === 'hard' ? 'bg-red-500/10 text-red-400/80' :
                'bg-yellow-500/10 text-yellow-400/80'
              }`}>{c}</span>
            ))}
          </div>
        );
        break;
      }
      case 'alternative_explanations': {
        const alt = items[0].result as AlternativeExplanationsResult;
        const approaches = alt.alternatives
          .map(a => a.pedagogical_approach ? (approachLabels[a.pedagogical_approach] || a.pedagogical_approach) : null)
          .filter(Boolean);
        previews.push(
          <div key="alt" className="flex items-center gap-1">
            <span className="text-[10px] text-slate-400">{alt.alternatives.length} alt{alt.alternatives.length !== 1 ? 's' : ''}</span>
            {approaches.slice(0, 3).map((a, i) => (
              <span key={i} className="text-[9px] px-1 py-0.5 rounded bg-white/[0.04] text-slate-500">{a}</span>
            ))}
          </div>
        );
        break;
      }
      case 'learning_path': {
        const lp = items[0].result as LearningPathResult;
        if (lp.steps.length > 0) {
          const first = lp.steps[0].display_name;
          const last = lp.steps[lp.steps.length - 1].display_name;
          previews.push(
            <div key="path" className="flex items-center gap-1">
              <span className="text-[10px] text-chalk-accent/70 truncate max-w-[80px]">{first}</span>
              <span className="text-[10px] text-slate-600">&rarr;</span>
              <span className="text-[10px] text-chalk-accent/70 truncate max-w-[80px]">{last}</span>
              <span className="text-[9px] text-slate-500">({lp.steps.length})</span>
            </div>
          );
        } else {
          previews.push(
            <span key="path" className="text-[10px] text-slate-500">No path</span>
          );
        }
        break;
      }
      case 'prerequisite_chain': {
        const pc = items[0].result as PrerequisiteChainResult;
        previews.push(
          <span key="prereq" className="text-[10px] text-slate-400">
            {pc.chain.length} prereq{pc.chain.length !== 1 ? 's' : ''}
          </span>
        );
        break;
      }
      case 'cite_moment': {
        const cites = items.map(tc => tc.result as CiteMomentResult);
        previews.push(
          <div key="cite" className="flex items-center gap-1">
            {cites.slice(0, 3).map((c, i) => (
              <span key={i} className="text-[9px] font-mono text-chalk-accent/60">[{c.timestamp}]</span>
            ))}
            {cites.length > 3 && <span className="text-[9px] text-slate-500">+{cites.length - 3}</span>}
          </div>
        );
        break;
      }
    }
  }
  return previews;
}

/** Collapsible exchange group */
function ExchangeGroup({
  group,
  index,
  isStreaming,
  onSeek,
  onOpenVideo,
  defaultOpen,
  currentVideoId,
}: {
  group: DrawerExchangeGroup;
  index: number;
  isStreaming: boolean;
  onSeek: (seconds: number) => void;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
  defaultOpen: boolean;
  currentVideoId?: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const categories = useMemo(() => groupByCategory(group.toolCalls), [group.toolCalls]);
  const collapsedPreviews = useMemo(() => buildCollapsedPreview(group.toolCalls), [group.toolCalls]);

  const truncatedQuestion = group.userText.length > 45
    ? group.userText.slice(0, 45) + '...'
    : group.userText;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.25,
        delay: isStreaming ? 0.1 + index * 0.05 : 0.1 + Math.min(index * 0.04, 0.2),
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      {/* Exchange header — clickable to collapse */}
      <button
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex flex-col gap-1 px-2 py-2 text-left hover:bg-white/[0.03] rounded-lg transition-colors"
      >
        <div className="flex items-center gap-1.5 w-full">
          {isOpen
            ? <CaretDown size={10} className="text-slate-500 flex-shrink-0" />
            : <CaretRight size={10} className="text-slate-500 flex-shrink-0" />
          }
          <span className="text-[11px] text-slate-300 truncate flex-1">{truncatedQuestion}</span>
        </div>
        {/* Collapsed preview — type-specific compact summaries */}
        {!isOpen && collapsedPreviews.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-4">
            {collapsedPreviews}
          </div>
        )}
      </button>

      {/* Collapsible body */}
      {isOpen && (
        <div className="pl-3 space-y-2 pb-2">
          {Array.from(categories.entries()).map(([cat, calls], catIndex) => (
            <div key={cat}>
              {catIndex > 0 && <div className="h-px bg-white/[0.06] my-2" />}
              {/* Category label */}
              {categories.size > 1 && (
                <div className="text-[10px] uppercase tracking-wider font-mono text-slate-600 mb-1 px-1">
                  {getCategoryLabel(cat)}
                </div>
              )}

              {/* Cards by type */}
              {cat === 'reference_video' && (
                <div className="space-y-1.5">
                  {calls.map((tc, j) => (
                    <CompactVideoCard
                      key={`${group.exchangeId}-vid-${j}`}
                      result={tc.result as ReferenceVideoResult}
                      onOpenVideo={onOpenVideo}
                      currentVideoId={currentVideoId}
                      onSeek={onSeek}
                    />
                  ))}
                </div>
              )}

              {cat === 'cite_moment' && (
                <div className="flex flex-wrap gap-1">
                  {calls.map((tc, j) => (
                    <CompactCitationPill
                      key={`${group.exchangeId}-cite-${j}`}
                      result={tc.result as CiteMomentResult}
                      onSeek={onSeek}
                    />
                  ))}
                </div>
              )}

              {/* Prerequisite chain */}
              {cat === 'prerequisite_chain' && calls.map((tc, j) => (
                <DrawerPrerequisiteList
                  key={`${group.exchangeId}-prereq-${j}`}
                  result={tc.result as PrerequisiteChainResult}
                  onOpenVideo={onOpenVideo}
                />
              ))}

              {/* Quiz questions */}
              {cat === 'quiz' && calls.map((tc, j) => (
                <DrawerQuizSummary
                  key={`${group.exchangeId}-quiz-${j}`}
                  result={tc.result as QuizResult}
                  onSeek={onSeek}
                />
              ))}

              {/* Alternative explanations */}
              {cat === 'alternative_explanations' && calls.map((tc, j) => (
                <DrawerAlternativesList
                  key={`${group.exchangeId}-alt-${j}`}
                  result={tc.result as AlternativeExplanationsResult}
                  onOpenVideo={onOpenVideo}
                />
              ))}

              {/* Learning path */}
              {cat === 'learning_path' && calls.map((tc, j) => (
                <DrawerLearningPath
                  key={`${group.exchangeId}-path-${j}`}
                  result={tc.result as LearningPathResult}
                  onOpenVideo={onOpenVideo}
                />
              ))}

              {/* Generic fallback for remaining types */}
              {cat !== 'reference_video' && cat !== 'cite_moment' && cat !== 'prerequisite_chain' && cat !== 'quiz' && cat !== 'alternative_explanations' && cat !== 'learning_path' && (
                <div className="space-y-1">
                  {calls.map((tc, j) => (
                    <div
                      key={`${group.exchangeId}-${cat}-${j}`}
                      className="px-2 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06] text-[11px] text-slate-400"
                    >
                      <DrawerResultSummary result={tc.result} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function KnowledgeDrawer({
  exchangeGroups,
  streamingCalls,
  isStreaming,
  isExtracting,
  onSeek,
  onOpenVideo,
  onClose,
  currentVideoId,
}: KnowledgeDrawerProps) {
  const totalCount = exchangeGroups.reduce((sum, g) => sum + g.toolCalls.length, 0) + streamingCalls.length;
  const isEmpty = totalCount === 0 && !isStreaming;

  // Staggered entrance after panel width transition completes
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setEntered(true), 180);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="w-full h-full flex flex-col pointer-events-auto">
      {/* Header — matches InVideoPanel structure */}
      <div
        className="flex-none flex items-center gap-2 px-3 pt-3 pb-2 transition-all duration-200 ease-out"
        style={{ opacity: entered ? 1 : 0, transform: entered ? 'translateY(0)' : 'translateY(4px)' }}
      >
        <span className="text-[11px] uppercase tracking-wider font-mono text-slate-500">Artifacts</span>
        {totalCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-slate-400 font-mono">
            {totalCount}
          </span>
        )}
        <div className="flex-1" />
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
            title="Close panel"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Scrollable body */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] transition-opacity duration-200 ease-out"
        style={{ opacity: entered ? 1 : 0, transitionDelay: '60ms' }}
      >
        {isStreaming && totalCount === 0 && <LoadingSkeleton />}

        {isEmpty && isExtracting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-8 text-center"
          >
            <CircleNotch size={20} className="text-chalk-accent animate-spin mb-2" />
            <span className="text-xs text-slate-400">Building knowledge graph...</span>
            <span className="text-[10px] text-slate-500 mt-1">This runs in the background</span>
          </motion.div>
        )}

        {isEmpty && !isExtracting && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span className="text-xs text-slate-500">Ask a question to see related content</span>
          </div>
        )}

        {/* Accumulated exchange groups — capped to last 5 */}
        {exchangeGroups.length > 5 && (
          <div className="text-[10px] text-slate-600 font-mono px-1 py-1.5">
            {exchangeGroups.length - 5} earlier {exchangeGroups.length - 5 === 1 ? 'result' : 'results'}
          </div>
        )}
        {exchangeGroups.slice(-5).map((group, i) => (
          <ExchangeGroup
            key={group.exchangeId}
            group={group}
            index={i}
            isStreaming={false}
            onSeek={onSeek}
            onOpenVideo={onOpenVideo}
            defaultOpen={i === Math.min(exchangeGroups.length, 5) - 1 && streamingCalls.length === 0}
            currentVideoId={currentVideoId}
          />
        ))}

        {/* Currently streaming tool calls (not yet committed to an exchange) */}
        {streamingCalls.length > 0 && (
          <ExchangeGroup
            group={{
              exchangeId: '__streaming__',
              userText: 'Responding...',
              toolCalls: streamingCalls,
            }}
            index={exchangeGroups.length}
            isStreaming={true}
            onSeek={onSeek}
            onOpenVideo={onOpenVideo}
            defaultOpen={true}
            currentVideoId={currentVideoId}
          />
        )}
      </div>
    </div>
  );
}
