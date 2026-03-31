import { useCallback, useEffect, useState } from "react";

/**
 * Rileva se il telefono è troppo inclinato rispetto alla verticale (modalità ritratto).
 * Usa beta≈90° e gamma≈0° come riferimento “telefono dritto”.
 * Richiede permesso su iOS 13+ (chiamare `requestOrientationAccess` dopo gesture utente).
 */
export function useDeviceTilt(enabled: boolean, thresholdDeg = 45) {
  const [tooTilted, setTooTilted] = useState(false);
  const [hasReading, setHasReading] = useState(false);

  const onOrientation = useCallback(
    (e: DeviceOrientationEvent) => {
      const beta = e.beta;
      const gamma = e.gamma;
      if (beta == null || gamma == null) return;
      setHasReading(true);
      const deviation = Math.sqrt((beta - 90) ** 2 + gamma ** 2);
      setTooTilted(deviation > thresholdDeg);
    },
    [thresholdDeg]
  );

  useEffect(() => {
    if (!enabled) {
      setTooTilted(false);
      setHasReading(false);
      return;
    }
    window.addEventListener("deviceorientation", onOrientation, true);
    return () => window.removeEventListener("deviceorientation", onOrientation, true);
  }, [enabled, onOrientation]);

  return { tooTilted, hasReading };
}

/** iOS Safari: richiede gesture utente (es. dopo tap “Inizia scansione”). */
export async function requestOrientationAccess(): Promise<boolean> {
  if (typeof DeviceOrientationEvent === "undefined") return false;
  const req = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<PermissionState> })
    .requestPermission;
  if (typeof req !== "function") return true;
  try {
    const status = await req();
    return status === "granted";
  } catch {
    return false;
  }
}
