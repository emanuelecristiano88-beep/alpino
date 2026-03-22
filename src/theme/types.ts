export type ThemeAppearance = "dark" | "light";

export type ThemeFontFamily = "mono" | "sans";

export type ThemeConfig = {
  accentColor: string;
  appearance: ThemeAppearance;
  fontFamily: ThemeFontFamily;
  /** 0 = molto squadrato, 100 = molto arrotondato */
  radiusScale: number;
};

/** Chiave localStorage tema NEUMA (reset se migri da vecchio brand). */
export const THEME_STORAGE_KEY = "neuma-theme-v1";

export const DEFAULT_THEME: ThemeConfig = {
  /** Blu principale (Tailwind blue-600) — bottoni, checkbox, focus ring */
  accentColor: "#2563eb",
  appearance: "dark",
  /** Inter (sans) come preset professionale */
  fontFamily: "sans",
  /** ~0.75rem con formula applyTheme */
  radiusScale: 50,
};
