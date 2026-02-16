/**
 * Server-side transcript fetching.
 * This file imports Node.js-only packages — do NOT import from client components.
 * For client-safe utils, import from '@/lib/video-utils' instead.
 *
 * Architecture:
 *   Phase 1 — Caption fetch: web scrape (extract captions from YouTube watch page)
 *   Phase 2 — STT cascade (sequential): WhisperX → Groq Whisper → Deepgram
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';

import { withTimeout } from './retry';
import { isGroqAvailable, transcribeWithGroq } from './stt/groq-whisper';
import { isDeepgramAvailable, transcribeWithDeepgram } from './stt/deepgram';

const execFileAsync = promisify(execFile);

// Re-export client-safe types and functions so API routes can use them
export type { TranscriptSegment, TranscriptSource, TranscriptResult } from './video-utils';
export { formatTimestamp, parseTimestampLinks, extractVideoId } from './video-utils';

import type { TranscriptSegment, TranscriptResult } from './video-utils';

function extractMetadata(data: InnertubePlayerResponse): VideoMetadata | undefined {
  const vd = data.videoDetails;
  if (!vd) return undefined;
  return {
    title: vd.title,
    lengthSeconds: vd.lengthSeconds ? parseInt(vd.lengthSeconds, 10) : undefined,
    channelId: vd.channelId,
    description: vd.shortDescription,
    author: vd.author,
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB — Groq's Whisper limit
const ALLOWED_AUDIO_HOSTS = ['rr', 'redirector.googlevideo.com']; // googlevideo CDN uses rr*.googlevideo.com

const WEBSCRAPE_TIMEOUT = 20_000;  // 20s — page fetch + caption fetch
const PIPELINE_TIMEOUT = 240_000;  // 240s overall pipeline (leave 60s buffer for Vercel 300s)

// ─── Innertube types ───────────────────────────────────────────────────────────

export interface VideoMetadata {
  title?: string;
  lengthSeconds?: number;
  channelId?: string;
  description?: string;
  author?: string;
}

interface InnertubePlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{
        baseUrl: string;
        languageCode: string;
        kind?: string; // 'asr' for auto-generated
      }>;
    };
  };
  streamingData?: {
    adaptiveFormats?: Array<{
      itag: number;
      url?: string;
      signatureCipher?: string;
      cipher?: string;
      mimeType: string;
      contentLength?: string;
      approxDurationMs?: string;
    }>;
  };
  videoDetails?: {
    title?: string;
    lengthSeconds?: string;
    channelId?: string;
    shortDescription?: string;
    author?: string;
  };
  storyboards?: {
    playerStoryboardSpecRenderer?: {
      spec?: string;
    };
  };
}

interface Json3Response {
  events?: Array<{
    tStartMs: number;
    dDurationMs?: number;
    segs?: Array<{ utf8: string; tOffsetMs?: number }>;
  }>;
}

function extractWords(
  segs: Array<{ utf8: string; tOffsetMs?: number }>,
  eventStartMs: number,
): Array<{ text: string; startMs: number }> | undefined {
  const hasOffsets = segs.some((s) => s.tOffsetMs !== undefined);
  if (!hasOffsets) return undefined;
  const words: Array<{ text: string; startMs: number }> = [];
  for (const s of segs) {
    const text = s.utf8.trim();
    if (!text || text === '\n') continue;
    words.push({ text, startMs: eventStartMs + (s.tOffsetMs ?? 0) });
  }
  return words.length > 0 ? words : undefined;
}

/**
 * Parse YouTube's XML timedtext format (returned by ANDROID client).
 * Format: <timedtext><body><p t="14980" d="1480">text</p>...</body></timedtext>
 */
function parseTimedTextXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  // Match <p t="ms" d="ms">text</p> elements
  const regex = /<p\s+t="(\d+)"(?:\s+d="(\d+)")?[^>]*>([^<]*(?:<[^/][^<]*)*?)<\/p>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const offset = parseInt(match[1], 10) / 1000;
    const duration = match[2] ? parseInt(match[2], 10) / 1000 : 0;
    // Decode HTML entities (comprehensive)
    const text = match[3]
      .replace(/<[^>]+>/g, '') // strip inner tags
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&mdash;/g, '\u2014')
      .replace(/&ndash;/g, '\u2013')
      .replace(/&hellip;/g, '\u2026')
      .replace(/&lsquo;/g, '\u2018')
      .replace(/&rsquo;/g, '\u2019')
      .replace(/&ldquo;/g, '\u201C')
      .replace(/&rdquo;/g, '\u201D')
      .trim();
    if (text) {
      segments.push({ text, offset, duration });
    }
  }
  return segments;
}

// ─── Shared: Innertube player request ─────────────────────────────────────────

async function fetchInnertubePlayer(videoId: string): Promise<InnertubePlayerResponse> {
  const key = process.env.YOUTUBE_INNERTUBE_KEY || 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';
  const clientVersion = process.env.YOUTUBE_CLIENT_VERSION || '19.44.38';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `com.google.android.youtube/${clientVersion} (Linux; U; Android 14)`,
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': clientVersion,
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion,
            androidSdkVersion: 34,
            hl: 'en',
            gl: 'US',
          },
        },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Innertube request failed: ${resp.status}`);
    return (await resp.json()) as InnertubePlayerResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch player data using iOS client (fallback when ANDROID is blocked).
 * iOS client often provides direct URLs without signatureCipher.
 */
async function fetchInnertubePlayerIOS(videoId: string): Promise<InnertubePlayerResponse> {
  const key = process.env.YOUTUBE_INNERTUBE_KEY || 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';
  const iosVersion = '19.29.1';
  const iosUA = `com.google.ios.youtube/${iosVersion} (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': iosUA,
        'X-YouTube-Client-Name': '5',
        'X-YouTube-Client-Version': iosVersion,
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'IOS',
            clientVersion: iosVersion,
            deviceMake: 'Apple',
            deviceModel: 'iPhone16,2',
            userAgent: iosUA,
            hl: 'en',
            gl: 'US',
          },
        },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`IOS Innertube request failed: ${resp.status}`);
    return (await resp.json()) as InnertubePlayerResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch player data using TV embedded client (fallback for embedded contexts).
 * Often provides direct URLs without signatureCipher for non-age-restricted videos.
 */
async function fetchInnertubePlayerTVEmbed(videoId: string): Promise<InnertubePlayerResponse> {
  const key = process.env.YOUTUBE_INNERTUBE_KEY || 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '85',
        'X-YouTube-Client-Version': '2.0',
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
            clientVersion: '2.0',
          },
          thirdParty: {
            embedUrl: 'https://www.youtube.com',
          },
        },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`TV embed Innertube request failed: ${resp.status}`);
    return (await resp.json()) as InnertubePlayerResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/** Validate that a URL points to a known YouTube/Google domain (SSRF prevention). */
function isAllowedYouTubeUrl(urlStr: string, allowedPrefixes: string[]): boolean {
  try {
    const u = new URL(urlStr);
    return allowedPrefixes.some((prefix) =>
      u.hostname === prefix || u.hostname.endsWith(`.${prefix}`) || u.hostname.endsWith('.googlevideo.com')
    );
  } catch {
    return false;
  }
}

/**
 * Fetch only the storyboard spec string for a video (lightweight fallback).
 * Used when the caption race winner didn't include storyboard data.
 */
export async function fetchStoryboardSpec(videoId: string): Promise<string | undefined> {
  const data = await fetchInnertubePlayer(videoId);
  return data.storyboards?.playerStoryboardSpecRenderer?.spec;
}

// ─── Web page scrape (extract ytInitialPlayerResponse from HTML) ──────────────
//
// Fetches the YouTube watch page with browser-like headers and extracts
// the embedded player response. Most reliable caption source from datacenter IPs.

async function fetchTranscriptWebScrape(videoId: string): Promise<{ segments: TranscriptSegment[]; metadata?: VideoMetadata; storyboardSpec?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let resp;
  try {
    resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) throw new Error(`YouTube page fetch failed: ${resp.status}`);

  const html = await resp.text();

  // Extract ytInitialPlayerResponse from the page source
  const playerMatch = html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});\s*(?:var|<\/script>)/);
  if (!playerMatch) throw new Error('Could not find ytInitialPlayerResponse in page HTML');

  let playerData: InnertubePlayerResponse;
  try {
    playerData = JSON.parse(playerMatch[1]) as InnertubePlayerResponse;
  } catch {
    throw new Error('Failed to parse ytInitialPlayerResponse JSON');
  }

  const metadata = extractMetadata(playerData);
  const tracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) throw new Error('Web scrape: no caption tracks found');

  // Prefer English manual captions over ASR
  const enTracks = tracks.filter((t) => t.languageCode.startsWith('en'));
  const manual = enTracks.find((t) => t.kind !== 'asr');
  const track = manual || enTracks[0] || tracks[0];

  // Fetch caption URL with JSON3 format
  const captionUrl = new URL(track.baseUrl);
  captionUrl.searchParams.set('fmt', 'json3');

  const captionController = new AbortController();
  const captionTimeout = setTimeout(() => captionController.abort(), 10000);
  let captionResp;
  try {
    captionResp = await fetch(captionUrl.toString(), { signal: captionController.signal });
  } finally {
    clearTimeout(captionTimeout);
  }
  if (!captionResp.ok) throw new Error(`Web scrape caption fetch failed: ${captionResp.status}`);

  const body = await captionResp.text();

  let segments: TranscriptSegment[];
  try {
    const json3 = JSON.parse(body) as Json3Response;
    if (json3.events) {
      segments = json3.events
        .filter((e) => e.segs && e.segs.length > 0)
        .map((e) => ({
          text: e.segs!.map((s) => s.utf8).join(''),
          offset: e.tStartMs / 1000,
          duration: (e.dDurationMs || 0) / 1000,
          words: extractWords(e.segs!, e.tStartMs),
        }));
    } else {
      segments = [];
    }
  } catch {
    // Fall back to XML parsing
    segments = parseTimedTextXml(body);
  }

  if (segments.length === 0) throw new Error('Web scrape: returned 0 segments');
  console.log(`[transcript] web scrape: got ${segments.length} segments`);

  // Extract storyboard spec if available
  const storyboardSpec = playerData.storyboards?.playerStoryboardSpecRenderer?.spec;

  return { segments, metadata, storyboardSpec };
}

// ─── Audio download helpers for STT tiers ───────────────────────────────────────

/**
 * Download audio from pre-fetched adaptive formats.
 * Selects smallest audio stream, validates SSRF, downloads with size guard.
 */
const ANDROID_UA = `com.google.android.youtube/${process.env.YOUTUBE_CLIENT_VERSION || '19.44.38'} (Linux; U; Android 14)`;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function downloadAudioFromFormats(
  formats: NonNullable<InnertubePlayerResponse['streamingData']>['adaptiveFormats'],
  videoId: string,
  userAgent?: string,
): Promise<Buffer> {
  if (!formats || formats.length === 0) throw new Error('No streaming formats available');

  // Find an audio-only stream (prefer mp4a/opus, smallest file)
  // First try formats with direct URLs, then try extracting URLs from signatureCipher
  const withDirectUrl = formats.filter((f) => f.mimeType.startsWith('audio/') && f.url);
  const withCipher = formats.filter((f) => f.mimeType.startsWith('audio/') && !f.url && f.signatureCipher);

  // Try to extract base URL from signatureCipher (works for some formats without full cipher decoding)
  for (const f of withCipher) {
    try {
      const params = new URLSearchParams(f.signatureCipher!);
      const url = params.get('url');
      if (url) {
        f.url = url;
        withDirectUrl.push(f);
      }
    } catch { /* skip malformed ciphers */ }
  }

  const audioFormats = withDirectUrl
    .sort((a, b) => parseInt(a.contentLength || '999999999') - parseInt(b.contentLength || '999999999'));

  if (audioFormats.length === 0) throw new Error('No audio streams with direct URLs');

  const chosen = audioFormats[0];
  const audioUrl = chosen.url!;

  // SSRF check: ensure audio URL points to Google CDN
  if (!isAllowedYouTubeUrl(audioUrl, ALLOWED_AUDIO_HOSTS)) {
    throw new Error('Audio URL points to unexpected host');
  }

  // Pre-check size from metadata
  const declaredSize = parseInt(chosen.contentLength || '0');
  if (declaredSize > MAX_AUDIO_BYTES) {
    throw new Error(`Audio too large (${Math.round(declaredSize / 1024 / 1024)}MB, max ${MAX_AUDIO_BYTES / 1024 / 1024}MB)`);
  }

  console.log(`[transcript] downloading audio via HTTP (itag ${chosen.itag}, ~${Math.round(declaredSize / 1024)}KB)`);

  // Download the audio stream with size enforcement
  // Must send Android UA matching the Innertube client context, or YouTube CDN returns 403
  const audioController = new AbortController();
  const audioTimeout = setTimeout(() => audioController.abort(), 120000);
  try {
    const audioResp = await fetch(audioUrl, {
      signal: audioController.signal,
      headers: {
        'User-Agent': userAgent || ANDROID_UA,
      },
    });
    if (!audioResp.ok) throw new Error(`Audio download failed: ${audioResp.status}`);

    // Check Content-Length header
    const contentLength = parseInt(audioResp.headers.get('content-length') || '0');
    if (contentLength > MAX_AUDIO_BYTES) {
      throw new Error(`Audio too large (${Math.round(contentLength / 1024 / 1024)}MB, max ${MAX_AUDIO_BYTES / 1024 / 1024}MB)`);
    }

    // Stream with size guard
    const reader = audioResp.body?.getReader();
    if (!reader) throw new Error('No response body');
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.byteLength;
      if (totalSize > MAX_AUDIO_BYTES) {
        reader.cancel();
        throw new Error(`Audio exceeded ${MAX_AUDIO_BYTES / 1024 / 1024}MB during download`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(audioTimeout);
  }
}

/**
 * Download audio using yt-dlp (most reliable — handles all YouTube obfuscation).
 * Falls through gracefully if yt-dlp is not installed.
 */
async function downloadAudioYtDlp(videoId: string): Promise<Buffer> {
  const tmpFile = join(tmpdir(), `chalk-audio-${videoId}-${Date.now()}.webm`);
  try {
    await execFileAsync('yt-dlp', [
      '-f', 'ba[ext=webm][filesize<25M]/ba[filesize<25M]/ba',
      '-o', tmpFile,
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 60000 });
    const buf = await readFile(tmpFile);
    if (buf.length === 0) throw new Error('yt-dlp produced empty file');
    if (buf.length > MAX_AUDIO_BYTES) throw new Error(`yt-dlp audio too large (${Math.round(buf.length / 1024 / 1024)}MB)`);
    console.log(`[transcript] yt-dlp audio: ${Math.round(buf.length / 1024)}KB`);
    return buf;
  } finally {
    try { await unlink(tmpFile); } catch { /* ok if missing */ }
  }
}

/**
 * Fetch player data using WEB client with visitor data (extracted from HTML page).
 * This is what YouTube's own player uses — most likely to return formats with URLs.
 */
async function fetchInnertubePlayerWEB(videoId: string, visitorData?: string): Promise<InnertubePlayerResponse> {
  const key = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
  const clientVersion = '2.20250210.01.00';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': BROWSER_UA,
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': clientVersion,
        'Origin': 'https://www.youtube.com',
        'Referer': `https://www.youtube.com/watch?v=${videoId}`,
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'WEB',
            clientVersion,
            ...(visitorData ? { visitorData } : {}),
            hl: 'en',
            gl: 'US',
          },
        },
        playbackContext: {
          contentPlaybackContext: {
            signatureTimestamp: 20073,
          },
        },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`WEB Innertube request failed: ${resp.status}`);
    return (await resp.json()) as InnertubePlayerResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Download audio from YouTube via Innertube streaming URLs (HTTP-only).
 * Cascade: yt-dlp → WEB → ANDROID → IOS → TV embedded.
 */
export async function downloadAudioHTTP(videoId: string): Promise<Buffer> {
  // Try yt-dlp first — most reliable method, handles all YouTube obfuscation
  try {
    return await downloadAudioYtDlp(videoId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // ENOENT = yt-dlp not installed (expected on Vercel), anything else is a real error
    if (msg.includes('ENOENT')) {
      console.log('[transcript] yt-dlp not installed, falling back to Innertube clients');
    } else {
      console.log(`[transcript] yt-dlp failed: ${msg}`);
    }
  }

  const clients: Array<{ name: string; fetch: () => Promise<InnertubePlayerResponse>; ua?: string }> = [
    { name: 'WEB', fetch: () => fetchInnertubePlayerWEB(videoId), ua: BROWSER_UA },
    { name: 'ANDROID', fetch: () => fetchInnertubePlayer(videoId) },
    { name: 'IOS', fetch: () => fetchInnertubePlayerIOS(videoId) },
    { name: 'TV_EMBED', fetch: () => fetchInnertubePlayerTVEmbed(videoId) },
  ];

  const errors: string[] = [];
  for (const client of clients) {
    try {
      const data = await client.fetch();
      const formats = data.streamingData?.adaptiveFormats;
      const audioCount = formats?.filter(f => f.mimeType.startsWith('audio/')).length ?? 0;
      const urlCount = formats?.filter(f => f.mimeType.startsWith('audio/') && (f.url || f.signatureCipher || f.cipher)).length ?? 0;
      console.log(`[transcript] ${client.name}: ${formats?.length ?? 0} formats, ${audioCount} audio, ${urlCount} with url/cipher`);
      return await downloadAudioFromFormats(formats, videoId, client.ua);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${client.name}: ${msg}`);
      console.log(`[transcript] ${client.name} audio failed: ${msg}`);
    }
  }
  throw new Error(`All Innertube clients failed: ${errors.join('; ')}`);
}

// ─── YouTube cipher decoder ──────────────────────────────────────────────────

/**
 * Decode a signatureCipher to get a working direct URL.
 * YouTube encrypts streaming URLs with a cipher function embedded in their player JS (base.js).
 * This extracts the function and applies it to recover the direct URL.
 */
async function decodeCipherUrl(signatureCipher: string, playerJsUrl: string): Promise<string> {
  const params = new URLSearchParams(signatureCipher);
  const encSig = params.get('s');
  const sp = params.get('sp') || 'signature';
  const baseUrl = params.get('url');
  if (!encSig || !baseUrl) throw new Error('Missing s or url in signatureCipher');

  // Fetch player JS
  const jsResp = await fetch(playerJsUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!jsResp.ok) throw new Error(`Failed to fetch player JS: ${jsResp.status}`);
  const js = await jsResp.text();

  // Find the cipher entry function name using known patterns
  const funcPatterns = [
    /\b[cs]\s*&&\s*[adf]\.set\([^,]+\s*,\s*encodeURIComponent\(([a-zA-Z0-9$]+)\(/,
    /\bm=([a-zA-Z0-9$]{2,})\(decodeURIComponent\(h\.s\)\)/,
    /\bc\s*&&\s*d\.set\([^,]+\s*,\s*(?:encodeURIComponent\s*\()([a-zA-Z0-9$]+)\(/,
    /\bc\s*&&\s*[a-z]\.set\([^,]+\s*,\s*([a-zA-Z0-9$]+)\(/,
    /\bc\s*&&\s*[a-z]\.set\([^,]+\s*,\s*encodeURIComponent\(([a-zA-Z0-9$]+)\(/,
    /([a-zA-Z0-9$]+)\s*=\s*function\(\s*a\s*\)\s*\{\s*a\s*=\s*a\.split\(\s*""\s*\)/,
  ];

  let funcName: string | null = null;
  for (const pat of funcPatterns) {
    const m = js.match(pat);
    if (m) { funcName = m[1]; break; }
  }
  if (!funcName) throw new Error('Could not find cipher function name in player JS');

  // Find the function body: funcName=function(a){a=a.split("");XX.method(a,N);...;return a.join("")}
  const esc = funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bodyMatch = js.match(new RegExp(
    `(?:${esc}=function|function ${esc})\\(a\\)\\{a=a\\.split\\(""\\);([^}]+)return a\\.join\\(""\\)\\}`
  ));
  if (!bodyMatch) throw new Error('Could not find cipher function body');
  const operations = bodyMatch[1];

  // Find helper object name (e.g., "Xo" in "Xo.method(a,5)")
  const helperMatch = operations.match(/([a-zA-Z0-9$]{2,})\.([a-zA-Z0-9$]+)\(/);
  if (!helperMatch) throw new Error('Could not find cipher helper object');
  const helperName = helperMatch[1];

  // Find helper object definition to classify its methods
  const escHelper = helperName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const helperDef = js.match(new RegExp(`var\\s+${escHelper}\\s*=\\s*\\{([\\s\\S]*?)\\};`));
  if (!helperDef) throw new Error('Could not find cipher helper definition');

  // Classify each method: reverse, splice, or swap
  const methodType: Record<string, 'reverse' | 'splice' | 'swap'> = {};
  const methodRegex = /([a-zA-Z0-9$]+)\s*:\s*function\s*\([^)]*\)\s*\{([^}]+)\}/g;
  let mm;
  while ((mm = methodRegex.exec(helperDef[1])) !== null) {
    const body = mm[2];
    if (body.includes('reverse')) methodType[mm[1]] = 'reverse';
    else if (body.includes('splice')) methodType[mm[1]] = 'splice';
    else methodType[mm[1]] = 'swap';
  }

  // Apply cipher operations to the encrypted signature
  let sig = encSig.split('');
  const opRegex = new RegExp(`${escHelper}\\.([a-zA-Z0-9$]+)\\(a,(\\d+)\\)`, 'g');
  let op;
  while ((op = opRegex.exec(operations)) !== null) {
    const [, method, indexStr] = op;
    const idx = parseInt(indexStr);
    const type = methodType[method];
    if (type === 'reverse') {
      sig.reverse();
    } else if (type === 'splice') {
      sig.splice(0, idx);
    } else if (type === 'swap') {
      const temp = sig[0];
      sig[0] = sig[idx % sig.length];
      sig[idx % sig.length] = temp;
    }
  }

  return `${baseUrl}&${sp}=${encodeURIComponent(sig.join(''))}`;
}

/**
 * Download audio by scraping the YouTube watch page HTML.
 * Tries yt-dlp first, then WEB Innertube with visitor data, then HTML extraction + cipher decoding.
 */
export async function downloadAudioWebScrape(videoId: string): Promise<Buffer> {
  // Try yt-dlp first — handles all YouTube obfuscation
  try {
    return await downloadAudioYtDlp(videoId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('ENOENT')) {
      console.log(`[transcript] yt-dlp failed in web scrape path: ${msg}`);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let resp;
  try {
    resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) throw new Error(`YouTube page fetch failed: ${resp.status}`);
  const html = await resp.text();

  // Extract visitor data for WEB Innertube call
  const visitorDataMatch = html.match(/"visitorData"\s*:\s*"([^"]+)"/);
  const visitorData = visitorDataMatch?.[1];

  // Try WEB Innertube client with visitor data from the page (most likely to have URLs)
  if (visitorData) {
    try {
      const webData = await fetchInnertubePlayerWEB(videoId, visitorData);
      const webFormats = webData.streamingData?.adaptiveFormats;
      const audioWithUrl = webFormats?.filter(f => f.mimeType.startsWith('audio/') && (f.url || f.signatureCipher || f.cipher));
      if (audioWithUrl && audioWithUrl.length > 0) {
        console.log(`[transcript] WEB Innertube (with visitorData): ${audioWithUrl.length} audio formats with URLs`);
        // Normalize cipher fields
        for (const f of webFormats!) {
          if (!f.signatureCipher && f.cipher) f.signatureCipher = f.cipher;
        }
        // If formats have signatureCipher but no direct URL, try cipher decoding
        const needsCipher = audioWithUrl.filter(f => !f.url && f.signatureCipher);
        if (needsCipher.length > 0 && audioWithUrl.filter(f => f.url).length === 0) {
          const jsUrlMatch = html.match(/"jsUrl"\s*:\s*"([^"]+)"/);
          if (jsUrlMatch) {
            const playerJsUrl = jsUrlMatch[1].startsWith('/') ? `https://www.youtube.com${jsUrlMatch[1]}` : jsUrlMatch[1];
            for (const f of needsCipher) {
              try {
                f.url = await decodeCipherUrl(f.signatureCipher!, playerJsUrl);
                break;
              } catch { /* try next */ }
            }
          }
        }
        return await downloadAudioFromFormats(webFormats, videoId, BROWSER_UA);
      }
      console.log(`[transcript] WEB Innertube: formats present but no audio URLs`);
    } catch (err) {
      console.log(`[transcript] WEB Innertube with visitorData failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Fall back to extracting from HTML ytInitialPlayerResponse
  const playerMatch = html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});\s*(?:var|<\/script>)/);
  if (!playerMatch) throw new Error('Could not find ytInitialPlayerResponse in page HTML');

  let playerData: InnertubePlayerResponse;
  try {
    playerData = JSON.parse(playerMatch[1]) as InnertubePlayerResponse;
  } catch {
    throw new Error('Failed to parse ytInitialPlayerResponse JSON');
  }

  const formats = playerData.streamingData?.adaptiveFormats;

  // Normalize: some YouTube responses use "cipher" instead of "signatureCipher"
  if (formats) {
    for (const f of formats) {
      if (!f.signatureCipher && f.cipher) f.signatureCipher = f.cipher;
    }
  }

  // Diagnostic: log format breakdown
  const audioFormats = formats?.filter((f) => f.mimeType.startsWith('audio/')) ?? [];
  const audioWithUrl = audioFormats.filter((f) => f.url);
  const audioWithCipher = audioFormats.filter((f) => f.signatureCipher);
  console.log(`[transcript] HTML scrape: ${formats?.length ?? 0} total formats, ${audioFormats.length} audio, ${audioWithUrl.length} with url, ${audioWithCipher.length} with cipher`);

  // Log sample format keys to diagnose what YouTube provides
  if (audioFormats.length > 0 && audioWithUrl.length === 0 && audioWithCipher.length === 0) {
    const sample = audioFormats[0] as Record<string, unknown>;
    const keys = Object.keys(sample);
    console.log(`[transcript] sample audio format keys: [${keys.join(', ')}]`);
    console.log(`[transcript] sample: itag=${sample.itag} mimeType=${sample.mimeType}`);
  }

  // Try direct URLs first
  if (audioWithUrl.length > 0) {
    return downloadAudioFromFormats(formats, videoId, BROWSER_UA);
  }

  // No direct URLs — decode signatureCipher using player JS
  if (audioWithCipher.length === 0) {
    throw new Error(`No audio URLs in HTML (${audioFormats.length} audio formats, none with url or cipher)`);
  }

  // Extract base.js URL from page HTML
  const jsUrlMatch = html.match(/"jsUrl"\s*:\s*"([^"]+)"/);
  if (!jsUrlMatch) throw new Error('Could not find base.js URL in page HTML');
  const playerJsUrl = jsUrlMatch[1].startsWith('/')
    ? `https://www.youtube.com${jsUrlMatch[1]}`
    : jsUrlMatch[1];

  console.log(`[transcript] decoding ${audioWithCipher.length} cipher audio formats via ${playerJsUrl}`);

  audioWithCipher.sort((a, b) => parseInt(a.contentLength || '999999999') - parseInt(b.contentLength || '999999999'));

  for (const f of audioWithCipher) {
    try {
      f.url = await decodeCipherUrl(f.signatureCipher!, playerJsUrl);
      break; // Only need one working URL
    } catch (err) {
      console.log(`[transcript] cipher decode failed for itag ${f.itag}:`, err instanceof Error ? err.message : err);
    }
  }

  return downloadAudioFromFormats(formats, videoId, BROWSER_UA);
}

// ─── WhisperX service client ────────────────────────────────────────────────────

/**
 * Discover WhisperX service URL from env var or Supabase service_registry.
 * Returns null if service is unavailable or stale (>2h since last heartbeat).
 */
async function getWhisperXUrl(): Promise<string | null> {
  if (process.env.WHISPERX_SERVICE_URL) return process.env.WHISPERX_SERVICE_URL;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  try {
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/service_registry?service_name=eq.whisperx&select=url,updated_at`,
      {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        next: { revalidate: 60 },
      },
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    if (!rows.length) return null;

    // Stale after 2 hours — service sends heartbeats every ~30 min
    const age = Date.now() - new Date(rows[0].updated_at).getTime();
    if (age > 2 * 60 * 60 * 1000) return null;

    return rows[0].url;
  } catch {
    return null;
  }
}

/**
 * Transcribe a YouTube video via the WhisperX GPU service (Courant cuda5).
 * The service handles audio download + WhisperX transcription internally.
 */
async function fetchTranscriptWhisperX(videoId: string): Promise<TranscriptResult> {
  const url = await getWhisperXUrl();
  if (!url) throw new Error('WhisperX service not available');

  const resp = await fetch(`${url}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_id: videoId }),
    signal: AbortSignal.timeout(180_000), // 3 min for long videos
  });

  if (!resp.ok) throw new Error(`WhisperX ${resp.status}: ${await resp.text()}`);

  const data = await resp.json();
  if (!data.segments?.length) throw new Error('WhisperX returned no segments');

  return { segments: data.segments, source: 'whisperx' as const };
}

// ─── Phase 1: Caption fetch ─────────────────────────────────────────────────────

interface CaptionRaceResult {
  segments: TranscriptSegment[];
  source: 'web-scrape';
  metadata?: VideoMetadata;
  storyboardSpec?: string;
}

export async function captionRace(videoId: string): Promise<CaptionRaceResult> {
  const result = await withTimeout(
    fetchTranscriptWebScrape(videoId),
    WEBSCRAPE_TIMEOUT,
    'Web scrape',
  );
  return {
    segments: result.segments,
    source: 'web-scrape' as const,
    metadata: result.metadata,
    storyboardSpec: result.storyboardSpec,
  };
}

// ─── Phase 2: STT cascade ──────────────────────────────────────────────────────

export async function sttCascade(videoId: string): Promise<TranscriptResult> {
  const cascadeStart = Date.now();
  console.log(`[transcript] ${videoId}: captions failed, starting STT cascade`);

  // Strategy 1: WhisperX — SKIP in STT cascade.
  // WhisperX is handled exclusively by the GPU queue worker to prevent
  // Vercel's direct calls from hogging the GPU and blocking queued jobs.
  // The cascade falls through to Groq/Deepgram, and if those fail,
  // the stream route enqueues a GPU job automatically.

  // Strategy 2: Web scrape audio → Groq Whisper
  if (isGroqAvailable()) {
    try {
      const audio = await downloadAudioWebScrape(videoId);
      const segments = await transcribeWithGroq(audio, `${videoId}.webm`);
      if (segments.length > 0) {
        console.log(`[transcript] ${videoId}: transcribed via Groq Whisper (${segments.length} segments, ${Date.now() - cascadeStart}ms)`);
        return { segments, source: 'groq-whisper' };
      }
    } catch (e) {
      console.warn(`[transcript] Groq failed:`, e instanceof Error ? e.message : e);
    }
  }

  // Strategy 3: Web scrape audio → Deepgram
  if (isDeepgramAvailable()) {
    try {
      const audio = await downloadAudioWebScrape(videoId);
      const segments = await transcribeWithDeepgram(audio, `${videoId}.webm`);
      if (segments.length > 0) {
        console.log(`[transcript] ${videoId}: transcribed via Deepgram (${segments.length} segments, ${Date.now() - cascadeStart}ms)`);
        return { segments, source: 'deepgram' };
      }
    } catch (e) {
      console.warn(`[transcript] Deepgram failed:`, e instanceof Error ? e.message : e);
    }
  }

  throw new Error('All STT tiers failed');
}

// ─── Main pipeline ─────────────────────────────────────────────────────────────

/**
 * Fetch transcript for a YouTube video.
 *
 * Phase 1: Web scrape captions
 * Phase 2: STT cascade (WhisperX → Groq → Deepgram)
 *
 * Wrapped in an overall pipeline timeout to stay within Vercel's maxDuration.
 */
export async function fetchTranscript(videoId: string): Promise<TranscriptResult> {
  const pipelineStart = Date.now();

  const run = async (): Promise<TranscriptResult> => {
    // Phase 1: Web scrape captions
    try {
      const result = await captionRace(videoId);
      console.log(`[transcript] ${videoId}: fetched via ${result.source} (${result.segments.length} segments, total ${Date.now() - pipelineStart}ms)`);
      return result;
    } catch (e) {
      console.warn(`[transcript] ${videoId}: caption fetch failed (${Date.now() - pipelineStart}ms):`, e instanceof Error ? e.message : e);
    }

    // Phase 2: STT cascade
    try {
      const result = await sttCascade(videoId);
      console.log(`[transcript] ${videoId}: STT succeeded via ${result.source} (total ${Date.now() - pipelineStart}ms)`);
      return result;
    } catch (e) {
      console.error(`[transcript] ${videoId}: all tiers failed (total ${Date.now() - pipelineStart}ms):`, e instanceof Error ? e.message : e);
      throw new Error(`Could not fetch transcript for video ${videoId}`);
    }
  };

  return withTimeout(run(), PIPELINE_TIMEOUT, 'Transcript pipeline');
}

/**
 * Clean transcript segment text by removing common artifacts from auto-captions.
 *
 * Strips: [Music], [Applause], [Laughter], ♪ notes, \n newlines,
 * leading speaker dashes, and normalizes whitespace.
 * Returns cleaned segments with empty-after-cleaning entries removed.
 */
export function cleanSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const BRACKET_ANNOTATIONS = /\[(?:Music|Applause|Laughter|Inaudible|Silence|Cheering|Cheers|Booing|Singing|Foreign|Background noise|Background music)\]/gi;
  const MUSIC_NOTES = /[♪♫♬]+/g;
  const LEADING_DASH = /^[-–—]\s*/;
  const SPEAKER_LABEL = /^>>\s*[A-Z][A-Za-z\s.'-]*:\s*/;
  const MULTI_SPACE = /\s{2,}/g;

  const result: TranscriptSegment[] = [];

  for (const seg of segments) {
    let text = seg.text;

    // Strip newlines and carriage returns
    text = text.replace(/[\r\n]+/g, ' ');

    // Remove bracket annotations like [Music], [Applause], etc.
    text = text.replace(BRACKET_ANNOTATIONS, '');

    // Remove subtitle service watermarks and URLs in brackets
    text = text.replace(/\[.*?(?:\.com|\.org|\.net|https?:\/\/|subtitles?\s+by|powered\s+by|corrections?\s+at).*?\]/gi, '');

    // Remove music note characters
    text = text.replace(MUSIC_NOTES, '');

    // Remove empty brackets left after stripping content (e.g., [♪] → [])
    text = text.replace(/\[\s*\]/g, '');

    // Remove speaker labels like ">> JOHN SMITH: "
    text = text.replace(SPEAKER_LABEL, '');

    // Remove leading dashes (speaker turn markers)
    text = text.replace(LEADING_DASH, '');

    // Normalize whitespace
    text = text.replace(MULTI_SPACE, ' ').trim();

    // Only keep segments that still have meaningful text
    if (text.length > 0) {
      let words = seg.words;
      if (words && seg.text !== text) {
        // Re-align words: keep only words whose trimmed text appears in cleaned text
        const cleanedLower = text.toLowerCase();
        words = words.filter(w => {
          const wt = w.text.trim().toLowerCase();
          return wt.length > 0 && cleanedLower.includes(wt);
        });
        if (words.length === 0) words = undefined;
      }
      result.push({ ...seg, text, words });
    }
  }

  return result;
}

/**
 * Deduplicate overlapping auto-generated caption segments.
 */
export function deduplicateSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length === 0) return [];

  const result: TranscriptSegment[] = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const prev = result[result.length - 1];
    const curr = segments[i];
    if (curr.text.trim() === prev.text.trim()) continue;
    if (curr.offset < prev.offset + prev.duration && prev.text.includes(curr.text.trim())) continue;
    result.push(curr);
  }
  return result;
}

/**
 * Merge tiny caption fragments into sentence-level segments.
 *
 * YouTube auto-captions arrive as 2-3 word fragments every ~2s.
 * This merges them into natural sentence chunks by accumulating text
 * until we hit a sentence-ending punctuation, a time gap > 3s,
 * or a reasonable length (~120 chars).
 */
export function mergeIntoSentences(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length === 0) return [];

  const TIME_GAP_THRESHOLD = 3; // seconds — gap between segments that forces a break
  const MAX_CHARS = 150;        // soft limit before forcing a break
  const MIN_CHARS = 30;         // don't break on punctuation if under this

  const merged: TranscriptSegment[] = [];
  let accText = '';
  let accStart = 0;
  let accEnd = 0;
  let accWords: Array<{ text: string; startMs: number }> = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = seg.text.trim();
    if (!text) continue;

    const segEnd = seg.offset + (seg.duration || 0);

    if (accText === '') {
      // Start a new accumulation
      accText = text;
      accStart = seg.offset;
      accEnd = segEnd;
      if (seg.words) accWords.push(...seg.words);
      continue;
    }

    // Check if we should flush the accumulator before adding this segment
    const gap = seg.offset - accEnd;
    const endsWithSentence = /[.!?][\s"')\]]?$/.test(accText);
    const tooLong = accText.length >= MAX_CHARS;
    const sentenceBreak = endsWithSentence && accText.length >= MIN_CHARS;

    if (gap > TIME_GAP_THRESHOLD || tooLong || sentenceBreak) {
      // Flush accumulated text
      merged.push({
        text: accText,
        offset: accStart,
        duration: accEnd - accStart,
        words: accWords.length > 0 ? accWords : undefined,
      });
      accText = text;
      accStart = seg.offset;
      accEnd = segEnd;
      accWords = seg.words ? [...seg.words] : [];
    } else {
      // Append to accumulator
      accText += ' ' + text;
      accEnd = segEnd;
      if (seg.words) accWords.push(...seg.words);
    }
  }

  // Flush remaining
  if (accText) {
    merged.push({
      text: accText,
      offset: accStart,
      duration: accEnd - accStart,
      words: accWords.length > 0 ? accWords : undefined,
    });
  }

  return merged;
}
