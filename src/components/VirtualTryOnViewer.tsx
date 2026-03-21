"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { cn } from "../lib/utils";
import type { ShoeCatalogItem } from "../data/shoeCatalog";

const TPU_SWATCHES = [
  { id: "nero", label: "Nero", rgb: [0.06, 0.06, 0.08] as const },
  { id: "blu", label: "Blu", rgb: [0.1, 0.32, 0.95] as const },
  { id: "grigio", label: "Grigio", rgb: [0.4, 0.43, 0.48] as const },
] as const;

function applyTpuToMaterials(
  mv: HTMLElement,
  rgb: readonly [number, number, number]
) {
  type MVWithModel = HTMLElement & {
    model?: {
      materials?: Array<{
        pbrMetallicRoughness?: { setBaseColorFactor: (c: [number, number, number, number]) => void };
      }>;
    };
  };
  const mats = (mv as MVWithModel).model?.materials;
  if (!mats?.length) return;
  const rgba: [number, number, number, number] = [rgb[0], rgb[1], rgb[2], 1];
  for (const m of mats) {
    try {
      m.pbrMetallicRoughness?.setBaseColorFactor(rgba);
    } catch {
      /* alcuni materiali speciali possono fallire */
    }
  }
}

export type VirtualTryOnViewerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shoe: ShoeCatalogItem | null;
  /** Chiude AR e avvia flusso scansione piede (es. tutorial + scanner). */
  onScanFoot: () => void;
};

export default function VirtualTryOnViewer({
  open,
  onOpenChange,
  shoe,
  onScanFoot,
}: VirtualTryOnViewerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mvRef = useRef<HTMLElement | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [tpuId, setTpuId] = useState<(typeof TPU_SWATCHES)[number]["id"]>("nero");

  const activeRgb = TPU_SWATCHES.find((s) => s.id === tpuId)?.rgb ?? TPU_SWATCHES[0].rgb;

  const applyTint = useCallback(() => {
    const mv = mvRef.current;
    if (mv) applyTpuToMaterials(mv, activeRgb);
  }, [activeRgb]);

  useEffect(() => {
    if (!open) {
      setCamError(null);
      return;
    }
    setTpuId("nero");
    void import("@google/model-viewer");
  }, [open]);

  useEffect(() => {
    if (!open || !shoe) return;
    let cancelled = false;
    setCamError(null);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
        }
      } catch {
        if (!cancelled) {
          setCamError(
            "Fotocamera non disponibile. Usa HTTPS / localhost e concedi l’accesso alla camera posteriore."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      const v = videoRef.current;
      const stream = v?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      if (v) v.srcObject = null;
    };
  }, [open, shoe]);

  useEffect(() => {
    const mv = mvRef.current;
    if (!mv || !open || !shoe) return;
    const onLoad = () => applyTpuToMaterials(mv, activeRgb);
    mv.addEventListener("load", onLoad);
    const t = window.setTimeout(onLoad, 400);
    return () => {
      mv.removeEventListener("load", onLoad);
      window.clearTimeout(t);
    };
  }, [open, shoe, shoe?.glbSrc, activeRgb]);

  useEffect(() => {
    applyTint();
  }, [applyTint, tpuId]);

  const handleScan = () => {
    onOpenChange(false);
    onScanFoot();
  };

  if (!open) return null;
  if (!shoe) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose={false}
        className={cn(
          "fixed inset-0 left-0 top-0 z-[96] flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white shadow-none",
          "data-[state=open]:slide-in-from-bottom-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:zoom-in-100"
        )}
      >
        <div className="relative min-h-0 flex-1 bg-black">
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            playsInline
            muted
            autoPlay
          />
          <div className="pointer-events-none absolute inset-0 bg-black/50" aria-hidden />

          {camError ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 px-6">
              <p className="max-w-sm text-center text-sm text-zinc-300">{camError}</p>
            </div>
          ) : null}

          <div className="absolute inset-0 z-[11] flex flex-col items-center justify-center px-3 pt-14 pb-36">
            <p className="pointer-events-none mb-2 max-w-md text-center font-mono text-[10px] uppercase tracking-[0.22em] text-sky-400/90">
              Prova virtuale · {shoe.name}
            </p>
            <div key={shoe.id} className="h-[min(52dvh,440px)] w-full max-w-lg">
              {React.createElement("model-viewer", {
                ref: mvRef,
                src: shoe.glbSrc,
                alt: shoe.name,
                "camera-controls": true,
                "touch-action": "pan-y",
                "shadow-intensity": "1",
                exposure: "1",
                "environment-image": "neutral",
                "interaction-prompt": "none",
                ar: true,
                "ar-modes": "webxr scene-viewer quick-look",
                style: {
                  width: "100%",
                  height: "100%",
                  backgroundColor: "transparent",
                  ["--poster-color" as string]: "transparent",
                } as React.CSSProperties,
              })}
            </div>
          </div>

          <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex justify-end p-3">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="pointer-events-auto h-11 w-11 rounded-full border border-white/10 bg-black/40 text-white shadow-lg backdrop-blur-md hover:bg-black/60"
              onClick={() => onOpenChange(false)}
              aria-label="Chiudi prova virtuale"
            >
              <X className="h-6 w-6" strokeWidth={2} />
            </Button>
          </div>

          <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-white/10 bg-black/40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-md">
            <p className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-sky-400/85">
              Colore filamento TPU
            </p>
            <div className="mb-5 flex items-center justify-center gap-5">
              {TPU_SWATCHES.map((s) => {
                const active = s.id === tpuId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setTpuId(s.id)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                      active && "scale-105"
                    )}
                    aria-label={s.label}
                    aria-pressed={active}
                  >
                    <span
                      className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-full border-2 shadow-lg transition-transform",
                        active
                          ? "border-sky-400 shadow-sky-500/40 ring-2 ring-sky-500/50"
                          : "border-white/20 hover:border-sky-500/50"
                      )}
                      style={{
                        background:
                          s.id === "nero"
                            ? "linear-gradient(145deg,#1a1a1c,#0a0a0c)"
                            : s.id === "blu"
                              ? "linear-gradient(145deg,#2563eb,#1d4ed8)"
                              : "linear-gradient(145deg,#71717a,#52525b)",
                      }}
                    />
                    <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-400">{s.label}</span>
                  </button>
                );
              })}
            </div>

            <Button
              type="button"
              className="h-auto w-full rounded-xl bg-sky-500 py-5 font-mono text-sm font-bold uppercase tracking-[0.12em] text-white shadow-lg shadow-sky-500/35 hover:bg-sky-400 active:bg-sky-600"
              onClick={handleScan}
            >
              VOGLIO QUESTA! SCANSIONA IL PIEDE
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
