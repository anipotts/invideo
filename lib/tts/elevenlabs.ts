/**
 * ElevenLabs API client — text-to-speech + voice cloning.
 * Only activated when ELEVENLABS_API_KEY env var is set.
 * Uses fetch (no extra dependencies).
 */

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_MODEL = 'eleven_turbo_v2_5';
const CLONED_VOICE_MODEL = 'eleven_turbo_v2_5'; // turbo for low-latency cloned voice TTS
const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb'; // "George" — clear male voice

/**
 * Returns true if the ElevenLabs API is configured.
 */
export function isElevenLabsAvailable(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
  return key;
}

function getDefaultVoice(): string {
  return process.env.ELEVENLABS_DEFAULT_VOICE || DEFAULT_VOICE;
}

/**
 * Convert text to speech audio (MP3 buffer).
 */
export async function textToSpeech(
  text: string,
  voiceId?: string,
  isClonedVoice?: boolean,
): Promise<Buffer> {
  const apiKey = getApiKey();
  const voice = voiceId || getDefaultVoice();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const resp = await fetch(`${ELEVENLABS_BASE_URL}/text-to-speech/${voice}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: text.slice(0, 5000),
        model_id: isClonedVoice ? CLONED_VOICE_MODEL : DEFAULT_MODEL,
        voice_settings: isClonedVoice
          ? { stability: 0.55, similarity_boost: 0.85, style: 0.0, use_speaker_boost: true }
          : { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`ElevenLabs TTS error ${resp.status}: ${errText}`);
    }

    const arrayBuffer = await resp.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convert text to speech as a streaming response.
 * Returns a ReadableStream of audio/mpeg chunks for lower latency.
 */
export async function textToSpeechStream(
  text: string,
  voiceId?: string,
  isClonedVoice?: boolean,
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = getApiKey();
  const voice = voiceId || getDefaultVoice();

  const resp = await fetch(`${ELEVENLABS_BASE_URL}/text-to-speech/${voice}/stream?optimize_streaming_latency=3`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: text.slice(0, 5000),
      model_id: isClonedVoice ? CLONED_VOICE_MODEL : DEFAULT_MODEL,
      voice_settings: isClonedVoice
        ? { stability: 0.5, similarity_boost: 0.8, style: 0.0, use_speaker_boost: false }
        : { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`ElevenLabs TTS stream error ${resp.status}: ${errText}`);
  }

  if (!resp.body) {
    throw new Error('ElevenLabs returned no stream body');
  }

  return resp.body;
}

/**
 * Detect audio MIME type from magic bytes.
 */
function detectAudioMime(buf: Buffer): { mime: string; ext: string } {
  if (buf.length >= 4) {
    // WebM: starts with 0x1A45DFA3
    if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) {
      return { mime: 'audio/webm', ext: 'webm' };
    }
    // MP4/M4A: "ftyp" at offset 4
    if (buf.length >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
      return { mime: 'audio/mp4', ext: 'mp4' };
    }
    // Ogg: "OggS"
    if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
      return { mime: 'audio/ogg', ext: 'ogg' };
    }
    // MP3: ID3 tag or sync word
    if ((buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0)) {
      return { mime: 'audio/mpeg', ext: 'mp3' };
    }
  }
  return { mime: 'audio/webm', ext: 'webm' }; // fallback
}

/**
 * Search for an existing voice by name on ElevenLabs.
 * Returns the voice_id if found, null otherwise.
 */
export async function findVoiceByName(name: string): Promise<string | null> {
  const apiKey = getApiKey();

  const resp = await fetch(`${ELEVENLABS_BASE_URL}/voices`, {
    headers: { 'xi-api-key': apiKey },
  });

  if (!resp.ok) return null;

  const data = await resp.json() as { voices: Array<{ voice_id: string; name: string }> };
  if (!data.voices) return null;

  const match = data.voices.find((v) => v.name === name);
  return match?.voice_id ?? null;
}

/**
 * Clone a voice from an audio sample using ElevenLabs Instant Voice Cloning.
 * @param audioBuffer - Audio file bytes (MP3, WAV, WebM, etc.)
 * @param name - Display name for the cloned voice
 * @param description - Optional description to improve cloning quality
 * @returns The new voice ID
 */
export async function cloneVoice(
  audioBuffer: Buffer,
  name: string,
  description?: string,
): Promise<string> {
  const apiKey = getApiKey();

  const { mime, ext } = detectAudioMime(audioBuffer);

  const formData = new FormData();
  formData.append('name', name.slice(0, 100));
  formData.append('files', new Blob([new Uint8Array(audioBuffer)], { type: mime }), `sample.${ext}`);
  formData.append('remove_background_noise', 'true');
  if (description) {
    formData.append('description', description.slice(0, 500));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min — cloning can be slow

  try {
    const resp = await fetch(`${ELEVENLABS_BASE_URL}/voices/add`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
      },
      body: formData,
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`ElevenLabs voice clone error ${resp.status}: ${errText}`);
    }

    const data = await resp.json() as { voice_id: string };
    if (!data.voice_id) {
      throw new Error('ElevenLabs voice clone returned no voice_id');
    }

    return data.voice_id;
  } finally {
    clearTimeout(timeout);
  }
}
