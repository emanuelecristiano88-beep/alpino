"use client";

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, ChevronDown, Plus, MoreHorizontal, X, CheckCircle2 } from "lucide-react";
import HomeScanHero from "../components/HomeScanHero";
import NeumaLogo from "../components/NeumaLogo";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter } from "../components/ui/card";
import { Dialog, DialogContent } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Slider } from "../components/ui/slider";
import { cn } from "../lib/utils";
import { PAIR_STORAGE_KEY } from "../constants/scan";
import BiometricAnalysisPanel from "../components/BiometricAnalysisPanel";
import ScanFootprint2D from "../components/ScanFootprint2D";
import { useScanMetrics } from "../hooks/useScanMetrics";
import VirtualTryOnViewer from "../components/VirtualTryOnViewer";
import { SHOE_CATALOG, type ShoeCatalogItem } from "../data/shoeCatalog";

const DigitalFittingViewer = lazy(() => import("../../components/three/DigitalFittingViewer"));

const FITTING_STATIC = {
  tagliaConsigliata: "EU 42",
  filamentoTpuG: 110,
} as const;

type ScanItem = {
  id: string;
  dateLabel: string;
  thumbSeed: number;
};

function SquareThumbPlaceholder({ seed }: { seed: number }) {
  const bg = useMemo(() => {
    const t = (seed * 13) % 14;
    return `linear-gradient(145deg, rgb(${32 + t}, ${32 + t}, ${34 + t}), rgb(${18 + t}, ${18 + t}, ${22 + t}))`;
  }, [seed]);

  return (
    <div
      className="aspect-square w-full rounded-md border border-white/10 bg-white/[0.04] shadow-inner"
      style={{ backgroundImage: bg }}
    />
  );
}

type LibraryScreenProps = {
  onOpenScanner: () => void;
};

export default function LibraryScreen({ onOpenScanner }: LibraryScreenProps) {
  const { metrics: scanMetrics, refresh: refreshScanMetrics } = useScanMetrics();
  const viewerMetrics = useMemo(
    () => ({
      footLengthMm: scanMetrics.lunghezzaMm,
      forefootWidthMm: scanMetrics.larghezzaMm,
    }),
    [scanMetrics.larghezzaMm, scanMetrics.lunghezzaMm]
  );

  const [query, setQuery] = useState("");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedScan, setSelectedScan] = useState<ScanItem | null>(null);
  const [shoeTransparency, setShoeTransparency] = useState(35);
  const [coloreSelezionato, setColoreSelezionato] = useState("Nero TPU");
  const [orderSending, setOrderSending] = useState(false);
  const [orderSent, setOrderSent] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [showSuccessFx, setShowSuccessFx] = useState(false);
  /** Paio SX+DX caricato dallo scanner (sessionStorage). */
  const [pairReadyForProduction, setPairReadyForProduction] = useState(false);
  const [arViewerOpen, setArViewerOpen] = useState(false);
  const [arSelectedShoe, setArSelectedShoe] = useState<ShoeCatalogItem | null>(null);

  const refreshPairFlag = useCallback(() => {
    try {
      setPairReadyForProduction(typeof sessionStorage !== "undefined" && sessionStorage.getItem(PAIR_STORAGE_KEY) === "true");
    } catch {
      setPairReadyForProduction(false);
    }
  }, []);

  useEffect(() => {
    refreshPairFlag();
    window.addEventListener("focus", refreshPairFlag);
    return () => window.removeEventListener("focus", refreshPairFlag);
  }, [refreshPairFlag]);

  useEffect(() => {
    if (viewerOpen) refreshPairFlag();
  }, [viewerOpen, refreshPairFlag]);

  useEffect(() => {
    if (viewerOpen) refreshScanMetrics();
  }, [viewerOpen, refreshScanMetrics]);

  const items: ScanItem[] = useMemo(
    () =>
      Array.from({ length: 2 }, (_, i) => ({
        id: `scan-${i + 1}`,
        dateLabel: "20 mar 2026",
        thumbSeed: i + 1,
      })),
    []
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.id.toLowerCase().includes(q));
  }, [items, query]);

  const openViewer = (it: ScanItem) => {
    setSelectedScan(it);
    setViewerOpen(true);
  };

  const closeViewer = () => {
    setViewerOpen(false);
    setSelectedScan(null);
    setOrderSending(false);
    setOrderSent(false);
    setOrderError(null);
    setShowSuccessFx(false);
  };

  const sendToProduction = useCallback(async () => {
    if (!selectedScan || orderSent || orderSending) return;
    setOrderError(null);
    setOrderSending(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId: selectedScan.id,
          tagliaScelta: FITTING_STATIC.tagliaConsigliata,
          coloreSelezionato,
          millimetri: {
            lunghezzaMm: scanMetrics.lunghezzaMm,
            larghezzaMm: scanMetrics.larghezzaMm,
            altezzaArcoMm: scanMetrics.altezzaArcoMm,
            circonferenzaColloMm: scanMetrics.circonferenzaColloMm,
            volumeCm3: scanMetrics.volumeCm3,
            filamentoTpuG: FITTING_STATIC.filamentoTpuG,
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setOrderSent(true);
      setShowSuccessFx(true);
      window.setTimeout(() => setShowSuccessFx(false), 2800);
    } catch (e: unknown) {
      setOrderError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrderSending(false);
    }
  }, [selectedScan, coloreSelezionato, orderSent, orderSending, scanMetrics]);

  return (
    <div className="min-h-[100dvh] bg-black pb-28 text-white">
      <div className="px-5 pt-5">
        <header className="mb-2 flex items-center justify-between">
          <NeumaLogo variant="dark" size="lg" />
        </header>
        <HomeScanHero onOpenScanner={onOpenScanner} />

        <section className="mt-8" aria-labelledby="catalogo-scarpe-heading">
          <h2 id="catalogo-scarpe-heading" className="text-lg font-semibold tracking-tight text-white">
            Catalogo modelli
          </h2>
          <p className="mt-1 text-sm text-[#e5e5e5]">Prova virtualmente in AR prima di personalizzare la tua scarpa.</p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-2">
            {SHOE_CATALOG.map((shoe) => (
              <Card
                key={shoe.id}
                className="overflow-hidden border border-white/10 bg-white/[0.04] shadow-none"
              >
                <CardContent className="space-y-3 p-4">
                  <div
                    className={cn(
                      "relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg",
                      "bg-white/[0.06]"
                    )}
                  >
                    {shoe.previewSrc ? (
                      <img
                        src={shoe.previewSrc}
                        alt={shoe.name}
                        className={cn(
                          "max-h-full max-w-full object-contain object-center",
                          /** PNG con sfondo nero: fondi con il grigio della card (stesso risultato visivo di uno sfondo #e5e5e5) */
                          shoe.previewMergeBlackWithCard && "mix-blend-screen"
                        )}
                        loading="lazy"
                      />
                    ) : null}
                  </div>
                  <div>
                    <p className="font-semibold text-white">{shoe.name}</p>
                    <p className="text-xs text-[#e5e5e5]">{shoe.subtitle}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      className="w-full rounded-full border border-white/20 bg-white/10 text-sm font-semibold tracking-wide text-white hover:bg-white/15"
                      onClick={() => {
                        setArSelectedShoe(shoe);
                        setArViewerOpen(true);
                      }}
                    >
                      Prova in AR
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <h1 className="mt-10 text-2xl font-semibold tracking-tight text-white">Le tue scansioni</h1>

        <div className="relative mt-4">
          <div className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-white/40">
            <Search className="h-5 w-5" strokeWidth={2} />
          </div>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca"
            className="h-12 rounded-full border border-white/15 bg-white/[0.06] pl-10 text-white placeholder:text-white/40"
          />
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          <Button variant="ghost" size="sm" className="h-auto gap-1 px-0 font-medium text-[#e5e5e5]/80 hover:bg-transparent hover:text-white">
            Filtri
            <ChevronDown className="h-4 w-4" strokeWidth={2} />
          </Button>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" className="h-auto gap-1 px-0 font-semibold text-white hover:bg-transparent hover:text-white">
              Data
              <ChevronDown className="h-4 w-4 opacity-70" strokeWidth={2} />
            </Button>
            <Button variant="ghost" size="sm" className="h-auto px-0 font-medium text-[#e5e5e5]/80 hover:bg-transparent hover:text-white">
              Seleziona
            </Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          {filtered.map((it) => (
            <Card
              key={it.id}
              className="group overflow-hidden border border-white/10 bg-white/[0.04] shadow-none transition-colors duration-200 hover:border-white/20"
            >
              <CardContent className="p-2">
                <button
                  type="button"
                  onClick={() => openViewer(it)}
                  className="w-full overflow-hidden rounded-md text-left ring-offset-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black group-hover:ring-2 group-hover:ring-white/25"
                  aria-label={`Apri visualizzatore 3D per ${it.id}`}
                >
                  <SquareThumbPlaceholder seed={it.thumbSeed} />
                </button>
              </CardContent>
              <CardFooter className="flex items-center justify-between gap-2 border-t-0 p-2 pt-0">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Badge
                    variant="secondary"
                    className="shrink-0 border border-white/15 bg-white/[0.08] text-[10px] font-semibold uppercase tracking-wide text-white/90"
                  >
                    Completato
                  </Badge>
                  <span className="truncate text-xs font-semibold text-[#e5e5e5]">{it.dateLabel}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-white/45 hover:text-white"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Opzioni"
                >
                  <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>

      <Button
        type="button"
        size="icon-lg"
        variant="default"
        className="fixed bottom-24 right-6 z-40 rounded-full border border-white/20 bg-white/10 text-white shadow-lg shadow-black/40 backdrop-blur-sm hover:bg-white/15"
        onClick={onOpenScanner}
        aria-label="Nuova scansione"
      >
        <Plus className="h-9 w-9" strokeWidth={2.5} />
      </Button>

      <Dialog
        open={viewerOpen}
        onOpenChange={(open) => {
          if (!open) closeViewer();
        }}
      >
        <DialogContent
          showClose={false}
          className={cn(
            "fixed inset-0 left-0 top-0 z-[95] flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-zinc-950 p-0 text-white shadow-none",
            "data-[state=open]:slide-in-from-bottom-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:zoom-in-100"
          )}
        >
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="absolute left-0 top-0 z-20 flex w-full items-start justify-between p-4">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-11 w-11 rounded-full border border-white/10 bg-zinc-900/90 text-white shadow-lg backdrop-blur-sm hover:bg-zinc-800"
                onClick={closeViewer}
                aria-label="Chiudi visualizzatore"
              >
                <X className="h-6 w-6" strokeWidth={2} />
              </Button>
              <div id="fitting-viewer-title" className="sr-only">
                Fitting digitale {selectedScan?.id ?? ""}
              </div>
            </div>

            {viewerOpen ? (
              <div className="flex min-h-0 flex-1 flex-col pt-2 md:flex-row">
                {/* Viewer 3D + v6 + plantare 2D ~70% (ref. dashboard biometrica) */}
                <div className="relative flex min-h-[42dvh] w-full min-w-0 flex-col md:w-[70%] md:flex-[0_0_70%] md:min-h-0">
                  <div className="relative flex min-h-[280px] flex-1 flex-row items-stretch md:min-h-0">
                    <div className="relative min-h-[240px] min-w-0 flex-1">
                      <Suspense
                        fallback={
                          <div className="flex min-h-[50dvh] items-center justify-center text-sm text-zinc-400 md:absolute md:inset-0 md:min-h-0">
                            Caricamento viewer 3D…
                          </div>
                        }
                      >
                        <DigitalFittingViewer
                          shoeTransparencyPercent={shoeTransparency}
                          metrics={viewerMetrics}
                          className="absolute inset-0 min-h-[280px] w-full md:min-h-0"
                        />
                      </Suspense>
                    </div>
                    <div
                      className="relative z-10 flex w-11 shrink-0 flex-col items-center justify-center border-x border-zinc-800/70 bg-zinc-950/50"
                      aria-hidden
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-600/95 text-[10px] font-semibold lowercase tracking-tight text-white shadow-md">
                        {(scanMetrics.scanVersion ?? "v6").replace(/^V/i, "v")}
                      </div>
                    </div>
                    <div className="flex w-[92px] shrink-0 flex-col items-center justify-center border-l border-zinc-800/70 bg-zinc-950/60 px-1.5 md:w-[118px]">
                      <ScanFootprint2D className="max-h-[min(200px,28dvh)] w-full opacity-95" />
                      <span className="mt-1 text-[8px] font-medium uppercase tracking-[0.2em] text-zinc-500">Plantare</span>
                    </div>
                  </div>
                </div>

                {/* Pannello dati ~30% + Conferma flottante (fuori card, ref.) */}
                <div className="relative flex max-h-[55dvh] min-h-0 w-full flex-col border-t border-zinc-800 pb-20 md:max-h-none md:w-[30%] md:flex-[0_0_30%] md:border-l md:border-t-0 md:pb-24">
                  <BiometricAnalysisPanel
                    metrics={scanMetrics}
                    hideConfirmButton
                    className="h-full min-h-0 flex-1 overflow-hidden rounded-none border-0 border-zinc-800/0 bg-zinc-900/50 shadow-none md:max-h-[calc(100dvh-8rem)]"
                  />
                  <Button
                    type="button"
                    className="absolute bottom-4 right-4 z-20 rounded-full border border-white/20 bg-white/10 px-8 py-6 text-sm font-semibold text-white shadow-lg backdrop-blur-sm hover:bg-white/15 md:bottom-6 md:right-5"
                    onClick={() => {
                      document.getElementById("neuma-production-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    Conferma
                  </Button>
                </div>
              </div>
            ) : null}

            <div
              id="neuma-production-panel"
              className="border-t border-zinc-800 bg-zinc-950/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-md"
            >
              <div className="mx-auto max-w-md space-y-4">
                <div className="space-y-3">
                  <Label className="text-zinc-100">Trasparenza scarpa (fitting)</Label>
                  <div className="flex items-center gap-3">
                    <span className="w-12 shrink-0 text-xs text-zinc-500">Opaco</span>
                    <Slider
                      value={[shoeTransparency]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={(v) => setShoeTransparency(v[0] ?? 0)}
                      className="flex-1"
                    />
                    <span className="w-14 shrink-0 text-right text-xs text-zinc-500">Trasparente</span>
                  </div>
                  <p className="text-center text-xs text-white/70">{shoeTransparency}%</p>
                </div>

                <Card className="border-zinc-800 bg-zinc-900 text-xs text-zinc-200 shadow-none">
                  <CardContent className="grid gap-3 p-4">
                    <div className="flex justify-between gap-4 border-b border-zinc-800 pb-2">
                      <span className="text-zinc-400">Volume piede</span>
                      <span className="font-semibold text-white">{scanMetrics.volumeCm3} cm³</span>
                    </div>
                    <div className="flex justify-between gap-4 border-b border-zinc-800 pb-2">
                      <span className="text-zinc-400">Taglia consigliata</span>
                      <span className="font-semibold text-white">{FITTING_STATIC.tagliaConsigliata}</span>
                    </div>
                    <div className="flex justify-between gap-4 border-b border-zinc-800 pb-2">
                      <span className="text-zinc-400">L × W (lung. × pianta)</span>
                      <span className="font-semibold text-white">
                        {scanMetrics.lunghezzaMm} × {scanMetrics.larghezzaMm} mm
                      </span>
                    </div>
                    <div className="flex justify-between gap-4 border-b border-zinc-800 pb-2">
                      <span className="text-zinc-400">Arco · Circonferenza collo</span>
                      <span className="font-semibold text-white">
                        {scanMetrics.altezzaArcoMm} mm · {scanMetrics.circonferenzaColloMm} mm
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-zinc-400">Filamento TPU stimato</span>
                      <span className="font-semibold text-white">{FITTING_STATIC.filamentoTpuG} g</span>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-2">
                  <Label htmlFor="filament-color" className="text-xs text-zinc-400">
                    Colore filamento
                  </Label>
                  <select
                    id="filament-color"
                    value={coloreSelezionato}
                    onChange={(e) => setColoreSelezionato(e.target.value)}
                    disabled={orderSent}
                    className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 ring-offset-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
                  >
                    <option value="Nero TPU">Nero TPU</option>
                    <option value="Bianco TPU">Bianco TPU</option>
                    <option value="Grigio antracite">Grigio antracite</option>
                  </select>
                </div>

                {orderError ? <p className="text-center text-xs text-destructive">{orderError}</p> : null}

                {!pairReadyForProduction && !orderSent ? (
                  <p className="text-center text-xs text-amber-200/90">
                    Completa la scansione del paio (piede sinistro + destro) e invia le foto dallo scanner per abilitare
                    l&apos;invio a NEUMA.
                  </p>
                ) : null}

                <Button
                  type="button"
                  className="w-full font-bold uppercase tracking-wide"
                  size="lg"
                  onClick={sendToProduction}
                  disabled={orderSending || orderSent || !pairReadyForProduction}
                >
                  {orderSent
                    ? "INVIATO A NEUMA"
                    : orderSending
                      ? "Invio in corso…"
                      : "INVIA PAIO IN PRODUZIONE"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <VirtualTryOnViewer
        open={arViewerOpen}
        shoe={arSelectedShoe}
        onOpenChange={(next) => {
          setArViewerOpen(next);
          if (!next) setArSelectedShoe(null);
        }}
        onScanFoot={onOpenScanner}
      />

      <AnimatePresence>
        {viewerOpen && showSuccessFx ? (
          <motion.div
            className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 22 }}
            >
              <Card className="border border-white/15 bg-white/[0.08] shadow-2xl shadow-black/50 backdrop-blur-md">
                <CardContent className="flex flex-col items-center gap-3 px-10 py-8">
                  <CheckCircle2 className="h-16 w-16 text-white" strokeWidth={2} />
                  <p className="text-center text-sm font-semibold text-white">Ordine registrato</p>
                </CardContent>
              </Card>
            </motion.div>
            {Array.from({ length: 48 }).map((_, i) => (
              <motion.span
                key={i}
                className="absolute h-2 w-2 rounded-sm bg-white/80"
                style={{
                  left: `${(i * 7.3) % 100}%`,
                  top: "-20px",
                  opacity: 0.65 + (i % 5) * 0.07,
                }}
                initial={{ y: 0, opacity: 1, rotate: 0 }}
                animate={{
                  y: typeof window !== "undefined" ? window.innerHeight + 40 : 900,
                  opacity: 0.2,
                  rotate: 360 * (i % 2 ? 1 : -1),
                }}
                transition={{
                  duration: 1.8 + (i % 5) * 0.1,
                  delay: (i % 12) * 0.02,
                  ease: "easeIn",
                }}
              />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
