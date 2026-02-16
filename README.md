# InVideo

AI-powered YouTube video learning assistant built with Claude Opus 4.6.

Paste any YouTube URL, pause the video, and ask AI anything about what you're watching. InVideo transforms passive video consumption into active, AI-guided learning.

## Features

- **Type-to-Chat Overlay** - Type any key while watching to pause the video and open an AI chat overlay with a chalky grain backdrop. Escape to resume.
- **Adaptive Thinking Budget** - Dynamically allocates Opus 4.6 reasoning tokens based on question complexity (simple lookup vs. deep conceptual question).
- **8 AI Tool Calls** - Rich citations (`cite_moment`), cross-video references (`reference_video`), prerequisite chains, quizzes, alternative explanations, learning paths, and concept search across 449 indexed videos.
- **Knowledge Graph** - 449 videos across 44 channels with AI-extracted concepts, cross-video prerequisite links, and enriched transcripts.
- **Voice Clone** - Press V to speak, get responses in the creator's cloned voice via ElevenLabs.
- **Explore Mode** - AI-guided video exploration with pill-based navigation options.
- **Learn Mode** - Adaptive quizzing with difficulty adjustment based on student performance.
- **Chrome Extension** - "Explore in InVideo" button injected directly into YouTube's interface.

## Architecture

```
YouTube URL -> Landing Page -> Watch Page
                                  |
                          +-------+-------+
                          |               |
                    Vidstack Player   AI Chat Overlay
                          |               |
                    Transcript API   Opus 4.6 + Tools
                          |               |
                    STT Cascade      Knowledge Graph
                  (WebScrape ->      (449 videos,
                   WhisperX ->        44 channels,
                   Groq ->            concepts +
                   Deepgram)          prerequisites)
```

**Overlay State Machine**: Two states (`watching` / `chatting`). Typing activates chat, pauses video, shows grain backdrop. Escape resumes playback.

**Streaming Protocol**: Opus reasoning tokens stream first, then `\x1E` separator, then response text. Tool results embedded as `\x1D`-delimited JSON in the text stream.

## Tech Stack

- **Framework**: Next.js 16 + React 19 + TypeScript
- **AI**: Claude Opus 4.6 via Anthropic API (AI SDK v6)
- **Video**: Vidstack player with YouTube provider
- **Database**: Supabase (knowledge graph, transcripts, analytics)
- **Search**: Upstash Vector (semantic concept search)
- **Voice**: ElevenLabs (voice cloning + TTS)
- **STT**: WhisperX (GPU) -> Groq Whisper -> Deepgram (cascade fallback)
- **Styling**: Tailwind CSS + Framer Motion
- **Math**: KaTeX (inline LaTeX rendering in chat)

## Local Development

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Add: ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

# Run dev server
npm run dev
```

## Key Innovation: Adaptive Thinking Budget

InVideo dynamically classifies each user question and allocates Opus 4.6's extended thinking budget accordingly:

| Question Type | Budget | Example |
|--------------|--------|---------|
| Simple lookup | 1,024 tokens | "What did they say at 3:45?" |
| Conceptual | 4,096 tokens | "Explain the intuition behind eigenvalues" |
| Deep analysis | 10,240 tokens | "Compare this proof approach to the one in the linear algebra video" |

This balances response quality with latency and cost.

## License

MIT
