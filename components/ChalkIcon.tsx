'use client';

import { Chalkboard, ChalkboardSimple } from '@phosphor-icons/react';

interface ChalkIconProps {
  size?: number;
  className?: string;
}

export function ChalkIcon({ size = 18, className = '' }: ChalkIconProps) {
  return (
    <span className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <ChalkboardSimple
        size={size}
        className="absolute inset-0 transition-opacity duration-150 ease-out opacity-100 group-hover:opacity-0"
      />
      <Chalkboard
        size={size}
        className="absolute inset-0 transition-opacity duration-150 ease-out opacity-0 group-hover:opacity-100"
      />
    </span>
  );
}
