'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { formatTimestamp } from '@/lib/video-utils';
import { type ToolCallData, type ReferenceVideoResult, type CiteMomentResult, type ToolResult } from './ToolRenderers';
import { ChalkIcon } from './ChalkIcon';
import { CircleNotch, X, CaretDown, CaretRight, ArrowSquareOut } from '@phosphor-icons/react';
import type { UnifiedExchange } from './ExchangeMessage';

// Friendly category names for tool result types
const CATEGORY_LABELS: Record<string, string> = {
  reference_video: 'Videos',
  cite_moment: 'Timestamps',
  search_results: 'Search',
  prerequisite_chain: 'Prerequisites',
  quiz: 'Quiz',
  chapter_context: 'Chapter',
  alternative_explanations: 'Alternatives',
  learning_path: 'Path',
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
}: {
  result: ReferenceVideoResult;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
}) {
  const badge = result.relationship
    ? (result.relationship === 'prerequisite' ? 'Prereq'
      : result.relationship === 'follow_up' ? 'Next'
      : result.relationship === 'alternative_explanation' ? 'Alt'
      : result.relationship === 'deeper_dive' ? 'Deep'
      : result.relationship === 'builds_on' ? 'Builds on'
      : result.relationship.charAt(0).toUpperCase() + result.relationship.slice(1))
    : 'Related';

  return (
    <div
      onClick={() => onOpenVideo?.(result.video_id, result.video_title, result.channel_name, result.timestamp_seconds ?? undefined)}
      className="group flex gap-2.5 p-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] cursor-pointer transition-all duration-150"
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

      {/* Text — title + channel */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="text-[12px] text-slate-200 leading-tight line-clamp-2">{result.video_title}</div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[10px] text-slate-500 truncate">{result.channel_name}</span>
          <span className="text-[10px] text-slate-600">&middot;</span>
          <span className="text-[10px] text-chalk-accent/70">{badge}</span>
        </div>
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

/** Type-safe summary for non-cite, non-video tool results */
function DrawerResultSummary({ result }: { result: ToolResult }) {
  switch (result.type) {
    case 'search_results':
      return <span>Searched: <span className="text-slate-300">{result.query}</span></span>;
    case 'prerequisite_chain':
      return <span>{result.chain.length} prerequisites</span>;
    case 'quiz':
      return <span>{result.questions.length} questions</span>;
    case 'chapter_context':
      return <span>Chapter: {result.chapter?.title || 'Context'}</span>;
    case 'alternative_explanations':
      return <span>{result.alternatives.length} alternatives</span>;
    case 'learning_path':
      return <span>{result.steps.length} steps</span>;
    default:
      return null;
  }
}

/** Collapsible exchange group */
function ExchangeGroup({
  group,
  index,
  isStreaming,
  onSeek,
  onOpenVideo,
  defaultOpen,
}: {
  group: DrawerExchangeGroup;
  index: number;
  isStreaming: boolean;
  onSeek: (seconds: number) => void;
  onOpenVideo?: (videoId: string, title: string, channelName: string, seekTo?: number) => void;
  defaultOpen: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const categories = useMemo(() => groupByCategory(group.toolCalls), [group.toolCalls]);

  const truncatedQuestion = group.userText.length > 50
    ? group.userText.slice(0, 50) + '...'
    : group.userText;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.2,
        delay: isStreaming ? index * 0.05 : Math.min(index * 0.03, 0.15),
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      {/* Exchange header — clickable to collapse */}
      <button
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-1 py-1.5 text-left hover:bg-white/[0.02] rounded transition-colors"
      >
        {isOpen
          ? <CaretDown size={10} className="text-slate-500 flex-shrink-0" />
          : <CaretRight size={10} className="text-slate-500 flex-shrink-0" />
        }
        <span className="text-[11px] text-slate-400 truncate flex-1">{truncatedQuestion}</span>
        <span className="text-[10px] text-slate-600 font-mono flex-shrink-0">{group.toolCalls.length}</span>
      </button>

      {/* Collapsible body */}
      {isOpen && (
        <div className="pl-3 space-y-2 pb-2">
          {Array.from(categories.entries()).map(([cat, calls]) => (
            <div key={cat}>
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

              {/* Generic fallback for other types */}
              {cat !== 'reference_video' && cat !== 'cite_moment' && (
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
}: KnowledgeDrawerProps) {
  const totalCount = exchangeGroups.reduce((sum, g) => sum + g.toolCalls.length, 0) + streamingCalls.length;
  const isEmpty = totalCount === 0 && !isStreaming;

  return (
    <div className="w-full h-full flex flex-col pointer-events-auto">
      {/* Header — matches InVideoPanel structure */}
      <div className="flex-none flex items-center gap-2 px-3 pt-3 pb-2">
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
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
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
          />
        )}
      </div>
    </div>
  );
}
