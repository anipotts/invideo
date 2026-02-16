/**
 * Client-safe video utility functions.
 * No Node.js dependencies — safe for browser bundles.
 */

export interface TranscriptSegment {
  text: string;
  offset: number; // seconds
  duration: number; // seconds
  words?: Array<{ text: string; startMs: number }>;
}

export type TranscriptSource =
  | 'web-scrape'
  | 'whisperx'
  | 'groq-whisper'
  | 'deepgram';

export interface TranscriptResult {
  segments: TranscriptSegment[];
  source: TranscriptSource;
  metadata?: {
    title?: string;
    lengthSeconds?: number;
    channelId?: string;
    description?: string;
    author?: string;
  };
  storyboardSpec?: string;
}

export interface ExtractedVideo {
  videoId: string;
  startTime?: number;
}

/**
 * Parse a YouTube `t` parameter value into seconds.
 * Handles: `120`, `120s`, `2m30s`, `1h2m30s`
 */
function parseTimeParam(t: string): number | undefined {
  if (!t) return undefined;
  // Pure number (seconds)
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  // Number with trailing 's'
  if (/^\d+s$/.test(t)) return parseInt(t, 10);
  // Compound format: 1h2m30s, 2m30s, etc.
  const match = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (match && (match[1] || match[2] || match[3])) {
    return (parseInt(match[1] || '0') * 3600) +
           (parseInt(match[2] || '0') * 60) +
           parseInt(match[3] || '0');
  }
  return undefined;
}

/**
 * Extract YouTube video ID (and optional start time) from various URL formats.
 */
export function extractVideoId(input: string): ExtractedVideo | null {
  // Already a plain video ID (11 chars)
  if (/^[a-zA-Z0-9_-]{11}$/.test(input.trim())) {
    return { videoId: input.trim() };
  }

  try {
    const url = new URL(input);
    let videoId: string | null = null;

    if (url.hostname.includes('youtube.com')) {
      // youtube.com/watch?v=ID
      const v = url.searchParams.get('v');
      if (v) {
        videoId = v;
      } else {
        // youtube.com/shorts/ID or youtube.com/embed/ID or youtube.com/v/ID
        const pathMatch = url.pathname.match(/^\/(shorts|embed|v)\/([a-zA-Z0-9_-]{11})/);
        if (pathMatch) videoId = pathMatch[2];
      }
    } else if (url.hostname === 'youtu.be') {
      videoId = url.pathname.slice(1) || null;
    }

    if (!videoId) return null;

    // Parse optional timestamp param (t=120, t=2m30s, etc.)
    const tParam = url.searchParams.get('t');
    const startTime = tParam ? parseTimeParam(tParam) : undefined;

    return { videoId, startTime };
  } catch {
    // Not a URL
  }

  return null;
}

/**
 * Parse [M:SS], [H:MM:SS], and range [M:SS-M:SS] timestamp citations from AI response text.
 */
export function parseTimestampLinks(text: string): Array<{ match: string; seconds: number; endSeconds?: number; index: number }> {
  const regex = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*[-\u2013]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?\]/g;
  const results: Array<{ match: string; seconds: number; endSeconds?: number; index: number }> = [];
  let m;

  while ((m = regex.exec(text)) !== null) {
    let seconds: number;
    if (m[3] !== undefined) {
      seconds = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
    } else {
      seconds = parseInt(m[1]) * 60 + parseInt(m[2]);
    }

    let endSeconds: number | undefined;
    if (m[4] !== undefined) {
      if (m[6] !== undefined) {
        endSeconds = parseInt(m[4]) * 3600 + parseInt(m[5]) * 60 + parseInt(m[6]);
      } else {
        endSeconds = parseInt(m[4]) * 60 + parseInt(m[5]);
      }
    }

    results.push({ match: m[0], seconds, endSeconds, index: m.index });
  }

  return results;
}

/**
 * Format seconds as M:SS or H:MM:SS.
 */
/**
 * Get the effective duration of a segment, handling missing/zero durations.
 */
export function getSegmentDuration(
  segment: TranscriptSegment,
  nextSegment?: TranscriptSegment,
): number {
  if (segment.duration > 0) return segment.duration;
  if (nextSegment) return nextSegment.offset - segment.offset;
  return 3; // fallback for last segment
}

export interface WordTiming {
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * Build word timings with computed end times.
 * Uses json3 word-level data when available, falls back to
 * character-count interpolation across the segment duration.
 */
export function computeWordTimings(
  segment: TranscriptSegment,
  duration: number,
): WordTiming[] {
  const segEndMs = (segment.offset + duration) * 1000;

  if (segment.words && segment.words.length > 0) {
    return segment.words.map((w, i, arr) => ({
      text: w.text,
      startMs: w.startMs,
      endMs: i + 1 < arr.length ? arr[i + 1].startMs : segEndMs,
    }));
  }

  // Fallback: character-count proportional interpolation
  const words = segment.text.trim().split(/\s+/);
  if (words.length === 0 || (words.length === 1 && words[0] === '')) return [];

  const totalChars = words.reduce((sum, w) => sum + w.length, 0);
  if (totalChars === 0) return [];

  const segStartMs = segment.offset * 1000;
  const segDurMs = duration * 1000;
  let charsSoFar = 0;

  return words.map((w) => {
    const startMs = segStartMs + (charsSoFar / totalChars) * segDurMs;
    charsSoFar += w.length;
    const endMs = segStartMs + (charsSoFar / totalChars) * segDurMs;
    return { text: w, startMs, endMs };
  });
}

export function formatTimestamp(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/* ---- Interval Selection ---- */

export interface IntervalSelection {
  startTime: number;
  endTime: number;
}

/**
 * Snap a raw time range to the nearest transcript segment boundaries.
 * Snap threshold: 3 seconds. If no segment within threshold, keeps original.
 */
export function snapToSegmentBoundaries(
  startTime: number,
  endTime: number,
  segments: TranscriptSegment[],
): IntervalSelection {
  if (segments.length === 0) return { startTime, endTime };

  const SNAP_THRESHOLD = 3; // seconds

  // Find nearest segment start for startTime
  let snappedStart = startTime;
  let minStartDist = Infinity;
  for (const seg of segments) {
    const dist = Math.abs(seg.offset - startTime);
    if (dist < minStartDist && dist <= SNAP_THRESHOLD) {
      minStartDist = dist;
      snappedStart = seg.offset;
    }
  }

  // Find nearest segment end for endTime
  let snappedEnd = endTime;
  let minEndDist = Infinity;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segEnd = seg.offset + getSegmentDuration(seg, segments[i + 1]);
    const dist = Math.abs(segEnd - endTime);
    if (dist < minEndDist && dist <= SNAP_THRESHOLD) {
      minEndDist = dist;
      snappedEnd = segEnd;
    }
  }

  // Ensure minimum interval of 1 second
  if (snappedEnd <= snappedStart) {
    snappedEnd = snappedStart + 1;
  }

  return { startTime: snappedStart, endTime: snappedEnd };
}

/**
 * Format an interval as "M:SS – M:SS".
 */
export function formatInterval(startTime: number, endTime: number): string {
  return `${formatTimestamp(startTime)} – ${formatTimestamp(endTime)}`;
}

/**
 * Split raw stream into reasoning (before \x1E) and text (after \x1E).
 * Fast mode streams have no separator — entire content is text.
 */
export function splitReasoningFromText(fullRaw: string): {
  reasoning: string;
  text: string;
  hasSeparator: boolean;
} {
  const sepIndex = fullRaw.indexOf('\x1E');
  if (sepIndex === -1) {
    return { reasoning: fullRaw, text: '', hasSeparator: false };
  }
  return {
    reasoning: fullRaw.slice(0, sepIndex),
    text: fullRaw.slice(sepIndex + 1),
    hasSeparator: true,
  };
}

