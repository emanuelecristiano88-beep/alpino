export type ThemeAppearance = "dark" | "light";

export type ThemeFontFamily = "mono" | "sans";

export type ThemeConfig = {
  accentColor: string;
  appearance: ThemeAppearance;
  fontFamily: ThemeFontFamily;
  /** 0 = molto squadrato, 100 = molto arrotondato */
  radiusScale: number;
};

/** v3: reset cache locale per eliminare accenti lime salvati in passato */
export const THEME_STORAGE_KEY = "alpino-theme-v3";

export const DEFAULT_THEME: ThemeConfig = {
  /** Blu principale (Tailwind blue-600) — bottoni, checkbox, focus ring */
  accentColor: "#2563eb",
  appearance: "dark",
  /** Inter (sans) come preset professionale */
  fontFamily: "sans",
  /** ~0.75rem con formula applyTheme */
  radiusScale: 50,
};
