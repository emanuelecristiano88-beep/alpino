import React, { useEffect, useState } from "react";
import { normalizedVideoToContainerPercent } from "../../lib/scanner/videoOverlayCoords";
import { cn } from "../../lib/utils";

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
  /** Marker ArUco con 4 corners normalizzati sul frame video */
  markerQuadsNorm: { id: number; corners: { x: number; y: number }[] }[] | null;
  visible: boolean;
  /** Marker lock A4: animazione sottile quando agganciato */
  locked?: boolean;
};

/**
 * Cerchi blu elettrico agganciati ai marker ArUco sul video (object-fit: cover).
 */
export default function ArucoMarkerPins({
  videoRef,
  containerRef,
  markerQuadsNorm,
  visible,
  locked = false,
}: Props) {
  const [positions, setPositions] = useState<{ leftPct: number; topPct: number; key: string }[]>([]);

  useEffect(() => {
    if (!visible || !markerQuadsNorm || markerQuadsNorm.length < 1) {
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
      const out: { leftPct: number; topPct: number; key: string }[] = [];
      for (const quad of markerQuadsNorm) {
        const corners = quad.corners?.slice(0, 4) ?? [];
        corners.forEach((p, idx) => {
          const pos = normalizedVideoToContainerPercent(p.x, p.y, vw, vh, rect.width, rect.height);
          out.push({ ...pos, key: `${quad.id}:${idx}` });
        });
      }
      setPositions(out);
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
  }, [visible, markerQuadsNorm, videoRef, containerRef]);

  if (!visible || positions.length < 1) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[12]">
      {positions.map((pos, i) => (
        <div
          key={pos.key}
          className={cn(
            "absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
            "border border-sky-200/95 bg-sky-400/55 shadow-[0_0_14px_rgba(56,189,248,0.8)]",
            locked && "motion-safe:scanner-marker-pin"
          )}
          style={{
            left: `${pos.leftPct}%`,
            top: `${pos.topPct}%`,
            opacity: locked ? 0.95 : 0.78,
            transform: `translate(-50%, -50%) scale(${locked ? 1.02 : 0.94})`,
            transition: "opacity 160ms ease-out, transform 180ms ease-out",
            animationDelay: `${(i % 8) * 45}ms`,
          }}
        />
      ))}
    </div>
  );
}
