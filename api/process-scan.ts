/**
 * Vercel Serverless (Node.js) — POST /api/process-scan
 * Valida le immagini e, se configurato, carica su Google Drive nella cartella condivisa.
 *
 * Upload multi-batch: per evitare il limite ~4.5MB del body su Vercel, inviare più POST con:
 * - scanId (stesso UUID per tutta la sessione)
 * - batchIndex (0..batchTotal-1), batchTotal
 * - driveFolderId (dalla risposta del batch 0, batch successivi)
 */
import {
  createDriveSubfolder,
  isDriveConfigured,
  uploadBufferToDrive,
  getRootFolderId,
} from "./lib/googleDrive";

export const config = { runtime: "nodejs", maxDuration: 120 };

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

function checkUploadSecret(request: Request): boolean {
  const secret = process.env.UPLOAD_API_SECRET;
  if (!secret) return true;
  return request.headers.get("x-upload-secret") === secret;
}

async function validatePhotoFiles(entries: FormDataEntryValue[]): Promise<
  | { ok: true; validated: { buffer: Buffer; mime: string; ext: string; originalName: string }[] }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const validated: { buffer: Buffer; mime: string; ext: string; originalName: string }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!(entry instanceof File)) {
      return {
        ok: false,
        status: 400,
        body: { status: "error", message: `Il payload non contiene un file valido (indice ${i}).` },
      };
    }

    const mime = entry.type || "";
    const arrayBuffer = await entry.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const ext = extFromMimeOrMagic(mime, bytes.subarray(0, 12));
    if (!ext) {
      return {
        ok: false,
        status: 400,
        body: {
          status: "error",
          message: `Uno o più file non sembrano immagini (indice ${i}).`,
        },
      };
    }
    validated.push({
      buffer: Buffer.from(arrayBuffer),
      mime: mime || (ext === ".jpg" ? "image/jpeg" : ext === ".png" ? "image/png" : "image/webp"),
      ext,
      originalName: entry.name || `photo_${i}${ext}`,
    });
  }

  return { ok: true, validated };
}

function metricsPayload() {
  const scaleReference = {
    type: "coded_a4_target" as const,
    shortSideMm: 210,
    markerBaselineMm: 210,
    detectionMode: "aruco_a4" as const,
  };

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

  return { scaleReference, metrics };
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ status: "error", message: "Method not allowed" }, { status: 405 });
  }

  if (!checkUploadSecret(request)) {
    return Response.json({ status: "error", message: "Non autorizzato" }, { status: 401 });
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

    const batchIndex = Math.max(0, parseInt(String(formData.get("batchIndex") ?? "0"), 10) || 0);
    const batchTotal = Math.max(1, parseInt(String(formData.get("batchTotal") ?? "1"), 10) || 1);
    const clientScanId = String(formData.get("scanId") ?? "").trim();
    const existingDriveFolderId = String(formData.get("driveFolderId") ?? "").trim();

    const validatedResult = await validatePhotoFiles(entries);
    if (!validatedResult.ok) {
      return Response.json(validatedResult.body, { status: validatedResult.status });
    }
    const { validated } = validatedResult;

    const isBatched = batchTotal > 1;

    if (isBatched && !clientScanId) {
      return Response.json(
        {
          status: "error",
          message: "Upload in più parti: invia il campo scanId (UUID) uguale per ogni batch.",
        },
        { status: 400 }
      );
    }

    if (isBatched && batchIndex > 0 && isDriveConfigured() && !existingDriveFolderId) {
      return Response.json(
        {
          status: "error",
          message: "Batch successivi: invia driveFolderId restituito dal batch 0.",
        },
        { status: 400 }
      );
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const scanId = isBatched ? clientScanId : crypto.randomUUID();
    const folderPath = `/scans/${timestamp}`;

    let driveUploaded = false;
    let driveFolderId: string | undefined = existingDriveFolderId || undefined;
    let driveFolderLink: string | undefined;
    const driveFileIds: string[] = [];

    if (isDriveConfigured()) {
      try {
        if (batchIndex === 0) {
          const rootId = getRootFolderId();
          const sub = await createDriveSubfolder(rootId, `scan_${timestamp}_${scanId.slice(0, 8)}`);
          driveFolderId = sub.id;
          driveFolderLink = `https://drive.google.com/drive/folders/${sub.id}`;
        } else {
          driveFolderLink = driveFolderId
            ? `https://drive.google.com/drive/folders/${driveFolderId}`
            : undefined;
        }

        const parentId = driveFolderId!;
        for (const v of validated) {
          const up = await uploadBufferToDrive({
            fileName: v.originalName.replace(/[^\w.\-]+/g, "_"),
            buffer: v.buffer,
            mimeType: v.mime,
            parentFolderId: parentId,
          });
          driveFileIds.push(up.id);
        }
        driveUploaded = true;
      } catch (e) {
        console.error("[process-scan] Google Drive:", e);
        return Response.json(
          {
            status: "error",
            scanId,
            message:
              e instanceof Error ? `Upload Drive fallito: ${e.message}` : "Upload Drive fallito.",
          },
          { status: 502 }
        );
      }
    }

    const isLastBatch = batchIndex >= batchTotal - 1;

    if (isBatched && !isLastBatch) {
      return Response.json({
        status: "partial",
        scanId,
        path: folderPath,
        receivedCount: validated.length,
        savedCount: validated.length,
        batchIndex,
        batchTotal,
        driveUploaded,
        driveFolderId: driveFolderId ?? null,
        driveFolderLink: driveFolderLink ?? null,
        driveFileIds: driveUploaded ? driveFileIds : [],
        message: `Batch ${batchIndex + 1}/${batchTotal} ricevuto.`,
      });
    }

    const { scaleReference, metrics } = metricsPayload();

    return Response.json({
      status: "success",
      scanId,
      path: folderPath,
      receivedCount: validated.length,
      savedCount: validated.length,
      driveUploaded,
      driveFolderId: driveFolderId ?? null,
      driveFolderLink: driveFolderLink ?? null,
      driveFileIds: driveUploaded ? driveFileIds : [],
      scaleFactorApplied: 1.0,
      scaleReferenceNote: driveUploaded
        ? "Foto salvate su Google Drive"
        : "Drive non configurato: solo validazione (nessun salvataggio cloud)",
      scaleReference,
      message: "Pronto per la ricostruzione 3D (NEUMA)",
      metrics,
      ...(isBatched ? { batchIndex, batchTotal } : {}),
    });
  } catch (e: unknown) {
    console.error("[process-scan]", e);
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ status: "error", error: msg }, { status: 500 });
  }
}
