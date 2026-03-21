import type { ThemeConfig } from "./types";

function normalizeHex(hex: string): string {
  let h = hex.trim();
  if (!h.startsWith("#")) h = `#${h}`;
  if (h.length === 4) {
    const a = h.slice(1).split("");
    return `#${a[0]}${a[0]}${a[1]}${a[1]}${a[2]}${a[2]}`;
  }
  return h;
}

/** Valori HSL space-separated per variabili Shadcn (--primary, --ring) */
export function hexToHslComponents(hex: string): string {
  const h = normalizeHex(hex);
  const raw = h.replace("#", "");
  if (raw.length !== 6) return "0 0% 98%";
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hDeg = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        hDeg = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        hDeg = ((b - r) / d + 2) / 6;
        break;
      case b:
        hDeg = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return `${Math.round(hDeg * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function primaryForegroundHsl(hex: string): string {
  const h = normalizeHex(hex);
  const raw = h.replace("#", "");
  if (raw.length !== 6) return "240 10% 3.9%";
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "240 10% 3.9%" : "0 0% 98%";
}

/** Applica variabili Shadcn su :root + classe .dark per light/dark. */
export function applyThemeToDocument(theme: ThemeConfig): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;

  /* --primary / --ring: fissi in index.css + index.html (!important); non impostarli via JS (evita conflitti). */

  const radiusRem = 0.25 + (theme.radiusScale / 100) * 1.0;
  root.style.setProperty("--radius", `${radiusRem}rem`);

  root.classList.toggle("dark", theme.appearance === "dark");

  const fontStack =
    theme.fontFamily === "mono"
      ? "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
      : "Inter, ui-sans-serif, system-ui, sans-serif";

  document.body.style.fontFamily = fontStack;
}
