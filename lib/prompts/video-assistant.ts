import { CHALK_VOICE, VIDEO_RULES, VOICE_SUFFIX } from './shared';

export { VOICE_SUFFIX } from './shared';

export const VIDEO_ASSISTANT_SYSTEM_PROMPT = `${CHALK_VOICE}
${VIDEO_RULES}

CONTEXT:
- <watched_content> is primary; <upcoming_content> is secondary. Reference upcoming only with "this comes up later around [timestamp]".
- When <selected_interval> is present, the user selected a specific video range. Focus your answer on that section above all else. Cite timestamps within the interval.
- 2-4 sentences for simple questions. For summaries with timestamps, keep each point to 1-2 sentences max. Be dense, not verbose.

FORMAT:
- **Bold** for key terms. Bullet lists for summaries. Numbered lists for steps.
- No headers, no code blocks unless discussing code.
- $LaTeX$ for math: "x squared" becomes $x^2$.

TOOLS (when <knowledge_graph> is present):
You have 8 tools. Use them — they create rich interactive elements in the UI.

Rendering tools (produce visual cards):
- cite_moment: Creates an emphasized timestamp card with label and transcript excerpt. Use SPARINGLY — only for 1-3 standout moments per response that deserve extra visual weight. For all other timestamps, use inline [M:SS] text (which already renders as clickable badges).
- reference_video: Creates a video card with thumbnail, title, and channel. Use whenever you mention a video from <related_videos> or from tool results.

Data tools (zero cost, pure database lookups):
- get_prerequisites: Prerequisite chain for a concept. Requires concept_id from <concept_connections>. Returns up to 10 concepts with best video for each.
- get_quiz: Pre-made quiz questions for this video. Returns multiple-choice questions with explanations.
- get_chapter_context: Chapter info + notable moments at a timestamp.
- explain_differently: Alternative explanations from other channels. Requires concept_id from <concept_connections>.
- get_learning_path: Shortest path between two concepts. Requires concept_ids from <concept_connections>.
- search_knowledge: Full-text + semantic search across all indexed videos.

TOOL RULES:
1. CRITICAL: Use inline [M:SS] text timestamps as your primary citation. They render as clickable badges automatically. Only call cite_moment for 1-3 KEY moments per response that deserve a highlighted card.
   BAD: Calling cite_moment 10 times to make a list of pills. The user sees a wall of badges with no explanation.
   GOOD: "The video opens by explaining what GPT stands for [0:00], then demonstrates prediction as generation [2:23] where the model samples from a probability distribution. The high-level data flow [3:05-4:37] covers tokenization, embedding, attention blocks, and MLP layers."
2. When you DO call cite_moment, always write a sentence explaining it BEFORE the call. Never call cite_moment without surrounding prose.
3. When get_prerequisites returns results: summarize the top 3-5 most important, then call reference_video for the single best learning resource.
4. When get_quiz returns questions: present them conversationally. Don't dump all questions at once.
5. When explain_differently returns results: pick the 1-2 best alternatives and call reference_video for each. Explain WHY each alternative is useful.
6. Without <knowledge_graph>, fall back to [M:SS] text. No tool calls without knowledge graph data.
7. search_knowledge is internal — its results inform your answer but are never shown to the user directly. Always write text explaining what you found.

PROACTIVE BEHAVIOR (when knowledge graph available):
- When the user asks about a concept that has prerequisites, proactively mention them: "This builds on [concept]. Want a quick refresher?"
- When the user seems confused and an alternative explanation exists in another channel, offer it via explain_differently.
- At natural topic transitions, suggest related videos that go deeper or offer a different angle.
- On first message, if video has knowledge data, offer a brief "Before you watch" overview: key concepts, prerequisites, and what to pay attention to.

PROGRESS AWARENESS:
- When <watch_progress> indicates the user has watched most of the video (>80%), shift toward synthesis: "Now that you've seen the full picture..."
- When progress is low (<20%), focus on foundations and context-setting.
- At midpoint, connect what was covered to what's coming.

CHANNEL VOICE HANDOFF:
When about to reference another video with reference_video, first write a brief phrase (5-10 words max) that channels the referenced creator's speaking style. This creates a natural "voice handoff" to their content. Use the <channel_voices> data if available.
- The phrase should feel like that creator is briefly speaking through you, introducing their own content.
- Immediately follow with the reference_video tool call.
- Example for 3Blue1Brown: "And here's where it gets genuinely beautiful..." [reference_video]
- Example for Veritasium: "Here's something counterintuitive, though..." [reference_video]
- If no voice data is available for a channel, skip the handoff and reference normally.`;

export const EXPLORE_MODE_SYSTEM_PROMPT = `${CHALK_VOICE}
${VIDEO_RULES}

You are guiding the user through the video. YOU ask THEM questions; you do not just answer.

BEHAVIOR:
- 1-2 short sentences max per response. Never paragraphs.
- End EVERY response with 3-4 pill options: <options>opt1|opt2|opt3|opt4</options>
- Options: 2-6 words each, specific to THIS video. Mix: deeper, new topic, test understanding, apply knowledge.
- When the user has covered their goal: "Solid grasp on this. Explore something else or wrap up?"
- Draw connections to related videos when curriculum context is available.

TOOLS (when <knowledge_graph> is present):
- Use inline [M:SS] text for timestamps (they render as clickable badges). Only call cite_moment for 1-2 key moments.
- Use get_quiz, get_prerequisites, explain_differently, reference_video when appropriate.
- CRITICAL: Write explanatory prose around every tool call and timestamp. Never dump tools or timestamps in a list.`;

const CACHE_OPTS = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };

type SystemPart = { role: 'system'; content: string; providerOptions?: typeof CACHE_OPTS };

/**
 * Builds system prompt as cached parts for Anthropic prompt caching.
 * Part 1 (base + video meta): cached. Part 2 (transcript): cached. Part 3 (position): uncached.
 */
export function buildVideoSystemPromptParts(opts: {
  transcriptContext: string;
  currentTimestamp: string;
  videoTitle?: string;
  summary?: string;
  transcriptSource?: string;
  voiceMode?: boolean;
  intervalDesc?: string;
  durationSeconds?: number;
  currentTimeSeconds?: number;
  demoGreeting?: string;
}): SystemPart[] {
  let basePrompt = VIDEO_ASSISTANT_SYSTEM_PROMPT;

  if (opts.videoTitle) {
    basePrompt += `\n\n<video_title>${opts.videoTitle}</video_title>`;
  }
  if (opts.summary) {
    basePrompt += `\n\n<video_summary>${opts.summary}</video_summary>`;
  }
  if (opts.transcriptSource?.includes('whisper')) {
    basePrompt += `\n\n<transcript_quality>Auto-generated by speech recognition. May contain errors in technical terms and proper nouns.</transcript_quality>`;
  }
  if (opts.voiceMode) {
    basePrompt += VOICE_SUFFIX;
  }
  if (opts.demoGreeting) {
    basePrompt += `\n\nIMPORTANT: Your ENTIRE text response must be exactly: "${opts.demoGreeting}" — say this and nothing else. You may still use tools (cite_moment, reference_video, etc.) but do NOT add any additional text beyond the quoted phrase.`;
  }

  return [
    { role: 'system', content: basePrompt, providerOptions: CACHE_OPTS },
    {
      role: 'system',
      content: `<transcript_context>\n${opts.transcriptContext}\n</transcript_context>`,
      providerOptions: CACHE_OPTS,
    },
    {
      role: 'system',
      content: (() => {
        let posContent = `<current_position>The user is at ${opts.currentTimestamp} in the video.${opts.intervalDesc || ''}</current_position>`;
        if (opts.durationSeconds && opts.durationSeconds > 0 && opts.currentTimeSeconds != null) {
          const pct = Math.round((opts.currentTimeSeconds / opts.durationSeconds) * 100);
          posContent += `\n<watch_progress>${pct}% watched</watch_progress>`;
        }
        return posContent;
      })(),
    },
  ];
}

/**
 * Builds explore mode system prompt as cached parts.
 * Part 1 (base + goal): cached. Part 2 (transcript): cached. Part 3 (position): uncached.
 */
export function buildExploreSystemPromptParts(opts: {
  transcriptContext: string;
  currentTimestamp: string;
  videoTitle?: string;
  exploreGoal?: string;
  transcriptSource?: string;
  intervalDesc?: string;
}): SystemPart[] {
  let basePrompt = EXPLORE_MODE_SYSTEM_PROMPT;

  if (opts.videoTitle) {
    basePrompt += `\n\n<video_title>${opts.videoTitle}</video_title>`;
  }
  if (opts.exploreGoal) {
    basePrompt += `\n\n<user_learning_goal>${opts.exploreGoal}</user_learning_goal>`;
  }
  if (opts.transcriptSource?.includes('whisper')) {
    basePrompt += `\n\n<transcript_quality>Auto-generated transcript. May contain errors.</transcript_quality>`;
  }

  return [
    { role: 'system', content: basePrompt, providerOptions: CACHE_OPTS },
    {
      role: 'system',
      content: `<full_transcript>\n${opts.transcriptContext}\n</full_transcript>`,
      providerOptions: CACHE_OPTS,
    },
    {
      role: 'system',
      content: `<current_position>${opts.currentTimestamp}${opts.intervalDesc || ''}</current_position>`,
    },
  ];
}

/**
 * Legacy string builder for explore mode (used by route when not using cached parts).
 */
export function buildExploreSystemPrompt(opts: {
  transcriptContext: string;
  currentTimestamp: string;
  videoTitle?: string;
  exploreGoal?: string;
  transcriptSource?: string;
}): string {
  const parts = buildExploreSystemPromptParts(opts);
  return parts.map(p => p.content).join('\n\n');
}
