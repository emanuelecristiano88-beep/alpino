import {
  createDriveSubfolder,
  getRootFolderId,
  isDriveConfigured,
  uploadBufferToDrive,
} from "./lib/googleDrive.js";

export const config = { runtime: "nodejs", maxDuration: 60 };

function checkUploadSecret(request: Request): boolean {
  const secret = process.env.UPLOAD_API_SECRET;
  if (!secret) return true;
  return request.headers.get("x-upload-secret") === secret;
}

function sanitizeScanId(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return `scan_${Date.now()}`;
  return s.replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 120) || `scan_${Date.now()}`;
}

function sanitizeFileName(raw: unknown, fallback: string): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  const base = s || fallback;
  return base.replace(/[^\w.\-]+/g, "_").slice(0, 180);
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }
  if (!checkUploadSecret(request)) {
    return Response.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }
  if (!isDriveConfigured()) {
    return Response.json({ ok: false, error: "Drive non configurato sul server" }, { status: 500 });
  }

  try {
    const form = await request.formData();
    const entry = form.get("photo");
    if (!(entry instanceof File)) {
      return Response.json({ ok: false, error: "Campo 'photo' mancante o non valido" }, { status: 400 });
    }

    const scanId = sanitizeScanId(form.get("scanId"));
    const fileName = sanitizeFileName(form.get("fileName"), entry.name || `photo_${Date.now()}.webp`);
    const existingFolderId = String(form.get("driveFolderId") ?? "").trim();

    let driveFolderId = existingFolderId;
    let driveFolderLink: string | null = driveFolderId ? `https://drive.google.com/drive/folders/${driveFolderId}` : null;

    if (!driveFolderId) {
      const rootId = getRootFolderId();
      const sub = await createDriveSubfolder(rootId, `scan_${scanId}`);
      driveFolderId = sub.id;
      driveFolderLink = `https://drive.google.com/drive/folders/${sub.id}`;
    }

    const buffer = Buffer.from(await entry.arrayBuffer());
    const mimeType = entry.type && entry.type.startsWith("image/") ? entry.type : "image/webp";

    const up = await uploadBufferToDrive({
      fileName,
      buffer,
      mimeType,
      parentFolderId: driveFolderId,
    });

    return Response.json({
      ok: true,
      scanId,
      driveUploaded: true,
      driveFolderId,
      driveFolderLink,
      fileId: up.id,
      fileName,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[upload-single]", e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

