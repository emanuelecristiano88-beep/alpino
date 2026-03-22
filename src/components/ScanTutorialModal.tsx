"use client";

import React from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { SCAN_PHASE_TUTORIAL_BLURB } from "../constants/scanCapturePhases";
import FootPlacementGuideVisual from "./FootPlacementGuideVisual";
import ScanTutorialSceneVisual from "./ScanTutorialSceneVisual";

type ScanTutorialModalProps = {
  open: boolean;
  onDismiss: () => void;
};

const STEPS = [
  {
    title: "Preparazione",
    text: "Due persone; foglio NEUMA stampato al 100%; piede nell’area; tutti e 4 i marker ArUco sempre in inquadratura.",
  },
  {
    title: "1 · Vista dall’alto",
    text: SCAN_PHASE_TUTORIAL_BLURB[0],
  },
  {
    title: "2 · Vista laterale esterna",
    text: SCAN_PHASE_TUTORIAL_BLURB[1],
  },
  {
    title: "3 · Vista laterale interna e arco",
    text: SCAN_PHASE_TUTORIAL_BLURB[2],
  },
  {
    title: "4 · Vista posteriore e tallone",
    text: SCAN_PHASE_TUTORIAL_BLURB[3],
  },
  {
    title: "Invio",
    text: "Completa le 4 fasi per piede; ripeti per l’altro piede se richiesto e attendi la fine dell’upload.",
  },
];

export default function ScanTutorialModal({ open, onDismiss }: ScanTutorialModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => isOpen === false && onDismiss()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md" showClose>
        <DialogHeader>
          <DialogTitle id="scan-tutorial-title">Prima di iniziare</DialogTitle>
          <DialogDescription className="sr-only">
            Leggi i passaggi: cliente fermo sul foglio, operatore con telefono. Poi avvia la scansione.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-left text-xs leading-snug text-blue-950 sm:text-sm">
          <strong className="font-semibold">Materiale:</strong> foglio NEUMA stampato (Guida stampa) · telefono con fotocamera
          · superficie rigida. Su PC puoi leggere il briefing; per la scansione reale usa il telefono come da istruzioni.
        </div>

        <Card className="border-0 shadow-none">
          <CardHeader className="space-y-4 pb-2">
            <ScanTutorialSceneVisual />
            <div className="border-t border-dashed border-zinc-200 pt-4 dark:border-zinc-700">
              <p className="mb-2 text-center text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Foglio NEUMA (target A4 · marker ArUco)
              </p>
              <FootPlacementGuideVisual showRoleCaptions={false} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-0 pt-2">
            {STEPS.map((step, i) => (
              <div key={i} className="flex gap-3 text-left">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" strokeWidth={2} />
                <div>
                  <p className="text-sm font-semibold leading-snug">{step.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
                </div>
              </div>
            ))}
          </CardContent>
          <CardFooter className="mt-6 flex-col gap-3 p-0">
            <p className="text-center text-xs text-muted-foreground">
              <Link
                to="/guida-scansione"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Illustrazioni delle 4 fasi (guida completa)
              </Link>
            </p>
            <Button type="button" onClick={onDismiss} className="w-full sm:w-auto">
              Inizia scansione
            </Button>
          </CardFooter>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
