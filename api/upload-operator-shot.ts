/**
 * Vercel Serverless (Node.js) — POST /api/upload-operator-shot
 * Singola foto dallo ScannerOperatore (cupola 32 settori).
 */
import { isDriveConfigured, uploadBufferToDrive, getRootFolderId } from "./lib/googleDrive.js";

export const config = { runtime: "nodejs", maxDuration: 30 };

function checkUploadSecret(request: Request): boolean {
  const secret = process.env.UPLOAD_API_SECRET;
  if (!secret) return true;
  return request.headers.get("x-upload-secret") === secret;
}

function sanitizeSessionId(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "session";
  return s.replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 80) || "session";
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  if (!checkUploadSecret(request)) {
    return Response.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  try {
    const form = await request.formData();
    const entry = form.get("photo");
    const sectorRaw = form.get("sector");
    const sessionId = sanitizeSessionId(form.get("sessionId"));

    if (!(entry instanceof File)) {
      return Response.json({ ok: false, error: "Campo 'photo' mancante o non valido" }, { status: 400 });
    }

    const sector = Number(sectorRaw);
    if (!Number.isFinite(sector) || sector < 0 || sector > 127) {
      return Response.json({ ok: false, error: "sector non valido" }, { status: 400 });
    }

    const buf = Buffer.from(await entry.arrayBuffer());
    if (buf.length < 32) {
      return Response.json({ ok: false, error: "File troppo piccolo" }, { status: 400 });
    }

    if (!isDriveConfigured()) {
      return Response.json({
        ok: true,
        driveUploaded: false,
        message: "Drive non configurato sul server (solo dev / mock).",
      });
    }

    const rootId = getRootFolderId();
    const fileName = `operator_${sessionId}_sector_${String(sector).padStart(2, "0")}.jpg`;
    const mime = entry.type || "image/jpeg";

    const up = await uploadBufferToDrive({
      fileName,
      buffer: buf,
      mimeType: mime.startsWith("image/") ? mime : "image/jpeg",
      parentFolderId: rootId,
    });

    return Response.json({
      ok: true,
      driveUploaded: true,
      fileId: up.id,
      webViewLink: up.webViewLink ?? null,
      fileName,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[upload-operator-shot]", e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
