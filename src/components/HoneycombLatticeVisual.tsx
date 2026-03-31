import React, { useMemo } from "react";

const R = 9;
const DX = Math.sqrt(3) * R;
const DY = 1.5 * R;

/** Esagono con vertice superiore (nido d'ape) */
function hexPathD(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    pts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `${pts.join(" ")} Z`;
}

export function HoneycombLatticeVisual() {
  const { paths, w, h } = useMemo(() => {
    const cols = 7;
    const rows = 9;
    const list: string[] = [];
    let maxX = 0;
    let maxY = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cx = col * DX + (row % 2) * (DX / 2) + R;
        const cy = row * DY + R;
        list.push(hexPathD(cx, cy, R));
        maxX = Math.max(maxX, cx + R);
        maxY = Math.max(maxY, cy + R);
      }
    }
    return { paths: list, w: maxX + R * 0.5, h: maxY + R * 0.5 };
  }, []);

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-b from-muted/50 to-background"
      role="img"
      aria-label="Struttura a reticolo tipo nido d'ape"
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/10 via-transparent to-transparent" />
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-auto w-full max-h-[280px] text-primary/70"
        preserveAspectRatio="xMidYMid meet"
      >
        <title>Reticolo esagonale</title>
        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.65}
            className="honeycomb-cell"
            style={{ animationDelay: `${(i % 12) * 0.08}s` }}
          />
        ))}
      </svg>
      <p className="sr-only">
        Animazione decorativa: griglia di esagoni che richiama una struttura lattice per ammortizzazione.
      </p>
    </div>
  );
}
