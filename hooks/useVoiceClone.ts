'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { storageKey } from '@/lib/brand';

interface UseVoiceCloneOptions {
  videoId: string | null;
  channelName?: string | null;
  enabled: boolean; // only clone when voice mode is activated
}

interface UseVoiceCloneReturn {
  voiceId: string | null;
  isCloning: boolean;
  cloneError: string | null;
  triggerClone: () => void;
  /** Whether consent is needed before cloning can proceed */
  needsConsent: boolean;
  /** Grant consent and proceed with cloning */
  grantConsent: () => void;
  /** Decline consent — voice clone won't trigger */
  declineConsent: () => void;
}

const CONSENT_KEY = 'voice-clone-consent';

function getStoredConsent(): 'granted' | 'declined' | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = localStorage.getItem(storageKey(CONSENT_KEY));
    if (val === 'granted' || val === 'declined') return val;
    return null;
  } catch { return null; }
}

function hasStoredConsent(): boolean {
  return getStoredConsent() === 'granted';
}

function storeConsent(granted: boolean): void {
  try {
    if (granted) {
      localStorage.setItem(storageKey(CONSENT_KEY), 'granted');
    } else {
      localStorage.setItem(storageKey(CONSENT_KEY), 'declined');
    }
  } catch { /* ignore */ }
}

// Check localStorage synchronously (outside hook) for instant cache hit
function getCachedVoiceId(videoId: string | null, channelName?: string | null): string | null {
  if (!videoId || typeof window === 'undefined') return null;
  try {
    if (channelName) {
      const cached = localStorage.getItem(storageKey(`voice-clone-ch-${channelName}`));
      if (cached) return cached;
    }
    const cached = localStorage.getItem(storageKey(`voice-clone-${videoId}`));
    if (cached) return cached;
  } catch { /* ignore */ }
  return null;
}

export function useVoiceClone({ videoId, channelName, enabled }: UseVoiceCloneOptions): UseVoiceCloneReturn {
  // Initialize from localStorage synchronously — no flash of null voiceId
  const [voiceId, setVoiceId] = useState<string | null>(() => getCachedVoiceId(videoId, channelName));
  const [isCloning, setIsCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [consentGranted, setConsentGranted] = useState(() => hasStoredConsent());
  const cloneAttempted = useRef(false);
  const consentPrompted = useRef(false);

  // Reset when channelName changes (it loads async from noembed)
  useEffect(() => {
    cloneAttempted.current = false;
  }, [channelName]);

  // Re-check localStorage when channelName loads (may have channel-level cache)
  useEffect(() => {
    if (!videoId || voiceId) return;
    const cached = getCachedVoiceId(videoId, channelName);
    if (cached) setVoiceId(cached);
  }, [videoId, channelName, voiceId]);

  const triggerClone = useCallback(async () => {
    if (!videoId || voiceId || isCloning || cloneAttempted.current) return;

    if (!consentGranted) {
      setNeedsConsent(true);
      return;
    }

    cloneAttempted.current = true;

    // Check localStorage again in case it was set between renders
    const freshCache = getCachedVoiceId(videoId, channelName);
    if (freshCache) { setVoiceId(freshCache); return; }

    setIsCloning(true);
    setCloneError(null);

    try {
      const resp = await fetch('/api/voice-clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, channelName: channelName || undefined }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({ error: 'Clone failed' }));
        throw new Error(data.error || `Clone failed: ${resp.status}`);
      }

      const data = await resp.json();
      setVoiceId(data.voiceId);

      // Cache in localStorage — both channel and video keys
      try {
        if (channelName) {
          localStorage.setItem(storageKey(`voice-clone-ch-${channelName}`), data.voiceId);
        }
        localStorage.setItem(storageKey(`voice-clone-${videoId}`), data.voiceId);
      } catch { /* ignore */ }
    } catch (err) {
      console.error('[useVoiceClone] Clone failed:', err instanceof Error ? err.message : err);
      setCloneError(err instanceof Error ? err.message : 'Clone failed');
    } finally {
      setIsCloning(false);
    }
  }, [videoId, channelName, voiceId, isCloning, consentGranted]);

  const grantConsent = useCallback(() => {
    storeConsent(true);
    setConsentGranted(true);
    setNeedsConsent(false);
    // Reset so triggerClone can proceed
    cloneAttempted.current = false;
  }, []);

  const declineConsent = useCallback(() => {
    storeConsent(false);
    setConsentGranted(false);
    setNeedsConsent(false);
  }, []);

  // Auto-trigger clone when enabled + consent granted + no cached voiceId
  useEffect(() => {
    if (!enabled || !videoId || voiceId || isCloning || !consentGranted) return;
    // If channelName hasn't loaded yet, wait a short beat for it
    const delay = channelName ? 0 : 800;
    const timer = setTimeout(() => triggerClone(), delay);
    return () => clearTimeout(timer);
  }, [enabled, videoId, voiceId, isCloning, consentGranted, channelName, triggerClone]);

  // Show consent prompt when enabled but no consent yet (and not previously declined)
  useEffect(() => {
    if (enabled && videoId && !voiceId && !consentGranted && !consentPrompted.current && getStoredConsent() !== 'declined') {
      consentPrompted.current = true;
      setNeedsConsent(true);
    }
  }, [enabled, videoId, voiceId, consentGranted]);

  return { voiceId, isCloning, cloneError, triggerClone, needsConsent, grantConsent, declineConsent };
}
