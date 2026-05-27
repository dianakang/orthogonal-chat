'use client';

import { useEffect, useState } from 'react';
import { useTheme } from './ThemeProvider';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex items-center justify-center h-9 w-9 rounded-xl border border-surface-3 bg-surface-1 hover:bg-surface-2 transition-colors"
      aria-label="Toggle theme"
      // Don't warn if extensions / post-mount theme flips change attributes.
      suppressHydrationWarning
      title={
        mounted
          ? theme === 'dark'
            ? 'Switch to light mode'
            : 'Switch to dark mode'
          : 'Toggle theme'
      }
    >
      {mounted && theme === 'dark' ? (
        // Sun
        <svg className="w-4 h-4 text-zinc-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364-1.414 1.414M7.05 16.95l-1.414 1.414m0-11.314L7.05 7.05m9.9 9.9 1.414 1.414M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
        </svg>
      ) : (
        // Moon
        <svg className="w-4 h-4 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
        </svg>
      )}
    </button>
  );
}

