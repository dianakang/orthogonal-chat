'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // IMPORTANT: keep the first client render consistent with server render
  // to avoid hydration mismatches. We resolve the real theme after mount.
  const [theme, setThemeState] = useState<Theme>('dark');

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem('theme', t);
    } catch {
      // ignore
    }
    applyTheme(t);
  };

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  useEffect(() => {
    // Resolve preferred theme after mount (localStorage > media query).
    let resolved: Theme = 'dark';
    try {
      const stored = window.localStorage.getItem('theme');
      if (stored === 'light' || stored === 'dark') {
        resolved = stored;
      } else {
        resolved = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
    } catch {
      // ignore
    }

    setThemeState(resolved);
    applyTheme(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

