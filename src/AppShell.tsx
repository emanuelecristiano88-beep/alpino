"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
import ScannerCattura from "./ScannerCattura";
import LibraryScreen from "./screens/LibraryScreen";
import NeumaOnboarding from "./components/NeumaOnboarding";
import ScanTutorialModal from "./components/ScanTutorialModal";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog";
import { cn } from "./lib/utils";
import { discardCameraStreamHandoff } from "./lib/cameraStreamHandoff";
import NeumaLogo from "./components/NeumaLogo";
import LandingPage from "./pages/LandingPage";

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
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-black/90 backdrop-blur-md">
      <div className="mx-auto grid w-full max-w-lg grid-cols-4 px-1 pb-[env(safe-area-inset-bottom,0px)]">
        {items.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <Button
              key={id}
              type="button"
              variant="ghost"
              className={cn(
                "flex h-auto flex-col gap-1 rounded-none py-3 text-[#e5e5e5]/65 hover:bg-transparent hover:text-white",
                active && "text-white"
              )}
              onClick={() => setTab(id)}
              aria-current={active ? "page" : undefined}
            >
              <span
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-md transition-colors",
                  active && "bg-white/14 text-white shadow-[0_8px_24px_rgba(255,255,255,0.08)]"
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
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const orientationLockAttemptedRef = useRef(false);
  /** Solo su dispositivi touch: in landscape blocchiamo lo scanner; su desktop no (width > height è normale). */
  const [blockScannerLandscape, setBlockScannerLandscape] = useState(false);

  useEffect(() => {
    // Screen Orientation API: alcuni browser richiedono una gesture utente per la lock.
    // Proviamo subito e facciamo un retry al primo touch/click.
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
            (p as Promise<void>).catch(() => {
              /* NotSupportedError su molti device: ignorato */
            });
          }
        }
      } catch {
        /* lock non disponibile o errore sincrono */
      }
    };

    // Attempt on app start.
    tryLockPortrait();

    // Retry on first user gesture (best effort).
    const onFirstGesture = () => tryLockPortrait();
    window.addEventListener("pointerdown", onFirstGesture, { once: true });
    window.addEventListener("touchstart", onFirstGesture, { once: true });

    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("touchstart", onFirstGesture);
    };
  }, []);

  useEffect(() => {
    const update = () => {
      const landscape = window.innerWidth > window.innerHeight;
      const coarsePointer =
        typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
      // Alcuni iPhone riportano (pointer: fine): usiamo il lato corto come proxy “phone-like”.
      const shortest = Math.min(window.innerWidth, window.innerHeight);
      const phoneLike = coarsePointer || shortest < 600;
      setBlockScannerLandscape(landscape && phoneLike);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : null;
    const onMq = () => update();
    if (mq) {
      if (typeof mq.addEventListener === "function") mq.addEventListener("change", onMq);
      else if (typeof (mq as MediaQueryList & { addListener?: (cb: () => void) => void }).addListener === "function") {
        (mq as MediaQueryList & { addListener: (cb: () => void) => void }).addListener(onMq);
      }
    }
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      if (mq) {
        if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", onMq);
        else if (typeof (mq as MediaQueryList & { removeListener?: (cb: () => void) => void }).removeListener === "function") {
          (mq as MediaQueryList & { removeListener: (cb: () => void) => void }).removeListener(onMq);
        }
      }
    };
  }, []);

  /**
   * Da /prepara-scansione (dopo accordi/privacy): sempre onboarding NEUMA completo
   * (requisiti stampante/foglio/telefono → profilo biometrico → consenso biometria) → tutorial → scanner.
   */
  useEffect(() => {
    const st = location.state as { autoStartScan?: boolean } | null | undefined;
    if (st?.autoStartScan) {
      setOnboardingOpen(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  const openScannerFlow = () => {
    setOnboardingOpen(true);
  };

  const finishOnboardingAndOpenTutorial = () => {
    setOnboardingOpen(false);
    setTutorialOpen(true);
  };

  const finishTutorialAndStartScan = () => {
    const hasPrintedA4 =
      typeof window !== "undefined" ? window.confirm("Hai stampato il foglio A4?") : true;
    if (!hasPrintedA4) {
      return;
    }
    setTutorialOpen(false);
    // Doppio rAF: lascia smontare il portal del tutorial prima del dialog fullscreen scanner
    // (evita overlay/blocco focus su alcuni browser). Il permesso camera è già “warm” dal tap sul tutorial.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setScannerOpen(true));
    });
  };

  const isLandingRoute = location.pathname === "/";

  return (
    <div className="min-h-[100dvh] bg-black">
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

      <ScanTutorialModal open={tutorialOpen} onDismiss={finishTutorialAndStartScan} />

      <Dialog
        open={scannerOpen}
        onOpenChange={(open) => {
          setScannerOpen(open);
          if (!open) discardCameraStreamHandoff();
        }}
      >
        <DialogContent
          showClose={false}
          className="fixed inset-0 left-0 top-0 z-[100] flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-zinc-950 p-0 shadow-none data-[state=open]:slide-in-from-bottom-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:zoom-in-100"
        >
          <DialogTitle className="sr-only">Scanner NEUMA — scansione continua dal video</DialogTitle>
          <div className="pointer-events-none absolute left-0 right-0 top-0 z-[110] flex justify-end p-3">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="pointer-events-auto h-11 w-11 rounded-full border border-white/10 bg-zinc-900/80 text-white shadow-lg backdrop-blur-sm hover:bg-zinc-800"
              onClick={() => setScannerOpen(false)}
              aria-label="Chiudi scanner"
            >
              <X className="h-6 w-6" strokeWidth={2} />
            </Button>
          </div>
          <div className="min-h-0 relative flex-1 overflow-hidden">
            {/* Montiamo sempre lo scanner: su Android in landscape prima non si montava e la camera/handoff non partivano. */}
            <ScannerCattura />
            {blockScannerLandscape ? (
              <div className="pointer-events-none absolute inset-0 z-[120] flex items-center justify-center bg-black/25 px-6">
                <div className="text-center">
                  <div className="text-lg font-semibold tracking-tight text-white sm:text-xl">
                    Ruota il telefono in verticale
                  </div>
                  <div className="mt-2 text-sm text-white/70">
                    La fotocamera si avvia comunque: in verticale vedrai l’inquadratura completa.
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
