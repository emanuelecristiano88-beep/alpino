import {
  createDriveSubfolder,
  getRootFolderId,
  isDriveConfigured,
  uploadBufferToDrive,
} from "./lib/googleDrive.js";

export const config = { runtime: "nodejs", maxDuration: 60 };

type UploadSingleBody = {
  imageBase64: string;
  fileName?: string;
  folderId?: string;
  scanId?: string;
  mimeType?: string;
};

function readHeader(request: any, key: string): string | null {
  if (request?.headers?.get) return request.headers.get(key);
  const v = request?.headers?.[key] ?? request?.headers?.[key.toLowerCase()];
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? null : null;
}

function checkUploadSecret(request: any): boolean {
  const secret = process.env.UPLOAD_API_SECRET;
  if (!secret) return true;
  return readHeader(request, "x-upload-secret") === secret;
}

function sendJson(request: any, res: any, body: Record<string, unknown>, status = 200) {
  if (res && typeof res.status === "function" && typeof res.json === "function") {
    res.status(status).json(body);
    return;
  }
  return Response.json(body, { status });
}

async function readRequestJson(request: any): Promise<UploadSingleBody> {
  if (request?.json && typeof request.json === "function") {
    return (await request.json()) as UploadSingleBody;
  }
  if (request?.body && typeof request.body === "object" && !request.on) {
    return request.body as UploadSingleBody;
  }
  // Node IncomingMessage fallback
  const raw = await new Promise<string>((resolve, reject) => {
    let data = "";
    request.on("data", (c: Buffer | string) => {
      data += typeof c === "string" ? c : c.toString("utf8");
    });
    request.on("end", () => resolve(data));
    request.on("error", (e: unknown) => reject(e));
  });
  return JSON.parse(raw || "{}") as UploadSingleBody;
}

function sanitizeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 180);
}

function sanitizeScanId(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return `scan_${Date.now()}`;
  return s.replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 120) || `scan_${Date.now()}`;
}

function parseBase64Payload(raw: string): Buffer {
  const trimmed = raw.trim();
  const base64 = trimmed.startsWith("data:") ? (trimmed.split(",", 2)[1] || "") : trimmed;
  if (!base64) throw new Error("imageBase64 vuoto");
  return Buffer.from(base64, "base64");
}

export default async function handler(request: any, res?: any): Promise<Response | void> {
  if (request.method !== "POST") {
    return sendJson(request, res, { ok: false, error: "Method not allowed" }, 405);
  }
  if (!checkUploadSecret(request)) {
    return sendJson(request, res, { ok: false, error: "Non autorizzato" }, 401);
  }
  if (!isDriveConfigured()) {
    return sendJson(request, res, { ok: false, error: "Drive non configurato" }, 500);
  }

  try {
    const tLabel = `upload-single:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    console.time(tLabel);

    const body = await readRequestJson(request);
    console.timeLog(tLabel, "JSON body parsed");
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    if (!imageBase64) {
      return sendJson(request, res, { ok: false, error: "Campo imageBase64 mancante" }, 400);
    }

    const scanId = sanitizeScanId(body.scanId);
    const fileName = sanitizeName(body.fileName || `photo_${Date.now()}.webp`);
    const mimeType =
      typeof body.mimeType === "string" && body.mimeType.startsWith("image/")
        ? body.mimeType
        : "image/webp";
    const buffer = parseBase64Payload(imageBase64);
    console.timeLog(tLabel, `Payload decoded (${Math.round(buffer.length / 1024)}KB)`);
    if (buffer.length < 64) {
      return sendJson(request, res, { ok: false, error: "Payload immagine troppo piccolo" }, 400);
    }

    let folderId = typeof body.folderId === "string" ? body.folderId.replace(/\s+/g, "").trim() : "";
    let folderLink: string | null = folderId ? `https://drive.google.com/drive/folders/${folderId}` : null;

    if (!folderId) {
      const root = getRootFolderId();
      const sub = await createDriveSubfolder(root, `scan_${scanId}`);
      folderId = sub.id;
      folderLink = `https://drive.google.com/drive/folders/${folderId}`;
      console.timeLog(tLabel, "Drive subfolder created");
    }

    const up = await uploadBufferToDrive({
      fileName,
      buffer,
      mimeType,
      parentFolderId: folderId,
    });
    console.timeLog(tLabel, "Drive file uploaded");
    console.timeEnd(tLabel);

    return sendJson(request, res, {
      ok: true,
      fileId: up.id,
      fileName,
      driveFolderId: folderId,
      driveFolderLink: folderLink,
      scanId,
      driveUploaded: true,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[upload-single]", e);
    return sendJson(request, res, { ok: false, error: msg }, 500);
  }
}

