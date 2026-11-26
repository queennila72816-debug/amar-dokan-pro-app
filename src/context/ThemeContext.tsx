import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ThemePreference } from '../types';

export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'AMAR_DOKAN_PRO_THEME';

interface ThemeContextValue {
  /** Resolved visual theme ('light' | 'dark') for existing consumers */
  theme: ThemeMode;
  /** User preference ('light' | 'dark' | 'system') */
  themeMode: ThemePreference;
  isDark: boolean;
  setTheme: (mode: ThemePreference) => void;
  setThemeMode: (mode: ThemePreference) => void;
  toggleTheme: () => void;
  cycleThemeMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function getInitialThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light' || saved === 'system') {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return 'light';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeMode, setThemeModeState] = useState<ThemePreference>(getInitialThemePreference);
  const [systemDark, setSystemDark] = useState<boolean>(getSystemPrefersDark);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    setSystemDark(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener?.(onChange);
    return () => mql.removeListener?.(onChange);
  }, []);

  const resolvedTheme: ThemeMode =
    themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode;

  const applyThemeToDom = useCallback((mode: ThemeMode) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (mode === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', mode === 'dark' ? '#0A122C' : '#101B3F');
    }
  }, []);

  useEffect(() => {
    applyThemeToDom(resolvedTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // ignore storage errors
    }
  }, [resolvedTheme, themeMode, applyThemeToDom]);

  const setThemeMode = useCallback((mode: ThemePreference) => {
    setThemeModeState(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeModeState(prev => {
      const currentResolved = prev === 'system' ? (getSystemPrefersDark() ? 'dark' : 'light') : prev;
      return currentResolved === 'light' ? 'dark' : 'light';
    });
  }, []);

  const cycleThemeMode = useCallback(() => {
    setThemeModeState(prev =>
      prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light'
    );
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme: resolvedTheme,
        themeMode,
        isDark: resolvedTheme === 'dark',
        setTheme: setThemeMode,
        setThemeMode,
        toggleTheme,
        cycleThemeMode,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
