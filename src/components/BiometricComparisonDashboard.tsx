"use client";

import React, { useMemo } from "react";
import { Card, CardContent } from "./ui/card";
import { cn } from "../lib/utils";

export type FootBiometrics = {
  lunghezzaTotaleMm: number;
  larghezzaAvampiedeMm: number;
  altezzaColloMm: number;
  volumeCm3: number;
  puntoPressioneMax: string;
};

const MM_DIFF_THRESHOLD = 3;
const VOL_DIFF_THRESHOLD_CM3 = 50;

const DEFAULT_LEFT: FootBiometrics = {
  lunghezzaTotaleMm: 264,
  larghezzaAvampiedeMm: 98,
  altezzaColloMm: 65,
  volumeCm3: 1420,
  puntoPressioneMax: "Tallone Est.",
};

const DEFAULT_RIGHT: FootBiometrics = {
  lunghezzaTotaleMm: 267,
  larghezzaAvampiedeMm: 101,
  altezzaColloMm: 68,
  volumeCm3: 1480,
  puntoPressioneMax: "Alluce",
};

function mmDiffers(a: number, b: number) {
  return Math.abs(a - b) > MM_DIFF_THRESHOLD;
}

function volDiffers(a: number, b: number) {
  return Math.abs(a - b) > VOL_DIFF_THRESHOLD_CM3;
}

function textDiffers(a: string, b: string) {
  return a.trim() !== b.trim();
}

type BiometricComparisonDashboardProps = {
  leftFoot?: FootBiometrics;
  rightFoot?: FootBiometrics;
  className?: string;
};

export default function BiometricComparisonDashboard({
  leftFoot = DEFAULT_LEFT,
  rightFoot = DEFAULT_RIGHT,
  className,
}: BiometricComparisonDashboardProps) {
  const rows = useMemo(
    () => [
      {
        label: "Lunghezza Totale",
        format: (v: FootBiometrics) => `${v.lunghezzaTotaleMm} mm`,
        warn: mmDiffers(leftFoot.lunghezzaTotaleMm, rightFoot.lunghezzaTotaleMm),
      },
      {
        label: "Larghezza Avampiede",
        format: (v: FootBiometrics) => `${v.larghezzaAvampiedeMm} mm`,
        warn: mmDiffers(leftFoot.larghezzaAvampiedeMm, rightFoot.larghezzaAvampiedeMm),
      },
      {
        label: "Altezza Collo",
        format: (v: FootBiometrics) => `${v.altezzaColloMm} mm`,
        warn: mmDiffers(leftFoot.altezzaColloMm, rightFoot.altezzaColloMm),
      },
      {
        label: "Volume",
        format: (v: FootBiometrics) => `${v.volumeCm3} cm³`,
        warn: volDiffers(leftFoot.volumeCm3, rightFoot.volumeCm3),
      },
      {
        label: "Punto di Pressione Max",
        format: (v: FootBiometrics) => v.puntoPressioneMax,
        warn: textDiffers(leftFoot.puntoPressioneMax, rightFoot.puntoPressioneMax),
      },
    ],
    [leftFoot, rightFoot]
  );

  const hasAnyWarning = rows.some((r) => r.warn);

  return (
    <Card className={cn("border-zinc-800 bg-zinc-900 shadow-none", className)}>
      <CardContent className="p-4">
        <p className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Confronto biometrico
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div className="min-w-0 border-r border-zinc-800 pr-4">
            <h3 className="mb-3 text-center font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-100">
              PIEDE SINISTRO
            </h3>
            <ul className="space-y-3 text-xs">
              {rows.map((row) => (
                <li key={`l-${row.label}`}>
                  <div className="text-[10px] text-zinc-500">{row.label}</div>
                  <div
                    className={cn(
                      "mt-0.5 font-mono font-semibold tabular-nums text-zinc-100",
                      row.warn && "rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-200 ring-1 ring-amber-500/35"
                    )}
                  >
                    {row.format(leftFoot)}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0 pl-0">
            <h3 className="mb-3 text-center font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-100">
              PIEDE DESTRO
            </h3>
            <ul className="space-y-3 text-xs">
              {rows.map((row) => (
                <li key={`r-${row.label}`}>
                  <div className="text-[10px] text-zinc-500">{row.label}</div>
                  <div
                    className={cn(
                      "mt-0.5 font-mono font-semibold tabular-nums text-zinc-100",
                      row.warn && "rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-200 ring-1 ring-amber-500/35"
                    )}
                  >
                    {row.format(rightFoot)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {hasAnyWarning ? (
          <div className="mt-4 space-y-2 border-t border-zinc-800 pt-3">
            {rows.map((row) =>
              row.warn ? (
                <p
                  key={`w-${row.label}`}
                  className="flex items-start gap-1.5 text-[11px] font-medium leading-snug text-amber-400/95"
                >
                  <span className="shrink-0" aria-hidden>
                    ⚠
                  </span>
                  <span>
                    <span className="text-zinc-500">{row.label}: </span>
                    Differenza Rilevata
                  </span>
                </p>
              ) : null
            )}
          </div>
        ) : null}

        <p className="mt-4 border-t border-zinc-800 pt-3 text-center text-[11px] leading-relaxed text-zinc-400">
          Questi dati verranno usati per generare due file G-code unici per le nostre stampanti.
        </p>
      </CardContent>
    </Card>
  );
}
