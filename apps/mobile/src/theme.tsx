import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

export interface ThemeColors {
  bg: string;
  card: string;
  cardElevated: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryLight: string;
  primaryText: string;
  danger: string;
  dangerLight: string;
  badgeBg: string;
  inputBg: string;
  inputBorder: string;
  statusBar: 'light' | 'dark';
}

export const lightTheme: ThemeColors = {
  bg: '#f8fafc',
  card: '#ffffff',
  cardElevated: '#f1f5f9',
  border: '#e2e8f0',
  text: '#0f172a',
  textMuted: '#64748b',
  primary: '#21634f',
  primaryLight: '#ecfdf5',
  primaryText: '#065f46',
  danger: '#dc2626',
  dangerLight: '#fef2f2',
  badgeBg: '#f1f5f9',
  inputBg: '#ffffff',
  inputBorder: '#cbd5e1',
  statusBar: 'dark',
};

export const darkTheme: ThemeColors = {
  bg: '#0f172a',
  card: '#1e293b',
  cardElevated: '#334155',
  border: '#334155',
  text: '#f8fafc',
  textMuted: '#94a3b8',
  primary: '#10b981',
  primaryLight: '#064e3b',
  primaryText: '#a7f3d0',
  danger: '#ef4444',
  dangerLight: '#450a0a',
  badgeBg: '#334155',
  inputBg: '#0f172a',
  inputBorder: '#475569',
  statusBar: 'light',
};

interface ThemeContextType {
  darkMode: boolean;
  toggleDarkMode: () => void;
  setDarkMode: (val: boolean) => void;
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeContextType>({
  darkMode: false,
  toggleDarkMode: () => {},
  setDarkMode: () => {},
  colors: lightTheme,
});

const STORAGE_KEY = 'topic16.dark_mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const saved = await SecureStore.getItemAsync(STORAGE_KEY);
        if (saved === 'true') {
          setDarkMode(true);
        }
      } catch {
        // Bỏ qua lỗi
      }
    })();
  }, []);

  const toggleDarkMode = () => {
    setDarkMode(prev => {
      const next = !prev;
      void SecureStore.setItemAsync(STORAGE_KEY, String(next)).catch(() => {});
      return next;
    });
  };

  const setDarkModeExplicit = (val: boolean) => {
    setDarkMode(val);
    void SecureStore.setItemAsync(STORAGE_KEY, String(val)).catch(() => {});
  };

  const colors = darkMode ? darkTheme : lightTheme;

  return (
    <ThemeContext.Provider
      value={{
        darkMode,
        toggleDarkMode,
        setDarkMode: setDarkModeExplicit,
        colors,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
