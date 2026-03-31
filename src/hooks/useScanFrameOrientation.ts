import { useEffect, useRef, useState } from "react";

export type ScanFrameTilt = {
  /** Gradi — inclinazione “avanti/indietro” rispetto alla verticale */
  rotateX: number;
  /** Gradi — rollio leggero */
  rotateY: number;
  /** Gradi — rotazione piano schermo (gamma) */
  rotateZ: number;
};

/** Allineato al tracking overlay foglio (0.08–0.15 = movimento morbido per frame) */
const LERP = 0.1;

/**
 * Angoli derivati da DeviceOrientation per far “seguire” il rettangolo guida al telefono
 * (effetto simile alle app di scansione documenti).
 */
export function useScanFrameOrientation(enabled: boolean): ScanFrameTilt {
  const [tilt, setTilt] = useState<ScanFrameTilt>({ rotateX: 0, rotateY: 0, rotateZ: 0 });
  const smoothed = useRef<ScanFrameTilt>({ rotateX: 0, rotateY: 0, rotateZ: 0 });
  const target = useRef<ScanFrameTilt>({ rotateX: 0, rotateY: 0, rotateZ: 0 });
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      const zero = { rotateX: 0, rotateY: 0, rotateZ: 0 };
      smoothed.current = zero;
      target.current = zero;
      setTilt(zero);
      return;
    }

    const onOrientation = (e: DeviceOrientationEvent) => {
      const beta = e.beta;
      const gamma = e.gamma;
      const alpha = e.alpha;
      if (beta == null || gamma == null) return;

      // Ritratto: beta ~90°, gamma ~0° = telefono dritto verso il piede
      const rx = Math.max(-22, Math.min(22, (beta - 90) * 0.48));
      const rz = Math.max(-28, Math.min(28, gamma * 0.42));
      let ry = 0;
      if (alpha != null) {
        const a = alpha > 180 ? alpha - 360 : alpha;
        ry = Math.max(-12, Math.min(12, a * 0.03));
      }
      target.current = { rotateX: rx, rotateY: ry, rotateZ: rz };
    };

    window.addEventListener("deviceorientation", onOrientation, true);

    const loop = () => {
      const s = smoothed.current;
      const t = target.current;
      s.rotateX += (t.rotateX - s.rotateX) * LERP;
      s.rotateY += (t.rotateY - s.rotateY) * LERP;
      s.rotateZ += (t.rotateZ - s.rotateZ) * LERP;
      setTilt({ rotateX: s.rotateX, rotateY: s.rotateY, rotateZ: s.rotateZ });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("deviceorientation", onOrientation, true);
      cancelAnimationFrame(rafRef.current);
    };
  }, [enabled]);

  return tilt;
}
