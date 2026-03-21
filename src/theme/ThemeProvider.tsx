"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ThemeConfig } from "./types";
import { DEFAULT_THEME } from "./types";
import { applyThemeToDocument } from "./applyTheme";
import { loadThemeFromStorage, saveThemeToStorage } from "./themeStorage";

type ThemeContextValue = {
  theme: ThemeConfig;
  setTheme: React.Dispatch<React.SetStateAction<ThemeConfig>>;
  /** Salva su localStorage (tutti i tab dopo refresh useranno il tema pubblicato). */
  publishTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeConfig>(() => loadThemeFromStorage() ?? DEFAULT_THEME);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const publishTheme = useCallback(() => {
    saveThemeToStorage(theme);
    applyThemeToDocument(theme);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      publishTheme,
    }),
    [theme, publishTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
