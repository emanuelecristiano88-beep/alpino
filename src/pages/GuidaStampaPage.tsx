import React, { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Info, Printer } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { downloadGuidaStampaPdf } from "../lib/guidaStampaPdf";
import { ScannerTarget } from "../components/ScannerTarget";
import NeumaLogo from "../components/NeumaLogo";

export default function GuidaStampaPage() {
  const [busy, setBusy] = useState(false);

  const onDownload = useCallback(() => {
    setBusy(true);
    try {
      downloadGuidaStampaPdf();
    } finally {
      window.setTimeout(() => setBusy(false), 600);
    }
  }, []);

  return (
    <div className="min-h-[100dvh] bg-black px-5 py-8 text-white">
      <div className="mx-auto max-w-4xl space-y-8">
        <Button variant="ghost" size="sm" className="mb-4 gap-2 px-0 text-[#e5e5e5] hover:text-white" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            Torna all&apos;app
          </Link>
        </Button>

        <NeumaLogo size="sm" className="mb-2" />

        <Card className="border-white/10 bg-white/[0.03] shadow-none">
          <CardHeader>
            <CardTitle>Guida stampa A4</CardTitle>
            <CardDescription className="text-[#e5e5e5]">
              Foglio di calibrazione con griglia millimetrica, 4 target agli angoli (interasse 210×297 mm) e area
              piede. Usa per la scansione fotogrammetrica. Per il flusso consigliato (cliente fermo + operatore che
              fotografa) vedi anche{" "}
              <Link to="/guida-scansione" className="font-medium text-white underline-offset-4 hover:underline">
                Guida alla scansione del piede
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-[#e5e5e5]">
              Stampa questo foglio al <strong>100% della scala</strong> (nessun adattamento alla pagina), poggia il
              piede nell&apos;area tratteggiata e scansiona <strong>includendo tutti e quattro i cerchi</strong> negli
              angoli.
            </p>
            <Button type="button" size="lg" className="w-full gap-2 rounded-full border border-white/20 bg-white/10 font-semibold tracking-wide text-white hover:bg-white/15" disabled={busy} onClick={onDownload}>
              <Printer className="h-5 w-5" />
              {busy ? "Preparazione…" : "SCARICA PDF GUIDA"}
            </Button>

            <aside
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-[#e5e5e5]"
              aria-labelledby="guida-stampa-istruzioni-titolo"
            >
              <div className="flex gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-white/80" aria-hidden />
                <div className="min-w-0 space-y-2">
                  <p id="guida-stampa-istruzioni-titolo" className="font-semibold text-white">
                    Istruzioni di verifica
                  </p>
                  <p className="leading-relaxed text-[#e5e5e5]">
                    Sul foglio con marker <strong className="text-white">ArUco</strong> (sezione Scanner target
                    sotto): dopo aver stampato, prendi un righello fisico e misura la distanza tra i due marker ArUco
                    superiori. Deve essere esattamente <strong className="text-white">190 mm</strong> (o la misura
                    che hai impostato). Se la misura è diversa, riprova la stampa disattivando l&apos;opzione{" "}
                    <strong className="text-white">&quot;Adatta al foglio&quot;</strong>.
                  </p>
                  <p className="border-t border-white/10 pt-2 leading-relaxed text-[#e5e5e5]">
                    <span className="font-medium text-white">Perché è importante?</span> Un millimetro di errore sul
                    foglio può significare una scarpa scomoda sulle nostre stampanti 3D.
                  </p>
                </div>
              </div>
            </aside>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.03] shadow-none">
          <CardHeader>
            <CardTitle>Scanner target (SVG + ArUco)</CardTitle>
            <CardDescription className="text-[#e5e5e5]">
              Foglio A4 vettoriale con griglia millimetrata, marker ArUco DICT_4X4_50 (ID 0–3) e guida piede. Scarica
              lo SVG o stampa in PDF dalla finestra di sistema.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScannerTarget />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
