"use client";

import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Footprints, Printer, Smartphone, Users, XCircle } from "lucide-react";
import NeumaLogo from "../components/NeumaLogo";
import FootPlacementGuideVisual from "../components/FootPlacementGuideVisual";
import ScanPhaseReferenceGrid from "../components/ScanPhaseReferenceGrid";
import ScanTutorialSceneVisual from "../components/ScanTutorialSceneVisual";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { cn } from "../lib/utils";

const STEPS = [
  {
    n: 1,
    title: "Stampa il foglio NEUMA (A4)",
    Icon: Printer,
    lines: [
      <>
        Usa il <strong className="text-white">foglio calibrazione</strong> con griglia in centimetri e marker agli
        angoli: serve per allineare la scansione (stesso principio dei flussi made-to-measure professionali).
      </>,
      <>
        Vai a <strong className="text-white">Guida stampa</strong>, stampa in scala <strong>100%</strong> (nessun
        ridimensionamento).
      </>,
    ],
  },
  {
    n: 2,
    title: "Due persone",
    Icon: Users,
    lines: [
      <>
        <strong className="text-white">Cliente</strong>: sta comodo, piede nudo, fermo sul foglio.
      </>,
      <>
        <strong className="text-white">Operatore</strong>: un’altra persona tiene il telefono e scatta — così il
        cliente non deve muoversi e le foto restano nitide.
      </>,
    ],
  },
  {
    n: 3,
    title: "Centra il piede sul foglio",
    Icon: Footprints,
    lines: [
      <>
        Posiziona il piede in modo che il <strong className="text-white">tallone</strong> coincida con l’area{" "}
        <strong className="text-white">centro foglio</strong> (croce blu nello schema sopra).
      </>,
      <>L’area piede è indicata dalla sagoma tratteggiata: il tallone deve restare vicino al centro A4.</>,
      <>Pavimento piatto e buona luce, senza ombre forti sul piede.</>,
    ],
  },
  {
    n: 4,
    title: "Le 4 inquadrature (nell’ordine dell’app)",
    Icon: Smartphone,
    lines: [
      <>
        <strong className="text-white">1 · Vista dall’alto</strong> — telefono sopra il piede: punta, avampiede e
        contorni; foglio e 4 marker nel frame.
      </>,
      <>
        <strong className="text-white">2 · Vista laterale esterna</strong> — dal lato del mignolo, profilo lento e
        distanza costante.
      </>,
      <>
        <strong className="text-white">3 · Vista laterale interna e arco</strong> — dal lato interno, arco lento lungo
        l’arco plantare.
      </>,
      <>
        <strong className="text-white">4 · Vista posteriore e tallone</strong> — dietro al tallone; retro piede e
        calcagno, poi leggera inclinazione verso la pianta se serve.
      </>,
      <>
        Il <strong className="text-white">cliente non sposta</strong> il piede tra una fase e l’altra; movimenti solo
        dell’operatore.
      </>,
    ],
  },
  {
    n: 5,
    title: "Completa e invia",
    Icon: Check,
    lines: [
      <>Ripeti per l’altro piede se l’app lo chiede.</>,
      <>
        Attendi la fine dell’<strong className="text-white">invio</strong> prima di chiudere la pagina.
      </>,
    ],
  },
] as const;

const DONT = [
  "Il cliente che sposta o ruota il piede durante le foto.",
  "Foglio piegato, tagliato o senza margini (marker non visibili).",
  "Operatore troppo lontano: il foglio deve restare intero in inquadratura.",
  "Scattare di corsa o con poca luce.",
];

export default function GuidaScansionePiedePage() {
  return (
    <div className="min-h-[100dvh] bg-black px-5 py-8 pb-16 text-white">
      <div className="mx-auto max-w-xl">
        <Button variant="ghost" size="sm" className="mb-4 gap-2 px-0 text-[#e5e5e5] hover:text-white" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            Torna all&apos;app
          </Link>
        </Button>

        <NeumaLogo size="lg" className="mb-6" />

        <header className="mb-6 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Tutorial</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Come scansionare il piede</h1>
          <p className="text-base leading-relaxed text-[#e5e5e5]">
            Sistema <strong className="text-white">a due persone</strong>: il cliente tiene il piede fermo sul foglio
            A4 con griglia; <strong className="text-white">un operatore</strong> fa le foto con il telefono. Circa{" "}
            <strong className="text-white">2–4 minuti</strong> per piede.
          </p>
        </header>

        <ScanTutorialSceneVisual className="mb-6" />
        <p className="mb-2 text-center text-xs font-semibold text-white/70">Foglio NEUMA (target A4 · marker ArUco)</p>
        <FootPlacementGuideVisual className="mb-8" />

        <ScanPhaseReferenceGrid className="mb-8" />

        <Card className="mb-8 border border-white/10 bg-white/[0.03] shadow-none">
          <CardContent className="space-y-2 p-4 text-sm text-[#e5e5e5]">
            <p className="font-semibold text-white">Foglio con griglia e marker</p>
            <p>
              Senza il foglio stampato correttamente, la calibrazione può fallire. Scarica e stampa dalla pagina dedicata.
            </p>
            <Button size="sm" className="mt-1 rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/15" asChild>
              <Link to="/guida-stampa">Apri guida stampa e foglio A4</Link>
            </Button>
          </CardContent>
        </Card>

        <ol className="space-y-4">
          {STEPS.map((step) => {
            const I = step.Icon;
            return (
              <li key={step.n}>
                <Card className="overflow-hidden border border-white/10 bg-white/[0.03] shadow-none">
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex gap-3">
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                          "bg-white/14 text-sm font-bold text-white"
                        )}
                        aria-hidden
                      >
                        {step.n}
                      </span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <I className="h-5 w-5 shrink-0 text-white/85" strokeWidth={2} />
                          <h2 className="text-base font-semibold text-white">{step.title}</h2>
                        </div>
                        <ul className="space-y-1.5 text-sm leading-relaxed text-[#e5e5e5]">
                          {step.lines.map((line, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/40" aria-hidden />
                              <span>{line}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>

        <Card className="mt-6 border border-white/10 bg-white/[0.03] shadow-none">
          <CardContent className="space-y-3 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-white">
              <XCircle className="h-5 w-5 shrink-0" strokeWidth={2} />
              <p className="text-sm font-semibold">Da evitare</p>
            </div>
            <ul className="space-y-2 text-sm text-[#e5e5e5]">
              {DONT.map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="text-white/65" aria-hidden>
                    —
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" className="rounded-full border-white/20 bg-white/[0.03] text-[#e5e5e5] hover:bg-white/[0.08] hover:text-white" asChild>
            <Link to="/prepara-scansione">Privacy e consenso</Link>
          </Button>
          <Button className="rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/15" asChild>
            <Link to="/">Ho capito — apri l&apos;app</Link>
          </Button>
        </div>

        <p className="mt-6 text-center text-xs text-[#e5e5e5]">
          Approfondimenti:{" "}
          <Link to="/su-misura" className="font-medium text-white underline-offset-4 hover:underline">
            Calzature su misura
          </Link>
          {" · "}
          <Link to="/bussola-del-piede" className="font-medium text-white underline-offset-4 hover:underline">
            Bussola del piede
          </Link>
        </p>

        <p className="mt-3 text-center text-xs text-white/55">
          NEUMA · scansione fotogrammetrica · dubbi? Contatta il supporto del tuo rivenditore.
        </p>
      </div>
    </div>
  );
}
