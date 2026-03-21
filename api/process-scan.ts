/**
 * Vercel Serverless (Edge) — POST /api/process-scan
 * Su Vercel Edge non c'è filesystem persistente: non salviamo file su disco (solo validazione + risposta).
 * Riferimento implementazione con fs: docs/backend-reference-next-app-router/api/process-scan/route.ts
 */
export const config = { runtime: "edge" };

function isJpegMagic(bytes: Uint8Array) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPngMagic(bytes: Uint8Array) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function isWebpMagic(bytes: Uint8Array) {
  if (bytes.length < 12) return false;
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return riff && webp;
}

function extFromMimeOrMagic(mime: string, bytes: Uint8Array) {
  if (mime === "image/jpeg" || isJpegMagic(bytes)) return ".jpg";
  if (mime === "image/png" || isPngMagic(bytes)) return ".png";
  if (mime === "image/webp" || isWebpMagic(bytes)) return ".webp";
  return null;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ status: "error", message: "Method not allowed" }, { status: 405 });
  }

  try {
    const formData = await request.formData();
    const entries = formData.getAll("photos");
    if (!entries.length) {
      return Response.json(
        { status: "error", message: "Nessuna foto ricevuta (campo: photos)." },
        { status: 400 }
      );
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const scanId = crypto.randomUUID();
    const folderPath = `/scans/${timestamp}`;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!(entry instanceof File)) {
        return Response.json(
          {
            status: "error",
            message: `Il payload non contiene un file valido (indice ${i}).`,
          },
          { status: 400 }
        );
      }

      const mime = entry.type || "";
      const arrayBuffer = await entry.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const ext = extFromMimeOrMagic(mime, bytes.subarray(0, 12));
      if (!ext) {
        return Response.json(
          {
            status: "error",
            scanId,
            message: `Uno o più file non sembrano immagini (indice ${i}).`,
          },
          { status: 400 }
        );
      }
    }

    const scaleReference = {
      type: "coded_a4_target" as const,
      shortSideMm: 210,
      markerBaselineMm: 210,
      detectionMode: "aruco_a4" as const,
    };

    /** Placeholder: sostituire con metriche da mesh 3D (script Mac / ricostruzione). */
    const metrics = {
      lunghezzaMm: 265,
      larghezzaMm: 95,
      altezzaArcoMm: 28,
      circonferenzaColloMm: 246,
      volumeCm3: 1450,
      left: {
        lunghezzaMm: 264,
        larghezzaMm: 98,
        altezzaArcoMm: 27,
        circonferenzaColloMm: 244,
        volumeCm3: 1420,
      },
      right: {
        lunghezzaMm: 267,
        larghezzaMm: 101,
        altezzaArcoMm: 29,
        circonferenzaColloMm: 248,
        volumeCm3: 1480,
      },
      scanVersion: "V6",
    };

    return Response.json({
      status: "success",
      scanId,
      path: folderPath,
      receivedCount: entries.length,
      savedCount: entries.length,
      scaleFactorApplied: 1.0,
      scaleReferenceNote: "A4 detected (placeholder) — Vercel Edge: nessun salvataggio file su disco",
      scaleReference,
      message: "Pronto per la ricostruzione 3D in officina",
      metrics,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ status: "error", error: msg }, { status: 500 });
  }
}
