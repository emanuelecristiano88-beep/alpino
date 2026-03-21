import React, { useEffect, useState } from "react";
import { normalizedVideoToContainerPercent } from "../../lib/scanner/videoOverlayCoords";
import { cn } from "../../lib/utils";

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
  /** 4 punti normalizzati sul frame video */
  markerCentersNorm: { x: number; y: number }[] | null;
  visible: boolean;
};

/**
 * Cerchi blu elettrico agganciati ai marker ArUco sul video (object-fit: cover).
 */
export default function ArucoMarkerPins({ videoRef, containerRef, markerCentersNorm, visible }: Props) {
  const [positions, setPositions] = useState<{ leftPct: number; topPct: number }[]>([]);

  useEffect(() => {
    if (!visible || !markerCentersNorm || markerCentersNorm.length < 4) {
      setPositions([]);
      return;
    }

    let raf = 0;
    let cancelled = false;

    const update = () => {
      const v = videoRef.current;
      const box = containerRef.current;
      if (!v || !box || cancelled) return;
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      if (!vw || !vh) return;
      const rect = box.getBoundingClientRect();
      setPositions(
        markerCentersNorm.slice(0, 4).map((p) =>
          normalizedVideoToContainerPercent(p.x, p.y, vw, vh, rect.width, rect.height)
        )
      );
    };

    const loop = () => {
      if (cancelled) return;
      update();
      raf = requestAnimationFrame(loop);
    };

    update();
    raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    const v = videoRef.current;
    v?.addEventListener("loadedmetadata", update);
    window.addEventListener("orientationchange", update);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      v?.removeEventListener("loadedmetadata", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [visible, markerCentersNorm, videoRef, containerRef]);

  if (!visible || positions.length < 4) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[12]">
      {positions.map((pos, i) => (
        <div
          key={i}
          className={cn(
            "absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full",
            "border-2 border-sky-400 bg-sky-500/35 shadow-[0_0_16px_rgba(56,189,248,0.85)]",
            "motion-safe:scanner-marker-pin"
          )}
          style={{ left: `${pos.leftPct}%`, top: `${pos.topPct}%` }}
        />
      ))}
    </div>
  );
}
