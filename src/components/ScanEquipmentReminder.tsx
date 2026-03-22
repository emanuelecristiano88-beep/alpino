"use client";

import React from "react";
import { FileText, PanelTop, Printer, Smartphone } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

type ScanEquipmentReminderProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dopo conferma → apri il video briefing */
  onContinue: () => void;
};

const ITEMS = [
  {
    Icon: Printer,
    title: "Foglio NEUMA stampato",
    text: "Stampa il target A4 dalla Guida stampa (scala 100%, marker ArUco visibili).",
  },
  {
    Icon: PanelTop,
    title: "Superficie rigida",
    text: "Appoggia il foglio su un tavolo piatto, senza pieghe.",
  },
  {
    Icon: Smartphone,
    title: "Telefono / tablet per le foto",
    text: "Serve un dispositivo con fotocamera per scattare (anche su PC apri il browser dal telefono per la sessione reale).",
  },
];

/**
 * Mostrato quando l’onboarding profilo è già in localStorage ma serve comunque
 * ricordare foglio + setup prima del briefing (es. primo utilizzo su un nuovo PC).
 */
export default function ScanEquipmentReminder({ open, onOpenChange, onContinue }: ScanEquipmentReminderProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border border-zinc-200 bg-[#e5e5e5] sm:max-w-md" showClose>
        <DialogHeader>
          <DialogTitle className="text-lg text-zinc-900">Materiale per la scansione</DialogTitle>
          <DialogDescription className="text-left text-sm text-zinc-600">
            Prima di aprire la camera, assicurati di avere tutto pronto — vale su{" "}
            <strong className="text-zinc-800">computer</strong> e <strong className="text-zinc-800">smartphone</strong>.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-3">
          {ITEMS.map(({ Icon, title, text }) => (
            <li
              key={title}
              className="flex gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-sm"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-900">
                <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-zinc-900">{title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-600">{text}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="rounded-lg border border-blue-200 bg-blue-50/90 px-3 py-2 text-xs leading-relaxed text-blue-950">
          <FileText className="mr-1 inline h-3.5 w-3.5 align-text-bottom text-blue-700" aria-hidden />
          Se non hai ancora stampato: Menu → <strong>Guida stampa &amp; calibrazione A4</strong> per scaricare il foglio.
        </p>

        <Button
          type="button"
          className="w-full bg-[#2563eb] font-semibold text-white hover:brightness-110"
          onClick={() => onContinue()}
        >
          Ho il materiale — continua al briefing
        </Button>
      </DialogContent>
    </Dialog>
  );
}
