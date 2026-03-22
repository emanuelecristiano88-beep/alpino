import { randomUUID } from "crypto";

export const runtime = "nodejs";

type OrderBody = {
  scanId?: string;
  tagliaScelta?: string;
  coloreSelezionato?: string;
  millimetri?: {
    lunghezzaMm?: number;
    larghezzaMm?: number;
    volumeCm3?: number;
    filamentoTpuG?: number;
  };
};

/**
 * Riceve ordini "in produzione" dalla app (scansione → conferma stampa TPU).
 * In produzione: collegare a DB, email, Slack, ecc.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as OrderBody;

    const orderId = randomUUID();

    // Notifica / log operativo (sostituire con invio reale)
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("[NEUMA] Nuovo ordine in produzione");
    console.log("  orderId:", orderId);
    console.log("  scanId:", body.scanId ?? "(mancante)");
    console.log("  tagliaScelta:", body.tagliaScelta ?? "(mancante)");
    console.log("  coloreSelezionato:", body.coloreSelezionato ?? "(mancante)");
    console.log("  millimetri:", JSON.stringify(body.millimetri ?? {}, null, 2));
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return Response.json({
      ok: true,
      orderId,
      message: "Ordine registrato. NEUMA notificata (simulazione log).",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
