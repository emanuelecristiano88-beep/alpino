"use client";

import React from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import TutorialA4GuideVisual from "./TutorialA4GuideVisual";

type ScanTutorialModalProps = {
  open: boolean;
  onDismiss: () => void;
};

const STEPS = [
  {
    title: "📄 Usa un foglio A4 bianco come base",
    text: "Posiziona il piede nudo al centro di un foglio A4 standard. Il foglio deve essere interamente visibile in ogni foto.",
  },
  {
    title: "Piede ben illuminato e dettagliato",
    text: "Scegli un piede ben illuminato, con rughe e texture della pelle visibili per il tracking.",
  },
  {
    title: "Movimento a orbita",
    text: "Muoviti lentamente in un cerchio completo attorno al tuo piede, mantenendo il telefono stabile.",
  },
  {
    title: "Copri angoli e altezze",
    text: "Inclina il telefono verso l’alto e verso il basso durante il movimento per coprire tutte le viste.",
  },
  {
    title: "Piede fermo",
    text: "Tieni il piede perfettamente fermo durante l’intera scansione: non spostarlo o ruotarlo.",
  },
];

export default function ScanTutorialModal({ open, onDismiss }: ScanTutorialModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => isOpen === false && onDismiss()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md" showClose>
        <DialogHeader>
          <DialogTitle id="scan-tutorial-title">Tutorial fotogrammetria piede</DialogTitle>
          <DialogDescription className="sr-only">
            Leggi i passaggi e avvia la scansione quando sei pronto.
          </DialogDescription>
        </DialogHeader>

        <Card className="border-0 shadow-none">
          <CardHeader className="p-0 pb-2">
            <TutorialA4GuideVisual />
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
          <CardFooter className="mt-6 justify-end p-0">
            <Button type="button" onClick={onDismiss} className="w-full sm:w-auto">
              Inizia scansione
            </Button>
          </CardFooter>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
