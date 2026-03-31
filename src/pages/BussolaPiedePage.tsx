import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BarChart3, Compass, Footprints, Target } from "lucide-react";
import NeumaLogo from "../components/NeumaLogo";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

/**
 * Contenuto informativo NEUMA (italiano) — analisi forma piede / rappresentatività.
 */
export default function BussolaPiedePage() {
  return (
    <div className="min-h-[100dvh] bg-black px-5 py-8 pb-14 text-white">
      <div className="mx-auto max-w-3xl space-y-8">
        <Button variant="ghost" size="sm" className="mb-2 gap-2 px-0 text-[#e5e5e5] hover:text-white" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            Torna all&apos;app
          </Link>
        </Button>

        <header className="space-y-4">
          <NeumaLogo size="sm" className="mb-1" />
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Compass className="h-7 w-7" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-white/70">NEUMA</p>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Bussola del piede</h1>
            </div>
          </div>
          <p className="text-xl font-medium text-white">
            Il tester del tuo brand è sulla direzione giusta? Scopri l&apos;indice di rappresentatività del piede.
          </p>
          <p className="text-base leading-relaxed text-[#e5e5e5]">
            In ogni azienda ci sono persone che provano le calzature di prova: il “piede perfetto” per il fit del brand.
            NEUMA ti aiuta a capire con <strong className="text-foreground">dati reali</strong> se quel piede è davvero
            rappresentativo delle forme più diffuse, oppure se rappresenta solo una parte della popolazione.
          </p>
        </header>

        <Card className="border-white/10 bg-white/[0.03] shadow-none">
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Target className="h-5 w-5" />
              </span>
              <div>
                <CardTitle>Cosa vuoi sapere sul tuo “piede modello”?</CardTitle>
                <CardDescription>Caratterizzazione e confronto con un database di riferimento</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              Il processo NEUMA confronta <strong className="text-foreground">forma e misure</strong> del piede
              selezionato con un <strong className="text-foreground">database esteso di morfologie</strong>
              — non solo numeri isolati, ma relazioni tra lunghezza, larghezze e volume.
            </p>
            <p>
              Il risultato è un&apos;analisi chiara: il piede in esame è{" "}
              <strong className="text-foreground">allineato alle forme più comuni</strong> come credi, oppure
              rappresenta un sottoinsieme specifico del mondo reale — per cui le campagne di test e le taglie
              andrebbero calibrate diversamente.
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.03] shadow-none">
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <BarChart3 className="h-5 w-5" />
              </span>
              <div>
                <CardTitle>Perché è utile</CardTitle>
                <CardDescription>Decisioni su campioni, fit e comunicazione taglie</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <ul className="list-inside list-disc space-y-2">
              <li>
                Validare se il <strong className="text-foreground">tester</strong> usato per le prove in showroom è
                rappresentativo del target.
              </li>
              <li>
                Ridurre errori di <strong className="text-foreground">proporzione</strong> tra lunghezza e larghezza
                rispetto alla media.
              </li>
              <li>
                Allineare marketing e sviluppo prodotto a <strong className="text-foreground">dati oggettivi</strong>,
                non solo a sensazioni.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.03] shadow-none">
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Footprints className="h-5 w-5" />
              </span>
              <div>
                <CardTitle>Da dove partono i dati</CardTitle>
                <CardDescription>Scansione fotogrammetrica e geometria</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed text-muted-foreground">
            <p>
              Le misure e la forma derivano dalla <strong className="text-foreground">scansione del piede</strong>{" "}
              secondo il flusso NEUMA (foglio calibrato, acquisizione guidata, ricostruzione). Per iniziare dalla base,
              consulta la <Link to="/guida-scansione" className="font-medium text-primary underline-offset-4 hover:underline">guida alla scansione</Link> e la{" "}
              <Link to="/guida-stampa" className="font-medium text-primary underline-offset-4 hover:underline">guida stampa A4</Link>.
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:gap-4">
          <Button variant="outline" className="rounded-full border-white/20 bg-white/[0.03] text-[#e5e5e5] hover:bg-white/[0.08] hover:text-white" asChild>
            <Link to="/su-misura">Scopri calzature su misura NEUMA</Link>
          </Button>
          <Button className="rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/15" asChild>
            <Link to="/">Torna all&apos;app</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
