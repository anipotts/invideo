'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Waveform, ShieldCheck, X } from '@phosphor-icons/react';

interface VoiceCloneConsentProps {
  channelName?: string | null;
  onAllow: () => void;
  onDecline: () => void;
}

function ConsentDialog({ channelName, onAllow, onDecline }: VoiceCloneConsentProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDecline();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onDecline]);

  // Trap focus inside dialog
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onDecline(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vc-consent-title"
        tabIndex={-1}
        className="relative w-full max-w-sm mx-4 rounded-xl bg-chalk-surface border border-white/[0.08] shadow-2xl overflow-hidden focus:outline-none"
      >
        {/* Close button */}
        <button
          onClick={onDecline}
          className="absolute top-3 right-3 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <div className="p-5">
          {/* Icon + Title */}
          <div className="flex items-center gap-2.5 mb-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-chalk-accent/10">
              <Waveform size={18} className="text-chalk-accent" />
            </div>
            <h2 id="vc-consent-title" className="text-sm font-semibold text-slate-200">
              AI Voice Synthesis
            </h2>
          </div>

          {/* Description */}
          <p className="text-[13px] text-slate-400 leading-relaxed mb-1.5">
            InVideo can generate an AI voice inspired by{' '}
            {channelName ? (
              <span className="text-slate-200">{channelName}</span>
            ) : (
              'this creator'
            )}{' '}
            to deliver personalized explanations.
          </p>

          {/* What happens */}
          <div className="flex items-start gap-2 py-2.5 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] mb-4">
            <ShieldCheck size={14} className="text-slate-500 mt-0.5 flex-shrink-0" />
            <p className="text-[12px] text-slate-500 leading-relaxed">
              A short audio sample is sent to our speech synthesis provider to generate a voice model. The generated voice is AI-synthesized and is not a recording of the creator. You can disable this anytime.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={onDecline}
              className="flex-1 px-3 py-2 rounded-lg text-[13px] font-medium text-slate-400 bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.06] hover:text-slate-300 transition-colors"
            >
              No thanks
            </button>
            <button
              onClick={onAllow}
              className="flex-1 px-3 py-2 rounded-lg text-[13px] font-medium text-white bg-chalk-accent hover:bg-chalk-accent/90 transition-colors"
            >
              Allow
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Voice clone consent modal — renders as a portal so it can be used
 * anywhere in the component tree without modifying parent layouts.
 */
export function VoiceCloneConsent({ channelName, onAllow, onDecline }: VoiceCloneConsentProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <ConsentDialog channelName={channelName} onAllow={onAllow} onDecline={onDecline} />,
    document.body,
  );
}
