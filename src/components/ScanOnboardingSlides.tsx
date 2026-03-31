import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

type Slide = {
  key: string;
  imageSrc: string;
  title: string;
  subtitle: string;
  alt: string;
};

export default function ScanOnboardingSlides({ onComplete }: { onComplete: () => void }) {
  const slides = useMemo<Slide[]>(
    () => [
      {
        key: "position",
        imageSrc: "/onboarding/piede-su-foglio.png",
        title: "Posiziona il piede",
        subtitle: "Metti il piede sul foglio come mostrato",
        alt: "Piede posizionato sul foglio A4 con marker",
      },
      {
        key: "movement",
        imageSrc: "/onboarding/ruota-intorno.png",
        title: "Muoviti intorno",
        subtitle: "Gira intorno al piede lentamente",
        alt: "Movimento del telefono intorno al piede",
      },
      {
        key: "lighting",
        imageSrc: "/onboarding/luce.png",
        title: "Controlla la luce",
        subtitle: "Evita ombre e usa una luce uniforme",
        alt: "Esempio di luce buona e luce cattiva durante la scansione",
      },
    ],
    []
  );

  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const current = slides[idx]!;

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(slides.length - 1, next));
    setDir(clamped > idx ? 1 : -1);
    setIdx(clamped);
  };

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-36 bg-gradient-to-t from-black/85 to-transparent" />

      <div className="absolute inset-0 flex flex-col">
        {/* image (top ~70%) */}
        <div className="relative h-[70dvh] w-full overflow-hidden">
          <AnimatePresence initial={false} custom={dir}>
            <motion.div
              key={current.key}
              custom={dir}
              initial={{ opacity: 0, x: dir > 0 ? 18 : -18, scale: 0.995 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: dir > 0 ? -14 : 14, scale: 0.995 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.08}
              onDragEnd={(_, info) => {
                const dx = info.offset.x;
                const v = info.velocity.x;
                if (dx < -80 || v < -700) go(idx + 1);
                else if (dx > 80 || v > 700) go(idx - 1);
              }}
              className="absolute inset-0"
            >
              <img
                src={current.imageSrc}
                alt={current.alt}
                className="h-full w-full object-cover"
                draggable={false}
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/45" />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* text */}
        <div className="relative z-20 flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="flex items-center gap-2" aria-hidden>
            {slides.map((s, i) => (
              <div
                key={s.key}
                className={cn(
                  "h-1.5 w-1.5 rounded-full bg-white/18 transition-all duration-300",
                  i === idx && "w-6 bg-white/70"
                )}
              />
            ))}
          </div>
          <div className="mt-5">
            <div className="neuma-title text-3xl font-semibold tracking-tight text-white">{current.title}</div>
            <div className="mt-2 text-base font-medium text-white/70">{current.subtitle}</div>
          </div>
        </div>

        {/* CTA */}
        <div className="relative z-30 px-6 pb-[max(1.1rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            size="lg"
            className="neuma-touch w-full rounded-full py-6 text-base font-semibold shadow-[0_26px_90px_rgba(0,0,0,0.7)]"
            onClick={() => {
              if (idx < slides.length - 1) go(idx + 1);
              else onComplete();
            }}
          >
            Continua
          </Button>
        </div>
      </div>
    </div>
  );
}

