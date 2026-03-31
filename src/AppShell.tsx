"use client";

import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Book,
  Compass,
  FileText,
  Folder,
  Globe,
  Layers,
  Menu as MenuIcon,
  ScanLine,
  Sparkles,
  X,
} from "lucide-react";

const ScannerCattura = lazy(() => import("./ScannerCattura"));
import LibraryScreen from "./screens/LibraryScreen";
import NeumaOnboarding from "./components/NeumaOnboarding";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { cn } from "./lib/utils";
import { discardCameraStreamHandoff, setCameraStreamHandoff } from "./lib/cameraStreamHandoff";
import NeumaLogo from "./components/NeumaLogo";
import LandingPage from "./pages/LandingPage";
import ScanModeSelectScreen, { type ScanMode } from "./components/ScanModeSelectScreen";
import ScanOnboardingSlides from "./components/ScanOnboardingSlides";
import { setScanMode as persistScanMode } from "./lib/scanMode";

type TabId = "library" | "albums" | "explore" | "menu";

const NAV_ITEMS: { id: TabId; label: string; Icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  { id: "library", label: "Home", Icon: Book },
  { id: "albums", label: "Albums", Icon: Folder },
  { id: "explore", label: "Explore", Icon: Globe },
  { id: "menu", label: "Menu", Icon: MenuIcon },
];

function BottomNav({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const items = useMemo(() => NAV_ITEMS, []);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-black/75 backdrop-blur-xl">
      <div className="mx-auto grid w-full max-w-lg grid-cols-4 px-2 pb-[env(safe-area-inset-bottom,0px)] pt-1">
        {items.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <Button
              key={id}
              type="button"
              variant="ghost"
              className={cn(
                "neuma-touch flex h-auto flex-col gap-1 rounded-2xl py-3 text-[#e5e5e5]/65 hover:bg-white/[0.05] hover:text-white",
                active && "text-white"
              )}
              onClick={() => setTab(id)}
              aria-current={active ? "page" : undefined}
            >
              <span
                className={cn(
                  "neuma-anim flex h-11 w-11 items-center justify-center rounded-2xl",
                  active && "bg-white/12 text-white shadow-[0_18px_60px_rgba(0,0,0,0.55)]"
                )}
              >
                <Icon className={cn("h-6 w-6", active ? "text-white" : "text-current")} strokeWidth={active ? 2 : 1.75} />
              </span>
              <span className={cn("text-[10px] font-medium", active ? "font-semibold text-white" : "text-zinc-500")}>
                {label}
              </span>
            </Button>
          );
        })}
      </div>
    </nav>
  );
}

function MenuScreen({ onOpenScanner }: { onOpenScanner: () => void }) {
  return (
    <div className="min-h-[100dvh] bg-black pb-24 text-white">
      <div className="px-5 pt-6">
        <NeumaLogo size="md" className="mb-6" />
        <div className="text-4xl font-semibold tracking-tight text-white">Menu</div>
        <p className="mt-2 text-base text-[#e5e5e5]">Esperienza di scansione e fitting.</p>
        <Button
          type="button"
          variant="default"
          size="lg"
          className="mt-8 w-full rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm hover:bg-white/15"
          onClick={onOpenScanner}
        >
          APRI SCANNER
        </Button>

        <div className="mt-8 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-white/55">Informazioni</p>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 rounded-xl border-white/15 bg-white/[0.04] text-[#e5e5e5] hover:bg-white/[0.08]"
            asChild
          >
            <Link to="/tecnologia-tpu">
              <Layers className="h-4 w-4 shrink-0 text-white/80" />
              Tecnologia TPU &amp; stampanti 3D
            </Link>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 rounded-xl border-white/15 bg-white/[0.04] text-[#e5e5e5] hover:bg-white/[0.08]"
            asChild
          >
            <Link to="/guida-stampa">
              <FileText className="h-4 w-4 shrink-0 text-white/80" />
              Guida stampa &amp; calibrazione A4
            </Link>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 rounded-xl border-white/15 bg-white/[0.04] text-[#e5e5e5] hover:bg-white/[0.08]"
            asChild
          >
            <Link to="/prepara-scansione">
              <Book className="h-4 w-4 shrink-0 text-white/80" />
              Prepara scansione (privacy)
            </Link>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 rounded-xl border-white/15 bg-white/[0.04] text-[#e5e5e5] hover:bg-white/[0.08]"
            asChild
          >
            <Link to="/guida-scansione">
              <ScanLine className="h-4 w-4 shrink-0 text-white/80" />
              Guida: come scansionare il piede
            </Link>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 rounded-xl border-white/15 bg-white/[0.04] text-[#e5e5e5] hover:bg-white/[0.08]"
            asChild
          >
            <Link to="/bussola-del-piede">
              <Compass className="h-4 w-4 shrink-0 text-white/80" />
              Bussola del piede
            </Link>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 rounded-xl border-white/15 bg-white/[0.04] text-[#e5e5e5] hover:bg-white/[0.08]"
            asChild
          >
            <Link to="/su-misura">
              <Sparkles className="h-4 w-4 shrink-0 text-white/80" />
              Calzature su misura
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function PlaceholderScreen({ title }: { title: string }) {
  return (
    <div className="min-h-[100dvh] bg-black pb-24 text-white">
      <div className="px-5 pt-6">
        <NeumaLogo size="sm" className="mb-5 opacity-90" />
        <div className="text-4xl font-semibold tracking-tight text-white">{title}</div>
        <p className="mt-2 text-base text-[#e5e5e5]">Schermata in arrivo.</p>
      </div>
    </div>
  );
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("library");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanModeOpen, setScanModeOpen] = useState(false);
  const [scanMode, setScanMode] = useState<ScanMode | null>(null);
  const [scanSlidesOpen, setScanSlidesOpen] = useState(false);
  const orientationLockAttemptedRef = useRef(false);
  const [blockScannerLandscape, setBlockScannerLandscape] = useState(false);

  useEffect(() => {
    const tryLockPortrait = () => {
      if (orientationLockAttemptedRef.current) return;
      orientationLockAttemptedRef.current = true;

      try {
        const maybeScreen: { orientation?: { lock?: (o: OrientationLockType) => Promise<void> } } | null =
          typeof window !== "undefined" ? window.screen : null;
        const orient = maybeScreen?.orientation;
        const lockFn = orient?.lock;
        if (typeof lockFn === "function") {
          const p = lockFn.call(orient, "portrait");
          if (p && typeof (p as Promise<void>).catch === "function") {
            (p as Promise<void>).catch(() => {});
          }
        }
      } catch {}
    };

    tryLockPortrait();

    const onFirstGesture = () => tryLockPortrait();
    window.addEventListener("pointerdown", onFirstGesture, { once: true });
    window.addEventListener("touchstart", onFirstGesture, { once: true });

    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("touchstart", onFirstGesture);
    };
  }, []);

  useEffect(() => {
    if (!scannerOpen) {
      setBlockScannerLandscape(false);
      return;
    }
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice) return;

    const check = () => {
      const isLandscape = window.innerWidth > window.innerHeight;
      setBlockScannerLandscape(isLandscape);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [scannerOpen]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ scanId?: string }>).detail;
      setScannerOpen(false);
      discardCameraStreamHandoff();
      if (detail?.scanId) {
        navigate("/su-misura", { state: { scanId: detail.scanId } });
      } else {
        navigate("/su-misura");
      }
    };
    window.addEventListener("neuma:scan-proceed", handler);
    return () => window.removeEventListener("neuma:scan-proceed", handler);
  }, [navigate]);

  useEffect(() => {
    const st = location.state as { autoStartScan?: boolean } | null | undefined;
    if (st?.autoStartScan) {
      setOnboardingOpen(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  const openScannerFlow = () => {
    setScanMode(null);
    setScanModeOpen(true);
  };

  const finishOnboardingAndOpenTutorial = () => {
    setOnboardingOpen(false);
    setScanSlidesOpen(true);
  };

  const finishSlidesAndStartScan = () => {
    setScanSlidesOpen(false);
    discardCameraStreamHandoff();
    setScannerOpen(true);
  };

  const isLandingRoute = location.pathname === "/";

  return (
    <div className="min-h-[100dvh] bg-black">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1200px 700px at 50% -10%, rgba(59,130,246,0.16) 0%, rgba(0,0,0,0) 55%), radial-gradient(1000px 700px at 10% 30%, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0) 55%), radial-gradient(900px 600px at 90% 40%, rgba(16,185,129,0.06) 0%, rgba(0,0,0,0) 55%)",
        }}
      />
      {tab === "library" ? (isLandingRoute ? <LandingPage /> : <LibraryScreen onOpenScanner={openScannerFlow} />) : null}
      {tab === "albums" ? <PlaceholderScreen title="Albums" /> : null}
      {tab === "explore" ? <PlaceholderScreen title="Explore" /> : null}
      {tab === "menu" ? <MenuScreen onOpenScanner={openScannerFlow} /> : null}

      {isLandingRoute ? null : <BottomNav tab={tab} setTab={setTab} />}

      <NeumaOnboarding
        open={onboardingOpen}
        onOpenChange={setOnboardingOpen}
        onComplete={finishOnboardingAndOpenTutorial}
      />

      <Dialog open={scanSlidesOpen} onOpenChange={setScanSlidesOpen}>
        <DialogContent
          showClose={false}
          className="fixed inset-0 left-0 top-0 z-[95] flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 shadow-none data-[state=open]:slide-in-from-bottom-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:zoom-in-100"
        >
          <DialogTitle className="sr-only">Onboarding scansione</DialogTitle>
          <DialogDescription className="sr-only">Guida introduttiva alla scansione del piede</DialogDescription>
          <ScanOnboardingSlides onComplete={finishSlidesAndStartScan} />
        </DialogContent>
      </Dialog>

      <Dialog
        open={scanModeOpen}
        onOpenChange={(open) => {
          setScanModeOpen(open);
          if (!open) setScanMode(null);
        }}
      >
        <DialogContent
          showClose={false}
          className="fixed inset-0 left-0 top-0 z-[95] flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 shadow-none data-[state=open]:slide-in-from-bottom-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:zoom-in-100"
        >
          <DialogTitle className="sr-only">Scegli modalità scansione</DialogTitle>
          <DialogDescription className="sr-only">Seleziona la modalità di scansione</DialogDescription>
          <ScanModeSelectScreen
            selected={scanMode}
            onSelect={setScanMode}
            onClose={() => setScanModeOpen(false)}
            onContinue={() => {
              const mode = scanMode;
              setScanModeOpen(false);
              if (!mode) return;
              persistScanMode(mode);
              if (mode === "assistant") {
                navigate("/scanner-operatore");
                return;
              }
              setOnboardingOpen(true);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Scanner: NO Radix Dialog — plain fullscreen div to avoid portal/animation/compositor issues on Android.
          IMPORTANT: NO overflow-hidden on this wrapper — it clips fixed-positioned video on Android Chrome. */}
      {scannerOpen ? (
        <div className="fixed inset-0 z-[100] h-[100dvh] w-[100vw] bg-black">
          <div className="pointer-events-none absolute left-0 right-0 top-0 z-[110] flex justify-end p-3">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="pointer-events-auto h-11 w-11 rounded-full border border-white/10 bg-zinc-900/80 text-white shadow-lg hover:bg-zinc-800"
              onClick={() => {
                setScannerOpen(false);
                discardCameraStreamHandoff();
              }}
              aria-label="Chiudi scanner"
            >
              <X className="h-6 w-6" strokeWidth={2} />
            </Button>
          </div>
          <div className="relative h-full w-full">
            <Suspense fallback={<div className="flex h-full w-full items-center justify-center bg-black"><div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/70" /></div>}>
              <ScannerCattura />
            </Suspense>
            {blockScannerLandscape ? (
              <div className="pointer-events-none absolute inset-0 z-[120] flex items-center justify-center bg-black/25 px-6">
                <div className="text-center">
                  <div className="text-lg font-semibold tracking-tight text-white sm:text-xl">
                    Ruota il telefono in verticale
                  </div>
                  <div className="mt-2 text-sm text-white/70">
                    La fotocamera si avvia comunque: in verticale vedrai l'inquadratura completa.
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
