// lib/brand.ts — Single source of truth for branding
export const BRAND = {
  name: 'InVideo',
  tagline: 'Learn from any YouTube video with AI.',
  icon: 'ChalkboardSimple', // @phosphor-icons/react component name
  domain: 'invideochat.vercel.app',
} as const;

export const STORAGE_PREFIX = 'invideo';

export function storageKey(key: string): string {
  return `${STORAGE_PREFIX}-${key}`;
}
