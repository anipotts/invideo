import { cloneVoice, findVoiceByName, isElevenLabsAvailable } from '@/lib/tts/elevenlabs';
import { downloadAudioHTTP, downloadAudioWebScrape } from '@/lib/transcript';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function sanitizeChannelName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
}

// In-memory cache — survives across requests within the same server instance
const MAX_VOICE_CACHE = 200;
const voiceCache = new Map<string, { voiceId: string; name: string }>();

function cacheVoice(key: string, value: { voiceId: string; name: string }) {
  if (voiceCache.size >= MAX_VOICE_CACHE) {
    // Evict oldest entry (first inserted)
    const firstKey = voiceCache.keys().next().value;
    if (firstKey) voiceCache.delete(firstKey);
  }
  voiceCache.set(key, value);
}

export async function POST(req: Request) {
  if (!isElevenLabsAvailable()) {
    return Response.json(
      { error: 'ElevenLabs is not configured. Set ELEVENLABS_API_KEY.' },
      { status: 503 },
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { videoId, channelName } = body;
  if (!videoId || typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return Response.json({ error: 'Invalid video ID' }, { status: 400 });
  }

  const safeChannelName = typeof channelName === 'string' && channelName.trim()
    ? channelName.trim().slice(0, 200)
    : null;

  const voiceName = safeChannelName
    ? `chalk-${sanitizeChannelName(safeChannelName)}`
    : `chalk-${videoId}`;

  // 1. Check in-memory cache (instant)
  const cacheKey = safeChannelName || videoId;
  const cached = voiceCache.get(cacheKey) || voiceCache.get(videoId);
  if (cached) {
    return Response.json({ voiceId: cached.voiceId, name: cached.name, cached: true });
  }

  // 2. Check ElevenLabs for existing voice FIRST (fast — skips YouTube download)
  const namesToTry = [voiceName];
  const videoOnlyName = `chalk-${videoId}`;
  if (voiceName !== videoOnlyName) namesToTry.push(videoOnlyName);

  for (const name of namesToTry) {
    const existingId = await findVoiceByName(name).catch(() => null);
    if (existingId) {
      // Cache for future requests
      cacheVoice(cacheKey, { voiceId: existingId, name });
      if (cacheKey !== videoId) cacheVoice(videoId, { voiceId: existingId, name });
      return Response.json({ voiceId: existingId, name, cached: true });
    }
  }

  // 3. No existing voice — download audio and create new clone
  let audioBuffer: Buffer | null = null;
  try {
    audioBuffer = await downloadAudioHTTP(videoId);
  } catch (err) {
    console.error('[voice-clone] Innertube audio failed, trying web scrape:', err instanceof Error ? err.message : err);
    try {
      audioBuffer = await downloadAudioWebScrape(videoId);
    } catch (err2) {
      console.error('[voice-clone] Web scrape audio also failed:', err2 instanceof Error ? err2.message : err2);
    }
  }

  if (!audioBuffer) {
    return Response.json(
      { error: 'No existing voice clone found and audio download failed' },
      { status: 404 },
    );
  }

  const description = safeChannelName
    ? `Cloned voice of ${safeChannelName} from YouTube educational content. Clear, articulate speaking voice.`
    : `Cloned voice from YouTube video ${videoId}`;

  let voiceId: string;
  try {
    voiceId = await cloneVoice(audioBuffer, voiceName, description);
  } catch (err) {
    console.error('[voice-clone] Clone failed:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Voice cloning failed' }, { status: 500 });
  }

  // Cache for future requests
  cacheVoice(cacheKey, { voiceId, name: voiceName });
  if (cacheKey !== videoId) cacheVoice(videoId, { voiceId, name: voiceName });

  return Response.json({ voiceId, name: voiceName, cached: false });
}
