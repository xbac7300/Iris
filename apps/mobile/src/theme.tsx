import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

export interface ThemeColors {
  bg: string;
  card: string;
  cardElevated: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryLight: string;
  primaryText: string;
  bannerBg: string;
  bannerBorder: string;
  bannerText: string;
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
  textSecondary: '#475569',
  textMuted: '#64748b',
  primary: '#059669',
  primaryLight: '#ecfdf5',
  primaryText: '#065f46',
  bannerBg: '#f0fdf4',
  bannerBorder: '#bbf7d0',
  bannerText: '#166534',
  danger: '#dc2626',
  dangerLight: '#fef2f2',
  badgeBg: '#f1f5f9',
  inputBg: '#ffffff',
  inputBorder: '#cbd5e1',
  statusBar: 'dark',
};

export const darkTheme: ThemeColors = {
  bg: '#0b1120',
  card: '#1e293b',
  cardElevated: '#1e293b',
  border: '#334155',
  text: '#f8fafc',
  textSecondary: '#cbd5e1',
  textMuted: '#94a3b8',
  primary: '#10b981',
  primaryLight: '#064e3b',
  primaryText: '#86efac',
  bannerBg: '#142e23',
  bannerBorder: '#166534',
  bannerText: '#86efac',
  danger: '#ef4444',
  dangerLight: '#450a0a',
  badgeBg: '#334155',
  inputBg: '#0f172a',
  inputBorder: '#334155',
  statusBar: 'light',
};

interface ThemeContextType {
  darkMode: boolean;
  isDark: boolean;
  toggleDarkMode: () => void;
  setDarkMode: (val: boolean) => void;
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeContextType>({
  darkMode: true,
  isDark: true,
  toggleDarkMode: () => {},
  setDarkMode: () => {},
  colors: darkTheme,
});

const STORAGE_KEY = 'topic16.dark_mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const saved = await SecureStore.getItemAsync(STORAGE_KEY);
        if (saved === 'false') {
          setDarkMode(false);
        } else if (saved === 'true') {
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
        isDark: darkMode,
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
