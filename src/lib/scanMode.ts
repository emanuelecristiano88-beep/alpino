import type { ScanMode } from "../components/ScanModeSelectScreen";

const KEY = "neuma.scanMode";

export function getScanMode(): ScanMode {
  if (typeof window === "undefined") return "solo";
  const raw = window.sessionStorage.getItem(KEY);
  return raw === "assistant" || raw === "solo" ? raw : "solo";
}

export function setScanMode(mode: ScanMode) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(KEY, mode);
}

