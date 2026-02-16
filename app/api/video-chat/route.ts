import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { buildVideoSystemPromptParts, buildExploreSystemPromptParts } from '@/lib/prompts/video-assistant';
import { PERSONALITY_MODIFIERS } from '@/lib/prompts/shared';
import { formatTimestamp, type TranscriptSegment } from '@/lib/video-utils';
import { createVideoTools } from '@/lib/tools/video-tools';
import { buildKnowledgeGraphPromptContext } from '@/lib/knowledge-graph-context';
import type { KnowledgeContext } from '@/app/api/knowledge-context/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { message, currentTimestamp, segments, history, videoTitle, personality, transcriptSource, voiceMode, exploreMode, exploreGoal, modelChoice, thinkingBudget, curriculumContext, videoId, knowledgeContext, intervalSelection, demoGreeting } = body;

  if (!message || typeof message !== 'string') {
    return Response.json({ error: 'Missing message' }, { status: 400 });
  }

  if (message.length > 2000) {
    return Response.json({ error: 'Message too long (max 2000 characters)' }, { status: 400 });
  }

  // Validate segments array structure
  if (segments && !Array.isArray(segments)) {
    return Response.json({ error: 'Invalid segments format' }, { status: 400 });
  }
  if (segments && segments.length > 5000) {
    return Response.json({ error: 'Too many segments (max 5000)' }, { status: 400 });
  }

  // Build full transcript context with priority markers around current position
  const typedSegments = (segments || []) as TranscriptSegment[];
  const currentTime = typeof currentTimestamp === 'number' ? currentTimestamp : 0;

  const watched = typedSegments.filter((s) => s.offset <= currentTime);
  const upcoming = typedSegments.filter((s) => s.offset > currentTime);

  let transcriptContext = '';
  if (watched.length > 0) {
    transcriptContext += '<watched_content priority="high">\n';
    transcriptContext += watched.map((s) => `[${formatTimestamp(s.offset)}] ${s.text}`).join('\n');
    transcriptContext += '\n</watched_content>';
  }
  if (upcoming.length > 0) {
    transcriptContext += '\n\n<upcoming_content priority="low">\n';
    transcriptContext += upcoming.map((s) => `[${formatTimestamp(s.offset)}] ${s.text}`).join('\n');
    transcriptContext += '\n</upcoming_content>';
  }
  // Add focused interval context when user selected a specific range
  const hasInterval = intervalSelection
    && typeof intervalSelection.startTime === 'number'
    && typeof intervalSelection.endTime === 'number'
    && Number.isFinite(intervalSelection.startTime)
    && Number.isFinite(intervalSelection.endTime)
    && intervalSelection.startTime >= 0
    && intervalSelection.endTime > intervalSelection.startTime
    && intervalSelection.endTime - intervalSelection.startTime <= 7200;

  if (hasInterval) {
    const intervalSegments = typedSegments.filter(
      (s) => s.offset >= intervalSelection.startTime && s.offset < intervalSelection.endTime,
    );
    if (intervalSegments.length > 0) {
      transcriptContext += `\n\n<selected_interval priority="highest" start="${formatTimestamp(intervalSelection.startTime)}" end="${formatTimestamp(intervalSelection.endTime)}">\n`;
      transcriptContext += intervalSegments.map((s) => `[${formatTimestamp(s.offset)}] ${s.text}`).join('\n');
      transcriptContext += '\n</selected_interval>';
    }
  }

  if (!transcriptContext) {
    transcriptContext = '(No transcript available)';
  }

  const safeVideoTitle = typeof videoTitle === 'string' ? videoTitle.slice(0, 200) : undefined;

  // Build interval description for system prompt position context
  const intervalDesc = hasInterval
    ? ` The user has selected the interval ${formatTimestamp(intervalSelection.startTime)} – ${formatTimestamp(intervalSelection.endTime)}. Focus your answer on this specific section of the video. The <selected_interval> section contains the transcript for this range.`
    : '';

  // Explore Mode: use Opus with adaptive thinking budget
  if (exploreMode) {
    const model = anthropic('claude-opus-4-6');

    // Dynamic thinking budget: client classifies complexity and sends the value
    const budgetTokens = Math.max(1024, Math.min(16000,
      typeof thinkingBudget === 'number' ? thinkingBudget : 10000
    ));

    const exploreParts = buildExploreSystemPromptParts({
      transcriptContext,
      currentTimestamp: formatTimestamp(currentTime),
      videoTitle: safeVideoTitle,
      exploreGoal: typeof exploreGoal === 'string' ? exploreGoal : undefined,
      transcriptSource: typeof transcriptSource === 'string' ? transcriptSource : undefined,
      intervalDesc,
    });

    // Inject knowledge graph context if provided (from useKnowledgeContext)
    const kgCtxExplore = knowledgeContext as KnowledgeContext | undefined;
    if (kgCtxExplore?.video || (kgCtxExplore?.related_videos?.length ?? 0) > 0) {
      const kgXml = buildKnowledgeGraphPromptContext(kgCtxExplore!);
      if (kgXml) {
        const cacheOpts = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };
        exploreParts.splice(1, 0, {
          role: 'system' as const,
          content: kgXml,
          providerOptions: cacheOpts,
        });
      }
    }

    // Inject curriculum context if provided (cross-video playlist context)
    if (typeof curriculumContext === 'string' && curriculumContext.length > 0) {
      const cacheOpts = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };
      exploreParts.splice(1, 0, {
        role: 'system' as const,
        content: `<curriculum_context>\nThe student is watching this video as part of a playlist/course. Here are transcripts from related videos in the series. You may reference content from other lectures using "In [Video Title] at [M:SS]..." to draw connections.\n${curriculumContext}\n</curriculum_context>`,
        providerOptions: cacheOpts,
      });
    }

    const MAX_HISTORY = 20;
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (history && Array.isArray(history)) {
      const trimmed = history.slice(-MAX_HISTORY);
      for (const msg of trimmed) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          const content = String(msg.content || '').slice(0, 4000);
          if (content.trim()) {
            messages.push({ role: msg.role, content });
          }
        }
      }
    }

    // Ensure at least the current user message is present
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      messages.push({ role: 'user', content: message });
    }

    // Create tools for explore mode if we have a valid video ID
    const safeExploreVideoId = typeof videoId === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(videoId) ? videoId : null;
    const exploreTools = safeExploreVideoId
      ? createVideoTools(safeExploreVideoId, typedSegments)
      : undefined;

    const result = streamText({
      model,
      system: exploreParts,
      messages,
      maxOutputTokens: 4000,
      ...(exploreTools ? {
        tools: exploreTools,
        maxSteps: 4,
        onStepFinish({ toolCalls, finishReason }) {
          if (toolCalls.length > 0) {
            console.log(`[explore] Tools: ${toolCalls.map((t: { toolName: string }) => t.toolName).join(', ')} | ${finishReason}`);
          }
        },
      } : {}),
      providerOptions: {
        anthropic: {
          thinking: { type: 'enabled', budgetTokens },
        },
      },
    });

    // Stream reasoning tokens + \x1E separator + text + tool results (enables ThinkingDepthIndicator on client)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let reasoningSent = false;
        let textCharCount = 0;
        const collectedToolResults: Array<{ toolName: string; result: unknown }> = [];

        try {
          for await (const chunk of result.fullStream) {
            if (chunk.type === 'reasoning-delta') {
              controller.enqueue(encoder.encode(chunk.text));
            } else if (chunk.type === 'reasoning-end') {
              if (!reasoningSent) {
                controller.enqueue(encoder.encode('\x1E'));
                reasoningSent = true;
              }
            } else if (chunk.type === 'text-delta') {
              if (!reasoningSent) {
                controller.enqueue(encoder.encode('\x1E'));
                reasoningSent = true;
              }
              textCharCount += chunk.text.length;
              controller.enqueue(encoder.encode(chunk.text));
            } else if (chunk.type === 'tool-result') {
              if (!reasoningSent) {
                controller.enqueue(encoder.encode('\x1E'));
                reasoningSent = true;
              }
              const toolData = { toolName: chunk.toolName, result: chunk.output };
              collectedToolResults.push(toolData);
              try {
                controller.enqueue(encoder.encode(`\x1D${JSON.stringify(toolData)}\x1D`));
              } catch (toolErr) {
                console.error(`Explore tool error (${chunk.toolName}):`, toolErr instanceof Error ? toolErr.message : toolErr);
              }
            }
          }

          if (!reasoningSent) {
            controller.enqueue(encoder.encode('\x1E'));
          }

          // Continuation: if tools ran but produced zero prose, generate brief commentary
          if (textCharCount === 0 && collectedToolResults.length > 0) {
            console.log(`[explore] Continuation: ${collectedToolResults.length} tool results, ${textCharCount} chars text`);
            const toolSummary = collectedToolResults.map(tr => {
              const r = tr.result as Record<string, unknown>;
              const compact: Record<string, unknown> = { type: r.type };
              if (r.chain && Array.isArray(r.chain)) compact.chain_count = r.chain.length;
              if (r.steps && Array.isArray(r.steps)) compact.steps_count = r.steps.length;
              if (r.questions && Array.isArray(r.questions)) compact.question_count = r.questions.length;
              if (r.alternatives && Array.isArray(r.alternatives)) compact.alt_count = r.alternatives.length;
              if (r.concept) compact.concept = r.concept;
              return `${tr.toolName}: ${JSON.stringify(compact)}`;
            }).join('; ');

            const continuation = streamText({
              model,
              system: exploreParts,
              messages: [
                ...messages,
                {
                  role: 'assistant' as const,
                  content: `[Retrieved: ${toolSummary}. Cards shown above.]`,
                },
                {
                  role: 'user' as const,
                  content: '1-2 sentences connecting these results. Use [M:SS] for timestamps. No XML tags. End with 3-4 pill options: <options>opt1|opt2|opt3</options>',
                },
              ],
              maxOutputTokens: 400,
              providerOptions: {
                anthropic: {
                  thinking: { type: 'enabled', budgetTokens: 2000 },
                },
              },
            });

            for await (const chunk of continuation.fullStream) {
              if (chunk.type === 'text-delta') {
                controller.enqueue(encoder.encode(chunk.text));
              }
              // Skip reasoning from continuation — we only want the text
            }
          }
        } catch (err) {
          console.error('Explore mode stream error:', err instanceof Error ? err.message : err);
          if (!reasoningSent) {
            controller.enqueue(encoder.encode('\x1E'));
          }
          controller.enqueue(encoder.encode('\n\n[An error occurred while generating the response.]'));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Normal mode: resolve model from client choice (default Sonnet)
  const modelId = modelChoice === 'opus'
    ? 'claude-opus-4-6'
    : modelChoice === 'haiku'
      ? 'claude-haiku-4-5-20251001'
      : 'claude-sonnet-4-5-20250929';
  const model = anthropic(modelId);

  // Build system prompt as cached parts
  const systemParts = buildVideoSystemPromptParts({
    transcriptContext,
    currentTimestamp: formatTimestamp(currentTime),
    videoTitle: safeVideoTitle,
    transcriptSource: typeof transcriptSource === 'string' ? transcriptSource : undefined,
    voiceMode: !!voiceMode,
    intervalDesc,
    demoGreeting: typeof demoGreeting === 'string' ? demoGreeting : undefined,
  });

  // Inject knowledge graph context if provided (from useKnowledgeContext)
  const kgCtx = knowledgeContext as KnowledgeContext | undefined;
  if (kgCtx?.video || (kgCtx?.related_videos?.length ?? 0) > 0) {
    const kgXml = buildKnowledgeGraphPromptContext(kgCtx!);
    if (kgXml) {
      const cacheOpts = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };
      systemParts.splice(1, 0, {
        role: 'system' as const,
        content: kgXml,
        providerOptions: cacheOpts,
      });
    }
  }

  // Inject curriculum context if provided (cross-video playlist context)
  if (typeof curriculumContext === 'string' && curriculumContext.length > 0) {
    const cacheOpts = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };
    systemParts.splice(1, 0, {
      role: 'system' as const,
      content: `<curriculum_context>\nThe student is watching this video as part of a playlist/course. Here are transcripts from related videos in the series. You may reference content from other lectures using "In [Video Title] at [M:SS]..." to draw connections.\n${curriculumContext}\n</curriculum_context>`,
      providerOptions: cacheOpts,
    });
  }

  // Apply personality modifier to the last (uncached) part
  if (typeof personality === 'string' && PERSONALITY_MODIFIERS[personality]) {
    const lastPart = systemParts[systemParts.length - 1];
    lastPart.content += PERSONALITY_MODIFIERS[personality];
  }

  // Build messages array from history (cap at 20 messages to limit cost)
  const MAX_HISTORY = 20;
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  if (history && Array.isArray(history)) {
    const trimmed = history.slice(-MAX_HISTORY);
    for (const msg of trimmed) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        const content = String(msg.content || '').slice(0, 4000);
        if (content.trim()) {
          messages.push({ role: msg.role, content });
        }
      }
    }
  }

  // Ensure at least the current user message is present
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    messages.push({ role: 'user', content: message });
  }

  // Create tools if we have a valid video ID and not in voice mode
  const safeVideoId = typeof videoId === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(videoId) ? videoId : null;
  const tools = safeVideoId && !voiceMode
    ? createVideoTools(safeVideoId, typedSegments)
    : undefined;

  const result = streamText({
    model,
    system: systemParts,
    messages,
    maxOutputTokens: voiceMode ? 500 : (tools ? 4000 : 8000),
    ...(tools ? {
      tools,
      maxSteps: 6,
      onStepFinish({ toolCalls, finishReason, text }) {
        const toolNames = toolCalls.map((t: { toolName: string }) => t.toolName).join(', ');
        console.log(`[video-chat] Step done: reason=${finishReason} tools=[${toolNames}] textLen=${text?.length ?? 0}`);
      },
    } : {}),
  });

  // When tools are active, stream a custom format:
  // - Text deltas are streamed as-is
  // - Tool results are embedded as \x1D{json}\x1D (group separator delimited)
  //
  // AI SDK multi-step (maxSteps) doesn't reliably produce a step 2 where the
  // model writes prose after tool execution — Sonnet batches all tool calls in
  // one turn with 0 text. Fix: after step 1 ends, make a concise continuation
  // call WITHOUT tools so the model writes prose about the results.
  if (tools) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let textCharCount = 0;
        const collectedToolResults: Array<{ toolName: string; result: unknown }> = [];
        try {
          for await (const chunk of result.fullStream) {
            if (chunk.type === 'text-delta') {
              textCharCount += chunk.text.length;
              controller.enqueue(encoder.encode(chunk.text));
            } else if (chunk.type === 'tool-result') {
              const toolData = { toolName: chunk.toolName, result: chunk.output };
              collectedToolResults.push(toolData);
              try {
                controller.enqueue(encoder.encode(`\x1D${JSON.stringify(toolData)}\x1D`));
              } catch (toolErr) {
                console.error(`Tool result error (${chunk.toolName}):`, toolErr instanceof Error ? toolErr.message : toolErr);
              }
            }
          }

          // If tools ran but model produced no/minimal prose, make a brief
          // continuation call to generate concise commentary.
          if (textCharCount === 0 && collectedToolResults.length > 0) {
            console.log(`[video-chat] No prose — continuation for ${collectedToolResults.length} tool results`);

            // Compact summary: tool name + key fields only (keep under 2000 chars total)
            const toolSummary = collectedToolResults.map(tr => {
              const r = tr.result as Record<string, unknown>;
              // Strip large arrays to just counts for brevity
              const compact: Record<string, unknown> = { type: r.type };
              if (r.chain && Array.isArray(r.chain)) compact.chain_count = r.chain.length;
              if (r.steps && Array.isArray(r.steps)) compact.steps_count = r.steps.length;
              if (r.questions && Array.isArray(r.questions)) compact.question_count = r.questions.length;
              if (r.alternatives && Array.isArray(r.alternatives)) compact.alt_count = r.alternatives.length;
              if (r.results && Array.isArray(r.results)) compact.result_count = r.results.length;
              if (r.concept) compact.concept = r.concept;
              if (r.from_concept) compact.from = r.from_concept;
              if (r.to_concept) compact.to = r.to_concept;
              if (r.message) compact.message = r.message;
              return `${tr.toolName}: ${JSON.stringify(compact)}`;
            }).join('; ');

            const continuation = streamText({
              model,
              system: systemParts,
              messages: [
                ...messages,
                {
                  role: 'assistant' as const,
                  content: `[I retrieved: ${toolSummary}. The UI already shows the full results as interactive cards above.]`,
                },
                {
                  role: 'user' as const,
                  content: 'Write 2-3 sentences connecting these results to my question. Use [M:SS] for any timestamps. Do NOT use XML tags, tool markup, or HTML. Do NOT repeat data the cards already show. Just add brief insight or a connecting thought.',
                },
              ],
              maxOutputTokens: 500,
              // NO tools — prose only
            });

            // Strip only known hallucinated tool markup (not all XML — preserve <options> pills)
            let contBuffer = '';
            for await (const chunk of continuation.textStream) {
              contBuffer += chunk;
            }
            contBuffer = contBuffer
              .replace(/<\/?(?:reference_?video|cite_?moment|search_?knowledge|tool_?call|tool_?result)[^>]*\/?>/gi, '')
              .replace(/\n{3,}/g, '\n\n')
              .trim();
            if (contBuffer) {
              controller.enqueue(encoder.encode(contBuffer));
            }
          }
        } catch (err) {
          console.error('Tool stream error:', err instanceof Error ? err.message : err);
          controller.enqueue(encoder.encode('\n\n[An error occurred while generating the response.]'));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return result.toTextStreamResponse();
}
