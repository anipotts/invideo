"use client";

import { useId } from "react";

/**
 * Glassmorphic grain backdrop — displaces video pixels through fractal noise,
 * creating a distinctive grainy/color-shifted glass effect.
 *
 * Two layers:
 * 1. Dark scrim — always visible when overlay is up (bg-black/40)
 * 2. Grain displacement — fades in only when grainActive (500ms transition)
 *
 * Optimized for our binary state machine (watching <-> chatting):
 * - Video is PAUSED when chatting -> backdrop content is static -> filter computes once
 * - Fixed filter params (no dynamic recalculation)
 * - Simple CSS transition (no framer-motion dependency)
 * - `will-change` hint for GPU compositing
 */

export function OverlayBackdrop({
  visible,
  onClick,
  grainActive = true,
}: {
  visible: boolean;
  onClick: () => void;
  grainActive?: boolean;
}) {
  const filterId = useId();

  return (
    <div
      className={`absolute inset-0 transition-opacity duration-200 ease-in-out ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      onClick={onClick}
      data-overlay-backdrop
    >
      {/* Layer 1: Gradient fade — transparent top, dark bottom for chat readability */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.25) 30%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.75) 100%)',
        }}
      />

      {/* SVG displacement filter definition (0x0, purely declarative) */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <filter
            id={filterId}
            x="-5%"
            y="-5%"
            width="110%"
            height="110%"
            colorInterpolationFilters="sRGB"
          >
            {/* Fractal noise map for displacement */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.5"
              numOctaves="4"
              seed="2"
              stitchTiles="stitch"
              result="noise"
            />
            {/* Displace backdrop pixels using noise — creates colored grain */}
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="35"
              xChannelSelector="R"
              yChannelSelector="G"
              result="displaced"
            />
            {/* Warm color transfer for chalky grain */}
            <feComponentTransfer in="displaced">
              <feFuncR type="linear" slope="0.42" />
              <feFuncG type="linear" slope="0.38" />
              <feFuncB type="linear" slope="0.46" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>

      {/* Layer 2: Grain displacement — fades in when grainActive */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ease-in-out ${grainActive ? 'opacity-100' : 'opacity-0'}`}
        style={{
          backdropFilter: `url(#${filterId})`,
          WebkitBackdropFilter: `url(#${filterId})`,
          willChange: visible && grainActive ? 'backdrop-filter' : 'auto',
        }}
      />
    </div>
  );
}
