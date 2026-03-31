"use client";

import React, { useEffect, useState } from "react";
import type { ScanAlignmentResult } from "../../hooks/useScanAlignmentAnalysis";
import { normalizedVideoToContainerPercent } from "../../lib/scanner/videoOverlayCoords";

const GREEN = "#22c55e";
const RED = "#ef4444";

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
  alignment: ScanAlignmentResult;
  visible: boolean;
};

function normPointsToSvgPoints(
  points: { x: number; y: number }[],
  videoW: number,
  videoH: number,
  boxW: number,
  boxH: number
): string {
  return points
    .map((p) => {
      const { leftPct, topPct } = normalizedVideoToContainerPercent(p.x, p.y, videoW, videoH, boxW, boxH);
      return `${(leftPct / 100) * boxW},${(topPct / 100) * boxH}`;
    })
    .join(" ");
}

/**
 * Overlay di debug: ArUco (verde=rilevato, rosso=angolo atteso senza marker), contorno A4, contorno maschera piede.
 */
export default function ScanDebugOverlay({ videoRef, containerRef, alignment, visible }: Props) {
  const [layout, setLayout] = useState({ w: 0, h: 0, vw: 0, vh: 0, tick: 0 });

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    let cancelled = false;

    const measure = () => {
      const v = videoRef.current;
      const box = containerRef.current;
      if (!v || !box || cancelled) return;
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      const rect = box.getBoundingClientRect();
      setLayout({ w: rect.width, h: rect.height, vw, vh, tick: performance.now() });
    };

    const loop = () => {
      if (cancelled) return;
      measure();
      raf = requestAnimationFrame(loop);
    };

    measure();
    raf = requestAnimationFrame(loop);
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    videoRef.current?.addEventListener("loadedmetadata", measure);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      videoRef.current?.removeEventListener("loadedmetadata", measure);
    };
  }, [visible, videoRef, containerRef]);

  if (!visible || layout.w < 8 || layout.h < 8 || !layout.vw || !layout.vh) return null;

  const { w: boxW, h: boxH, vw, vh } = layout;
  const quads = alignment.arucoMarkerQuadsNorm ?? [];
  const slots = alignment.arucoSlotCentersNorm ?? [null, null, null, null];
  const corners = alignment.markerCentersNorm;
  const a4Closed = corners && corners.length >= 4;
  const a4Pts = a4Closed ? [...corners.slice(0, 4), corners[0]] : corners ?? [];
  const a4Ok = a4Closed && alignment.a4GeometryOk && (alignment.markerCount >= 4 || alignment.alignmentSource !== "foot_fallback");

  const footMetrics = alignment.footViewZoneMetrics;
  const contour = footMetrics?.contourNorm ?? [];
  const contourOk = contour.length >= 8;
  const bbox = alignment.footBBoxNorm;

  const fusedCornerOrder =
    alignment.alignmentSource === "a4" ||
    (alignment.alignmentSource === "aruco" && alignment.markerCount > 0 && alignment.markerCount < 4);

  const missingMarkerHints: { id: number; x: number; y: number }[] = [];
  if (corners && corners.length >= 4 && fusedCornerOrder && quads.length < 4) {
    const detectedIds = new Set(quads.map((q) => q.id));
    for (let id = 0; id <= 3; id++) {
      if (detectedIds.has(id)) continue;
      if (slots[id] != null) continue;
      missingMarkerHints.push({ id, x: corners[id].x, y: corners[id].y });
    }
  }

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[14]"
      width={boxW}
      height={boxH}
      viewBox={`0 0 ${boxW} ${boxH}`}
      aria-hidden
    >
      <g style={{ vectorEffect: "non-scaling-stroke" }}>
        {/* A4 / foglio */}
        {a4Pts.length >= 2 && (
          <polyline
            fill="none"
            stroke={a4Ok ? GREEN : RED}
            strokeWidth={2}
            strokeDasharray={a4Ok ? undefined : "6 4"}
            opacity={0.95}
            points={normPointsToSvgPoints(a4Pts, vw, vh, boxW, boxH)}
          />
        )}

        {/* ArUco: rilevati */}
        {quads.map((q) => (
          <polygon
            key={`aruco-${q.id}-${layout.tick}`}
            fill="none"
            stroke={GREEN}
            strokeWidth={2.5}
            opacity={0.9}
            points={normPointsToSvgPoints(q.corners, vw, vh, boxW, boxH)}
          />
        ))}

        {/* ArUco: angolo atteso senza rilevamento (solo fusione A4 / parziale) */}
        {missingMarkerHints.map(({ id, x, y }) => {
          const { leftPct, topPct } = normalizedVideoToContainerPercent(x, y, vw, vh, boxW, boxH);
          const cx = (leftPct / 100) * boxW;
          const cy = (topPct / 100) * boxH;
          const s = Math.min(boxW, boxH) * 0.04;
          return (
            <g key={`miss-${id}`}>
              <rect
                x={cx - s / 2}
                y={cy - s / 2}
                width={s}
                height={s}
                fill="none"
                stroke={RED}
                strokeWidth={2}
                strokeDasharray="4 3"
              />
              <text x={cx + s * 0.6} y={cy - s * 0.35} fill={RED} fontSize={10} fontWeight={600}>
                {id}
              </text>
            </g>
          );
        })}

        {/* Maschera piede */}
        {contourOk && (
          <polyline
            fill="none"
            stroke={GREEN}
            strokeWidth={2}
            opacity={0.88}
            points={normPointsToSvgPoints(contour, vw, vh, boxW, boxH)}
          />
        )}
        {!contourOk && bbox && bbox.w > 0.02 && bbox.h > 0.02 && (
          <rect
            x={(normalizedVideoToContainerPercent(bbox.x, bbox.y, vw, vh, boxW, boxH).leftPct / 100) * boxW}
            y={(normalizedVideoToContainerPercent(bbox.x, bbox.y, vw, vh, boxW, boxH).topPct / 100) * boxH}
            width={Math.max(
              4,
              (normalizedVideoToContainerPercent(bbox.x + bbox.w, bbox.y, vw, vh, boxW, boxH).leftPct / 100) * boxW -
                (normalizedVideoToContainerPercent(bbox.x, bbox.y, vw, vh, boxW, boxH).leftPct / 100) * boxW
            )}
            height={Math.max(
              4,
              (normalizedVideoToContainerPercent(bbox.x, bbox.y + bbox.h, vw, vh, boxW, boxH).topPct / 100) * boxH -
                (normalizedVideoToContainerPercent(bbox.x, bbox.y, vw, vh, boxW, boxH).topPct / 100) * boxH
            )}
            fill="none"
            stroke={RED}
            strokeWidth={2}
            strokeDasharray="5 4"
            opacity={0.9}
          />
        )}
      </g>
    </svg>
  );
}
