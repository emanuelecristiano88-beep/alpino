import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Droplets, Footprints, Leaf, Recycle, Shield, Sparkles } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { HoneycombLatticeVisual } from "../components/HoneycombLatticeVisual";
import NeumaLogo from "../components/NeumaLogo";

export default function TecnologiaTpuPage() {
  return (
    <div className="min-h-[100dvh] bg-black px-5 py-8 pb-14 text-white">
      <div className="mx-auto max-w-3xl space-y-8">
        <Button variant="ghost" size="sm" className="mb-2 gap-2 px-0 text-[#e5e5e5] hover:text-white" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            Torna all&apos;app
          </Link>
        </Button>

        <header className="space-y-2">
          <NeumaLogo size="sm" className="mb-1" />
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Tecnologia TPU &amp; stampanti 3D</h1>
          <p className="text-lg leading-relaxed text-[#e5e5e5]">
            Le tue scarpe nascono dalla nostra <strong className="text-foreground">produzione NEUMA</strong>: precisione
            industriale, materiali premium e un processo pensato per il piede — non per il magazzino.
          </p>
        </header>

        <Card className="border-white/10 bg-white/[0.03] shadow-none">
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Shield className="h-5 w-5" />
              </span>
              <div>
                <CardTitle>Il materiale: TPU 95A</CardTitle>
                <CardDescription>Elastomero termoplastico ad alte prestazioni</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              Il <strong className="text-foreground">TPU 95A</strong> è un elastomero che unisce la{" "}
              <strong className="text-foreground">flessibilità della gomma</strong> alla{" "}
              <strong className="text-foreground">resistenza strutturale della plastica</strong>. È{" "}
              <strong className="text-foreground">indistruttibile</strong> nell&apos;uso normale,{" "}
              <strong className="text-foreground">lavabile</strong> e <strong className="text-foreground">riciclabile al 100%</strong>{" "}
              — una suola e un intersuola che reggono l&apos;uso quotidiano senza cedere.
            </p>
            <ul className="grid gap-2 sm:grid-cols-3">
              <li className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-foreground">Indistruttibile</span>
              </li>
              <li className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                <Droplets className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-foreground">Lavabile</span>
              </li>
              <li className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                <Recycle className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-foreground">Riciclabile al 100%</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.03] shadow-none">
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <CardTitle>Struttura a reticolo (lattice)</CardTitle>
                <CardDescription>Geometria al posto della schiuma che cede</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <HoneycombLatticeVisual />
            <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                Non utilizziamo schiume che nel tempo si{" "}
                <strong className="text-foreground">schiacciano e perdono rimbalzo</strong>. Al loro posto c&apos;è una{" "}
                <strong className="text-foreground">struttura geometrica a nido d&apos;ape</strong> (lattice): celle
                progettate per offrire un <strong className="text-foreground">ritorno elastico duraturo</strong>, come una
                molla che non si stanca.
              </p>
              <p>
                Ogni interstizio lavora in sincrono con gli altri: il piede riceve sostegno dove serve e libertà di
                movimento dove conta — con la ripetibilità della produzione NEUMA.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.03] shadow-none">
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Footprints className="h-5 w-5" />
              </span>
              <div>
                <CardTitle>Vantaggi per il piede</CardTitle>
                <CardDescription>Comfort guidato dai tuoi dati</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex gap-3 rounded-lg border border-border/60 bg-muted/20 p-4">
              <Droplets className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <h3 className="font-semibold text-foreground">Traspirabilità</h3>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                  L&apos;aria circola attraverso la <strong className="text-foreground">struttura aperta</strong> del
                  reticolo: meno effetto &quot;scatola chiusa&quot; rispetto a intersuole compatte e opache.
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border border-border/60 bg-muted/20 p-4">
              <Footprints className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <h3 className="font-semibold text-foreground">Ammortizzazione su misura</h3>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                  La <strong className="text-foreground">morbidezza è calibrata</strong> in base al{" "}
                  <strong className="text-foreground">peso rilevato dalla scansione</strong>: più dati reali, meno
                  compromessi &quot;taglia unica&quot;.
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border border-border/60 bg-muted/20 p-4">
              <Leaf className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <h3 className="font-semibold text-foreground">Eco-sostenibilità</h3>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                  Produciamo <strong className="text-foreground">solo ciò che serve</strong> — approccio{" "}
                  <strong className="text-foreground">Zero Waste</strong>, direttamente in{" "}
                  <strong className="text-foreground">NEUMA</strong>, senza catene di montaggio né{" "}
                  <strong className="text-foreground">trasporti transoceanici</strong> per riempire scaffali.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3 border-t border-white/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[#e5e5e5]">
            <Link to="/guida-stampa" className="font-medium text-white underline-offset-4 hover:underline">
              Guida stampa &amp; calibrazione A4
            </Link>
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="outline" className="rounded-full border-white/20 bg-white/[0.03] text-[#e5e5e5] hover:bg-white/[0.08] hover:text-white" asChild>
              <Link to="/guida-scansione">Guida alla scansione</Link>
            </Button>
            <Button className="rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/15" asChild>
              <Link to="/">Torna all&apos;app</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
