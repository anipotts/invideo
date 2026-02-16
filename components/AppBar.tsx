'use client';

import { useState, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { ChalkIcon } from '@/components/ChalkIcon';
import { AnimatePresence } from 'framer-motion';
import SearchDropdown from './SearchDropdown';

interface AppBarProps {
  /** Content rendered to the right of the search bar */
  trailing?: ReactNode;
  /** Use compact width for search (e.g. watch page) */
  compact?: boolean;
}

export function AppBar({ trailing, compact = false }: AppBarProps) {
  const router = useRouter();
  const [searchValue, setSearchValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = searchValue.trim();
    if (val) {
      router.push(`/?q=${encodeURIComponent(val)}`);
      setSearchValue('');
      setShowMobileSearch(false);
      inputRef.current?.blur();
    }
  };

  const handleFocus = () => {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    setIsFocused(true);
    setShowDropdown(searchValue.length === 0);
  };

  const handleBlur = () => {
    blurTimeoutRef.current = setTimeout(() => {
      setIsFocused(false);
      setShowDropdown(false);
    }, 150);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
    setShowDropdown(e.target.value.length === 0);
  };

  const handleTopicSelect = (topic: string) => {
    setSearchValue(topic);
    setShowDropdown(false);
    router.push(`/?q=${encodeURIComponent(topic)}`);
  };

  return (
    <nav className="flex items-center gap-3 px-4 py-2">
      {/* Unified search bar: logo + input in one container */}
      <div className={`relative ${compact ? 'w-80' : 'flex-1 max-w-md'}`}>
        <form onSubmit={handleSubmit}>
          <div className={`
            flex items-center rounded-lg
            bg-white/[0.03] border border-white/[0.06]
            transition-all duration-150
            ${isFocused ? 'border-white/[0.12] bg-white/[0.05] ring-1 ring-white/[0.06]' : 'hover:bg-white/[0.04] hover:border-white/[0.08]'}
          `}>
            {/* Logo — acts as home link */}
            <a
              href="/"
              onClick={(e) => { e.preventDefault(); router.push('/'); }}
              className="group flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 shrink-0 cursor-pointer text-chalk-text/70 hover:text-chalk-accent transition-colors"
              title="Home"
            >
              <ChalkIcon size={15} />
              <span className="text-[13px] font-semibold tracking-[-0.01em]">InVideo</span>
            </a>

            {/* Divider */}
            <div className="w-px h-4 bg-white/[0.06] shrink-0" />

            {/* Search input — desktop */}
            <div className="hidden md:flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1.5">
              <MagnifyingGlass size={13} className="text-white/20 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={searchValue}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                placeholder="what are you learning?"
                className="flex-1 bg-transparent text-[13px] text-chalk-text placeholder:text-white/20 focus:outline-none min-w-0"
              />
            </div>

            {/* Search icon — mobile tap target */}
            <button
              type="button"
              onClick={() => {
                setShowMobileSearch(!showMobileSearch);
                setTimeout(() => inputRef.current?.focus(), 100);
              }}
              className="md:hidden flex items-center justify-center w-9 h-9 text-white/30 hover:text-white/50 transition-colors"
              aria-label="Search"
            >
              <MagnifyingGlass size={14} />
            </button>
          </div>
        </form>

        {/* Search dropdown — anchored to the unified bar */}
        <AnimatePresence>
          {showDropdown && isFocused && (
            <SearchDropdown
              isVisible={true}
              onSelectTopic={handleTopicSelect}
              compact
            />
          )}
        </AnimatePresence>
      </div>

      {/* Trailing content (video info, controls, etc.) */}
      {trailing && (
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {trailing}
        </div>
      )}

      {/* Mobile expanded search */}
      {showMobileSearch && (
        <div className="absolute inset-x-0 top-full bg-chalk-bg/95 backdrop-blur-md border-b border-chalk-border/30 p-3 md:hidden z-50">
          <form onSubmit={handleSubmit}>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08]">
              <MagnifyingGlass size={14} className="text-white/20 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={searchValue}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                placeholder="what are you learning?"
                className="flex-1 bg-transparent text-sm text-chalk-text placeholder:text-white/20 focus:outline-none"
              />
            </div>
          </form>
        </div>
      )}
    </nav>
  );
}
