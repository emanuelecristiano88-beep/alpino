import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Camera, Check, Sparkles, X } from "lucide-react";
import NeumaLogo from "../components/NeumaLogo";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

/**
 * Contenuto informativo NEUMA (italiano) — su misura, scansione smartphone, confronto metodi.
 */
export default function SuMisuraPage() {
  return (
    <div className="min-h-[100dvh] bg-background px-4 py-6 pb-12 text-foreground">
      <div className="mx-auto max-w-3xl space-y-8">
        <Button variant="ghost" size="sm" className="mb-2 gap-2 px-0" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            Torna all&apos;app
          </Link>
        </Button>

        <header className="space-y-4">
          <NeumaLogo size="sm" className="mb-1" />
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Sparkles className="h-7 w-7" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">NEUMA</p>
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Calzature su misura</h1>
            </div>
          </div>
          <p className="text-lg font-medium text-foreground">
            Artigianato e precisione: come NEUMA trasforma la misura del piede in un percorso semplice e ripetibile.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Perché la misura del piede è il fondamento del fit</CardTitle>
            <CardDescription>Senza una base misurabile, anche la lavorazione più curata non garantisce comfort</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              Una scarpa su misura nasce da una <strong className="text-foreground">geometria affidabile del piede</strong>.
              La precisione iniziale significa clienti soddisfatti, meno rilavorazioni e meno resi legati al numero sbagliato.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Camera className="h-5 w-5" />
              </span>
              <div>
                <CardTitle>Scansiona il piede con lo smartphone</CardTitle>
                <CardDescription>Foto guidate, niente strumenti speciali in casa</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              NEUMA ricostruisce la geometria del piede a partire da <strong className="text-foreground">acquisizioni con il telefono</strong>, con un{" "}
              <strong className="text-foreground">foglio A4 calibrato</strong> e una sessione guidata (anche con operatore che assiste il cliente).
              Algoritmi di visione elaborano le immagini e estraggono <strong className="text-foreground">biometrie utili alla produzione</strong> — senza
              procedimenti complessi per l&apos;utente finale.
            </p>
            <p>
              Il percorso è pensato per essere <strong className="text-foreground">moderno e coinvolgente</strong>: la fase di misura diventa parte
              dell&apos;esperienza di acquisto, non un ostacolo.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Metodo tradizionale in negozio</CardTitle>
            <CardDescription>Vantaggi e limiti</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div>
              <p className="mb-2 flex items-center gap-2 font-semibold text-foreground">
                <Check className="h-4 w-4 text-green-600" /> Vantaggi
              </p>
              <ul className="list-inside list-disc space-y-1 pl-1">
                <li>Competenza e esperienza del personale</li>
                <li>Controllo diretto della postura del piede</li>
              </ul>
            </div>
            <div>
              <p className="mb-2 flex items-center gap-2 font-semibold text-foreground">
                <X className="h-4 w-4 text-red-500" /> Limitazioni
              </p>
              <ul className="list-inside list-disc space-y-1 pl-1">
                <li>Richiede presenza fisica</li>
                <li>Variabilità tra operatori</li>
                <li>Tempi e costi per brand e clienti</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Misura a casa (metro o template)</CardTitle>
            <CardDescription>Vantaggi e limiti</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div>
              <p className="mb-2 flex items-center gap-2 font-semibold text-foreground">
                <Check className="h-4 w-4 text-green-600" /> Vantaggi
              </p>
              <ul className="list-inside list-disc space-y-1 pl-1">
                <li>Più persone raggiunte, costi e tempi ridotti</li>
                <li>Flessibilità per il cliente</li>
              </ul>
            </div>
            <div>
              <p className="mb-2 flex items-center gap-2 font-semibold text-foreground">
                <X className="h-4 w-4 text-red-500" /> Limitazioni
              </p>
              <ul className="list-inside list-disc space-y-1 pl-1">
                <li>Metro posizionato male o letture errate</li>
                <li>Istruzioni fraintese</li>
                <li>Risultati poco ripetibili</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Confronto sintetico</CardTitle>
            <CardDescription>Professionista in negozio · cliente a casa · NEUMA (foto guidate)</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 font-semibold text-foreground">Aspetto</th>
                  <th className="py-2 pr-4 font-medium text-muted-foreground">In negozio</th>
                  <th className="py-2 pr-4 font-medium text-muted-foreground">A casa (manuale)</th>
                  <th className="py-2 font-medium text-primary">NEUMA</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/60">
                  <td className="py-2 pr-4 font-medium text-foreground">Chi esegue</td>
                  <td className="py-2 pr-4">Professionista</td>
                  <td className="py-2 pr-4">Cliente</td>
                  <td className="py-2">Cliente (e/o operatore) con app</td>
                </tr>
                <tr className="border-b border-border/60">
                  <td className="py-2 pr-4 font-medium text-foreground">Precisione</td>
                  <td className="py-2 pr-4">Alta (ma tempo)</td>
                  <td className="py-2 pr-4">Variabile</td>
                  <td className="py-2">Alta, guidata dal software</td>
                </tr>
                <tr className="border-b border-border/60">
                  <td className="py-2 pr-4 font-medium text-foreground">Errori tipici</td>
                  <td className="py-2 pr-4">Variabilità umana</td>
                  <td className="py-2 pr-4">Metro, disegni</td>
                  <td className="py-2">Mitigati da flusso e calibrazione</td>
                </tr>
                <tr className="border-b border-border/60">
                  <td className="py-2 pr-4 font-medium text-foreground">Comodità cliente</td>
                  <td className="py-2 pr-4">Bassa</td>
                  <td className="py-2 pr-4">Alta</td>
                  <td className="py-2">Molto alta</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium text-foreground">Ripetibilità</td>
                  <td className="py-2 pr-4">Dipende dall&apos;operatore</td>
                  <td className="py-2 pr-4">Difficile</td>
                  <td className="py-2">Processo standardizzato</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Esperienza guidata nell&apos;app</CardTitle>
            <CardDescription>Realtà aumentata leggera e focus intelligente</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              NEUMA integra <strong className="text-foreground">guide visive</strong> (cupola di acquisizione, mirino di
              messa a fuoco) per aiutare a coprire tutte le viste utili senza richiedere hardware dedicato. L&apos;obiettivo
              è un <strong className="text-foreground">flusso ripetibile</strong> in condizioni reali di luce e spazio.
            </p>
            <p>
              Per approfondire l&apos;analisi delle forme rispetto al database di riferimento, vedi anche{" "}
              <Link to="/bussola-del-piede" className="font-medium text-primary underline-offset-4 hover:underline">
                Bussola del piede
              </Link>
              .
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:gap-4">
          <Button variant="outline" asChild>
            <Link to="/guida-scansione">Guida alla scansione del piede</Link>
          </Button>
          <Button asChild>
            <Link to="/">Torna all&apos;app</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
