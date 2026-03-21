/**
 * Vercel Serverless (Edge) — POST /api/orders
 * Stesso contratto della vecchia route Next in docs/backend-reference-next-app-router/
 */
export const config = { runtime: "edge" };

type OrderBody = {
  scanId?: string;
  tagliaScelta?: string;
  coloreSelezionato?: string;
  millimetri?: {
    lunghezzaMm?: number;
    larghezzaMm?: number;
    altezzaArcoMm?: number;
    circonferenzaColloMm?: number;
    volumeCm3?: number;
    filamentoTpuG?: number;
  };
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = (await request.json()) as OrderBody;
    const orderId = crypto.randomUUID();

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("[ALPINO_OFFICINA] Nuovo ordine in produzione (Vercel Edge)");
    console.log("  orderId:", orderId);
    console.log("  scanId:", body.scanId ?? "(mancante)");
    console.log("  tagliaScelta:", body.tagliaScelta ?? "(mancante)");
    console.log("  coloreSelezionato:", body.coloreSelezionato ?? "(mancante)");
    console.log("  millimetri:", JSON.stringify(body.millimetri ?? {}, null, 2));
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return Response.json({
      ok: true,
      orderId,
      message: "Ordine registrato. Officina Alpino notificata (simulazione log).",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
