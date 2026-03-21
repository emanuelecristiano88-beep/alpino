import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

export const runtime = "nodejs";

function isJpegMagic(bytes: Uint8Array) {
  // FF D8 FF
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPngMagic(bytes: Uint8Array) {
  // 89 50 4E 47
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function isWebpMagic(bytes: Uint8Array) {
  // "RIFF....WEBP"
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

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const entries = formData.getAll("photos");
    if (!entries.length) {
      return Response.json(
        { status: "error", message: "Nessuna foto ricevuta (campo: photos)." },
        { status: 400 }
      );
    }

    // timestamp folder: public/scans/[timestamp]
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const scanId = crypto.randomUUID();
    const outDir = path.join(process.cwd(), "public", "scans", timestamp);
    await fs.mkdir(outDir, { recursive: true });

    const saved: string[] = [];

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

      const fileName = `foto_${String(i + 1).padStart(2, "0")}${ext}`;
      const filePath = path.join(outDir, fileName);
      await fs.writeFile(filePath, Buffer.from(arrayBuffer));
      saved.push(fileName);
    }

    const folderPath = `/scans/${timestamp}`;

    /**
     * Predisposizione scalatura metrica per motore di fotogrammetria esterno (Agisoft, RealityCapture,
     * API specializzate con ArUco/AprilTag, ecc.). Non è ancora inviato a nessun servizio reale.
     *
     * Il motore deve: rilevare il target coded A4 (ArUco negli angoli), usare la distanza nota
     * (es. 210 mm sul lato corto / tra marker) per scalare il modello 3D in millimetri (1 unità = 1 mm in STL).
     */
    const scaleReference = {
      type: "coded_a4_target" as const,
      /** Lato corto foglio A4 ISO (mm) — riferimento principale per px/mm */
      shortSideMm: 210,
      /** Distanza nota tra marker / baseline usata per calibrare scala (mm) */
      markerBaselineMm: 210,
      /** Istruzione al motore: cercare target ArUco su foglio A4 e scalare di conseguenza */
      detectionMode: "aruco_a4" as const,
    };

    // TODO: integrazione reale — es.:
    // await fetch(process.env.PHOTOGRAMMETRY_WEBHOOK_URL, {
    //   method: "POST",
    //   body: JSON.stringify({
    //     scanId,
    //     imagesDir: outDir,
    //     scaleReference,
    //   }),
    // });
    // - await startMeshroomJob({ scanId, imagesDir: outDir, scaleReference })
    // - await startExternalReconstructionJob({ scanId, imagesDir: outDir, scaleReference })
    //
    // Output atteso dal motore: mesh/texture + scaleFactor reale quando A4/target rilevato.

    return Response.json({
      status: "success",
      scanId,
      path: folderPath,
      receivedCount: entries.length,
      savedCount: saved.length,
      /** Placeholder: 1.0 finché il motore non applica scala da A4/ArUco */
      scaleFactorApplied: 1.0,
      /** Segnale per client/officina: in futuro "A4+markers detected" quando il backend lo espone */
      scaleReferenceNote: "A4 detected (placeholder)",
      scaleReference,
      message: "Pronto per la ricostruzione 3D in officina",
    });
  } catch (e: any) {
    return Response.json(
      {
        status: "error",
        error: e?.message || String(e),
      },
      { status: 500 }
    );
  }
}

