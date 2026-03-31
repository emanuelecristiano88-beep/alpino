"use client";

import React, { useEffect, useRef } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import ScanTutorialSceneVisual from "./ScanTutorialSceneVisual";
import { discardCameraStreamHandoff, setCameraStreamHandoff } from "../lib/cameraStreamHandoff";

type ScanTutorialModalProps = {
  open: boolean;
  onDismiss: () => void;
};

/**
 * Safari iOS: getUserMedia sul tap del tutorial; lo stream viene passato allo scanner (handoff) senza
 * senza fermare subito i track — una seconda getUserMedia di seguito spesso resta bloccata o senza frame.
 */
async function openCameraStreamFromUserGesture(): Promise<void> {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) return;
  try {
    const stream = await md.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    setCameraStreamHandoff(stream);
  } catch {
    discardCameraStreamHandoff();
  }
}

export default function ScanTutorialModal({ open, onDismiss }: ScanTutorialModalProps) {
  const dismissLockRef = useRef(false);

  useEffect(() => {
    if (open) {
      dismissLockRef.current = false;
      discardCameraStreamHandoff();
    }
  }, [open]);

  const runDismissFromGesture = () => {
    if (dismissLockRef.current) return;
    dismissLockRef.current = true;
    void (async () => {
      discardCameraStreamHandoff();
      await openCameraStreamFromUserGesture();
      onDismiss();
    })();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (isOpen === false) runDismissFromGesture();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto border border-white/10 bg-zinc-950/95 text-white shadow-2xl backdrop-blur-md sm:max-w-md"
        showClose
      >
        <DialogHeader>
          <DialogTitle id="scan-tutorial-title" className="text-white">
            Tutorial
          </DialogTitle>
          <DialogDescription className="sr-only">
            Leggi i passaggi: cliente fermo sul foglio, operatore con telefono. Poi avvia la scansione.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ScanTutorialSceneVisual />

          <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-left">
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-white/80" strokeWidth={2} aria-hidden />
              <p className="text-sm font-semibold text-white">Una persona tiene il telefono</p>
            </div>
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-white/80" strokeWidth={2} aria-hidden />
              <p className="text-sm font-semibold text-white">Una persona tiene il piede fermo</p>
            </div>
          </div>

          <Button
            type="button"
            onClick={runDismissFromGesture}
            className="w-full rounded-full border border-white/20 bg-white/10 py-4 font-semibold text-white hover:bg-white/15"
          >
            Ho capito
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
