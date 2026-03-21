import type { ThemeConfig } from "./types";
import { DEFAULT_THEME, THEME_STORAGE_KEY } from "./types";

export function loadThemeFromStorage(): ThemeConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ThemeConfig>;
    /* Accento sempre blu brand: ignora valori vecchi (lime/verde) salvati in localStorage. */
    const accentColor = DEFAULT_THEME.accentColor;
    return {
      accentColor,
      /* Sempre dark: il tema “light” + accento salvato causava ancora UI con colori sbagliati. */
      appearance: "dark",
      fontFamily: parsed.fontFamily === "mono" || parsed.fontFamily === "sans" ? parsed.fontFamily : DEFAULT_THEME.fontFamily,
      radiusScale:
        typeof parsed.radiusScale === "number" && parsed.radiusScale >= 0 && parsed.radiusScale <= 100
          ? parsed.radiusScale
          : DEFAULT_THEME.radiusScale,
    };
  } catch {
    return null;
  }
}

export function saveThemeToStorage(theme: ThemeConfig): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // ignore quota / private mode
  }
}
