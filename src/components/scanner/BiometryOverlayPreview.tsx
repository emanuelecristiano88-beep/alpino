"use client";

import React, { useMemo, useState } from "react";
import { applyHomographyCartesian, type Mat3 } from "../../lib/biometry/homography";
import type { NeumaPoint3D } from "../../lib/biometry/types";

type Props = {
  imageUrl: string;
  /** Mappa coordinate mondo mm (piano foglio) → pixel immagine */
  worldMmToImagePx: Mat3;
  contourMm: { xMm: number; yMm: number }[];
  keypoints: NeumaPoint3D[];
  /** Da `calibration.mmPerPixelEstimate` — scala locale px → mm */
  mmPerPixelEstimate: number;
};

function worldToNorm(H: Mat3, xMm: number, yMm: number, w: number, h: number): { nx: number; ny: number } | null {
  const p = applyHomographyCartesian(H, xMm, yMm);
  if (Number.isNaN(p.x) || Number.isNaN(p.y)) return null;
  return { nx: p.x / w, ny: p.y / h };
}

function formatLengthMmLabel(
  H: Mat3,
  hallux: NeumaPoint3D,
  heel: NeumaPoint3D,
  mmPerPixel: number
): string | null {
  if (!mmPerPixel || mmPerPixel <= 0) {
    const d = Math.hypot(hallux.xMm - heel.xMm, hallux.yMm - heel.yMm);
    return `${d.toFixed(1)} mm`;
  }
  const pH = applyHomographyCartesian(H, hallux.xMm, hallux.yMm);
  const pK = applyHomographyCartesian(H, heel.xMm, heel.yMm);
  if (Number.isNaN(pH.x) || Number.isNaN(pK.x)) return null;
  const distPx = Math.hypot(pH.x - pK.x, pH.y - pK.y);
  const distMm = distPx * mmPerPixel;
  return `${distMm.toFixed(1)} mm`;
}

/**
 * Overlay SVG sopra la foto: contorno piede (blu elettrico) + mirini keypoint + lunghezza stimata.
 */
export default function BiometryOverlayPreview({
  imageUrl,
  worldMmToImagePx,
  contourMm,
  keypoints,
  mmPerPixelEstimate,
}: Props) {
  const [dims, setDims] = useState({ w: 1, h: 1 });

  const contourNorm = useMemo(() => {
    if (!contourMm.length || dims.w < 2) return "";
    const pts: string[] = [];
    for (const c of contourMm) {
      const n = worldToNorm(worldMmToImagePx, c.xMm, c.yMm, dims.w, dims.h);
      if (n) pts.push(`${n.nx},${n.ny}`);
    }
    return pts.join(" ");
  }, [contourMm, worldMmToImagePx, dims.w, dims.h]);

  const keyNorm = useMemo(() => {
    return keypoints
      .map((k) => {
        const n = worldToNorm(worldMmToImagePx, k.xMm, k.yMm, dims.w, dims.h);
        if (!n) return null;
        return { ...k, ...n };
      })
      .filter(Boolean) as (NeumaPoint3D & { nx: number; ny: number })[];
  }, [keypoints, worldMmToImagePx, dims.w, dims.h]);

  const halluxTip = useMemo(() => keypoints.find((k) => k.id === "hallux_tip"), [keypoints]);
  const heelCenter = useMemo(() => keypoints.find((k) => k.id === "heel_center"), [keypoints]);

  const lengthLabel = useMemo(() => {
    if (!halluxTip || !heelCenter || dims.w < 2) return null;
    return formatLengthMmLabel(worldMmToImagePx, halluxTip, heelCenter, mmPerPixelEstimate);
  }, [halluxTip, heelCenter, worldMmToImagePx, mmPerPixelEstimate, dims.w]);

  const halluxNorm = useMemo(() => keyNorm.find((k) => k.id === "hallux_tip"), [keyNorm]);

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
      <img
        src={imageUrl}
        alt="Anteprima biometria"
        className="block h-auto w-full max-h-[min(55vh,480px)] object-contain"
        onLoad={(e) => {
          const im = e.currentTarget;
          setDims({ w: im.naturalWidth, h: im.naturalHeight });
        }}
      />
      {dims.w > 1 && contourNorm.length > 0 ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden
        >
          <polyline
            className="neuma-foot-contour-pulse neuma-foot-contour-line"
            fill="none"
            stroke="#2563eb"
            strokeWidth={0.007}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={contourNorm}
          />
          {keyNorm.map((k) => (
            <g key={String(k.id)}>
              <circle cx={k.nx} cy={k.ny} r={0.012} fill="none" stroke="#38bdf8" strokeWidth={0.002} />
              <line
                x1={k.nx - 0.02}
                y1={k.ny}
                x2={k.nx + 0.02}
                y2={k.ny}
                stroke="#f8fafc"
                strokeWidth={0.0025}
              />
              <line
                x1={k.nx}
                y1={k.ny - 0.02}
                x2={k.nx}
                y2={k.ny + 0.02}
                stroke="#f8fafc"
                strokeWidth={0.0025}
              />
            </g>
          ))}
        </svg>
      ) : null}

      {halluxNorm && lengthLabel ? (
        <div
          className="pointer-events-none absolute z-20 flex justify-center"
          style={{
            left: `${halluxNorm.nx * 100}%`,
            top: `${halluxNorm.ny * 100}%`,
            transform: "translate(-50%, calc(-100% - 10px))",
          }}
        >
          <span
            className="whitespace-nowrap rounded-full border border-sky-400/50 bg-[#2563eb] px-2.5 py-1 font-mono text-[11px] font-bold tracking-wide text-white shadow-lg shadow-blue-600/40"
            title="Lunghezza stimata tallone–alluce (piano foglio)"
          >
            {lengthLabel}
          </span>
        </div>
      ) : null}

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 to-transparent px-3 py-3 pt-10">
        <p className="text-center font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-300">
          Calibrazione Millimetrica Completata
        </p>
      </div>
    </div>
  );
}
