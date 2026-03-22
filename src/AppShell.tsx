"use client";

import React, { useEffect, useMemo, useState } from "react";
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
import ScanEquipmentReminder from "./components/ScanEquipmentReminder";
import ScanTutorialModal from "./components/ScanTutorialModal";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent } from "./components/ui/dialog";
import { cn } from "./lib/utils";
import { NEUMA_UI_BUILD_ID } from "./config/build";
import { isOnboardingV2Complete } from "./lib/neumaUserProfileV2";
import NeumaLogo from "./components/NeumaLogo";

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
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-800 bg-black">
      <div className="mx-auto grid w-full max-w-lg grid-cols-4 px-1 pb-[env(safe-area-inset-bottom,0px)]">
        {items.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <Button
              key={id}
              type="button"
              variant="ghost"
              className={cn(
                "flex h-auto flex-col gap-1 rounded-none py-3 text-zinc-500 hover:bg-transparent hover:text-zinc-300",
                active && "text-white"
              )}
              onClick={() => setTab(id)}
              aria-current={active ? "page" : undefined}
            >
              <span
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-md transition-colors",
                  active && "bg-blue-600 text-white shadow-md shadow-blue-600/25"
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
    <div className="min-h-[100dvh] bg-neutral-200 pb-24 text-zinc-900">
      <div className="px-5 pt-6">
        <NeumaLogo size="md" className="mb-6" />
        <div className="text-2xl font-semibold tracking-tight text-zinc-900">Menu</div>
        <p className="mt-2 text-sm text-zinc-600">
          Scanner fotogrammetrico piede.{" "}
          <span className="text-xs text-blue-600">(build Shadcn + Tailwind)</span>
        </p>
        <p className="mt-2 font-mono text-[10px] text-zinc-500">
          Build: {NEUMA_UI_BUILD_ID} — se non vedi questa riga, Vercel non sta servendo questo repository.
        </p>
        <Button
          type="button"
          variant="default"
          size="lg"
          className="mt-6 w-full bg-blue-600 text-white shadow-md shadow-blue-600/25 hover:bg-blue-700 active:bg-blue-800"
          onClick={onOpenScanner}
        >
          APRI SCANNER
        </Button>

        <div className="mt-8 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Informazioni</p>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 border-neutral-300 bg-white text-zinc-900 hover:bg-neutral-50"
            asChild
          >
            <Link to="/tecnologia-tpu">
              <Layers className="h-4 w-4 shrink-0 text-blue-600" />
              Tecnologia TPU &amp; stampanti 3D
            </Link>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 border-neutral-300 bg-white text-zinc-900 hover:bg-neutral-50"
            asChild
          >
            <Link to="/guida-stampa">
              <FileText className="h-4 w-4 shrink-0 text-blue-600" />
              Guida stampa &amp; calibrazione A4
            </Link>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 border-neutral-300 bg-white text-zinc-900 hover:bg-neutral-50"
            asChild
          >
            <Link to="/prepara-scansione">
              <Book className="h-4 w-4 shrink-0 text-blue-600" />
              Prepara scansione (privacy)
            </Link>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 border-neutral-300 bg-white text-zinc-900 hover:bg-neutral-50"
            asChild
          >
            <Link to="/guida-scansione">
              <ScanLine className="h-4 w-4 shrink-0 text-blue-600" />
              Guida: come scansionare il piede
            </Link>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 border-neutral-300 bg-white text-zinc-900 hover:bg-neutral-50"
            asChild
          >
            <Link to="/bussola-del-piede">
              <Compass className="h-4 w-4 shrink-0 text-blue-600" />
              Bussola del piede
            </Link>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 border-neutral-300 bg-white text-zinc-900 hover:bg-neutral-50"
            asChild
          >
            <Link to="/su-misura">
              <Sparkles className="h-4 w-4 shrink-0 text-blue-600" />
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
    <div className="min-h-[100dvh] bg-neutral-200 pb-24 text-zinc-900">
      <div className="px-5 pt-6">
        <NeumaLogo size="sm" className="mb-5 opacity-90" />
        <div className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</div>
        <p className="mt-2 text-sm text-zinc-600">Schermata in arrivo.</p>
      </div>
    </div>
  );
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("library");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [equipmentReminderOpen, setEquipmentReminderOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  /** Da /prepara-scansione: onboarding (se necessario) → tutorial → scanner. */
  useEffect(() => {
    const st = location.state as { autoStartScan?: boolean } | null | undefined;
    if (st?.autoStartScan) {
      if (isOnboardingV2Complete()) {
        setEquipmentReminderOpen(true);
      } else {
        setOnboardingOpen(true);
      }
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  const openScannerFlow = () => {
    if (isOnboardingV2Complete()) {
      /* Profilo già salvato: mostra comunque il promemoria foglio/telefono (anche su PC) prima del briefing */
      setEquipmentReminderOpen(true);
      return;
    }
    setOnboardingOpen(true);
  };

  const finishEquipmentReminderAndOpenTutorial = () => {
    setEquipmentReminderOpen(false);
    setTutorialOpen(true);
  };

  const finishOnboardingAndOpenTutorial = () => {
    setOnboardingOpen(false);
    setTutorialOpen(true);
  };

  const finishTutorialAndStartScan = () => {
    setTutorialOpen(false);
    setScannerOpen(true);
  };

  return (
    <div className="min-h-[100dvh] bg-neutral-200">
      {tab === "library" ? <LibraryScreen onOpenScanner={openScannerFlow} /> : null}
      {tab === "albums" ? <PlaceholderScreen title="Albums" /> : null}
      {tab === "explore" ? <PlaceholderScreen title="Explore" /> : null}
      {tab === "menu" ? <MenuScreen onOpenScanner={openScannerFlow} /> : null}

      <BottomNav tab={tab} setTab={setTab} />

      <NeumaOnboarding
        open={onboardingOpen}
        onOpenChange={setOnboardingOpen}
        onComplete={finishOnboardingAndOpenTutorial}
      />

      <ScanEquipmentReminder
        open={equipmentReminderOpen}
        onOpenChange={setEquipmentReminderOpen}
        onContinue={finishEquipmentReminderAndOpenTutorial}
      />

      <ScanTutorialModal open={tutorialOpen} onDismiss={finishTutorialAndStartScan} />

      <Dialog open={scannerOpen} onOpenChange={setScannerOpen}>
        <DialogContent
          showClose={false}
          className="fixed inset-0 left-0 top-0 z-[100] flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-zinc-950 p-0 shadow-none data-[state=open]:slide-in-from-bottom-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:zoom-in-100"
        >
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
          <div className="min-h-0 flex-1 overflow-hidden">
            <ScannerCattura />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
