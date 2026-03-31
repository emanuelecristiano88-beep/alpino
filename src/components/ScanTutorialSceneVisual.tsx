"use client";

import React from "react";
import { NEUMA_TUTORIAL_INTRO_IMAGE } from "../lib/neumaAssets";
import { cn } from "../lib/utils";

export type ScanTutorialSceneVisualProps = {
  className?: string;
};

/**
 * Intro visiva del tutorial: foto reale cliente + operatore sul foglio con marker
 * (sostituisce gli schemi vettoriali astratti per maggiore chiarezza).
 */
export default function ScanTutorialSceneVisual({ className }: ScanTutorialSceneVisualProps) {
  const [imgError, setImgError] = React.useState(false);

  return (
    <div className={className}>
      <figure
        className={cn(
          "overflow-hidden rounded-2xl border border-border/80 bg-muted/30 shadow-sm ring-1 ring-black/[0.04] dark:bg-zinc-900/40 dark:ring-white/[0.06]"
        )}
      >
        {!imgError ? (
          <img
            src={NEUMA_TUTORIAL_INTRO_IMAGE}
            alt="Cliente in piedi sul foglio con marker agli angoli; operatore inginocchiato che inquadra i piedi con lo smartphone"
            className="mx-auto block max-h-[min(52vh,320px)] w-full object-cover object-center sm:max-h-[280px]"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex min-h-[160px] items-center justify-center bg-zinc-100 px-4 py-8 text-center text-sm text-muted-foreground dark:bg-zinc-900">
            Aggiungi l&apos;immagine <code className="rounded bg-muted px-1 text-xs">tutorial-intro-operator-scene.png</code> in{" "}
            <code className="rounded bg-muted px-1 text-xs">public/</code>
          </div>
        )}
        <figcaption className="border-t border-border/60 bg-card/95 px-3 py-2.5 text-center text-xs leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Due persone</span>: il cliente sta sul foglio NEUMA (marker visibili); l&apos;operatore
          regge il telefono e si posiziona per inquadrare piede e foglio — come nelle 4 fasi che seguono nell&apos;app.
        </figcaption>
      </figure>
      <p className="mt-3 text-center text-sm leading-relaxed text-muted-foreground">
        Poi segui nell&apos;ordine le <span className="font-medium text-foreground">4 inquadrature</span> (dall&apos;alto, laterale esterna,
        laterale interna con arco, posteriore/tallone), tenendo sempre visibili{" "}
        <span className="font-medium text-foreground">foglio e 4 marker</span>.
      </p>
    </div>
  );
}
