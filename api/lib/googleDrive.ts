/**
 * Upload su Google Drive (Service Account).
 * Variabili ambiente:
 * - GOOGLE_SERVICE_ACCOUNT_JSON: JSON completo del service account (stringa, una riga su Vercel)
 * - GOOGLE_DRIVE_FOLDER_ID: ID cartella Drive dove salvare (condividi la cartella con l'email del service account)
 */
import { Readable } from "node:stream";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive"];
const DRIVE_REQUEST_TIMEOUT_MS = 25_000;

let cachedDrive: ReturnType<typeof google.drive> | null = null;
let cachedAuth: google.auth.GoogleAuth | null = null;

function getDriveClient() {
  if (cachedDrive && cachedAuth) return cachedDrive;
  cachedAuth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: SCOPES,
  });
  cachedDrive = google.drive({ version: "v3", auth: cachedAuth });
  return cachedDrive;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    });
    return (await Promise.race([promise, timeoutPromise])) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getCredentials(): Record<string, unknown> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON non configurato");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON non valido (JSON.parse): ${msg}`);
  }
}

export function isDriveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

export async function createDriveSubfolder(parentFolderId: string, name: string): Promise<{ id: string }> {
  const drive = getDriveClient();
  const safeName = name.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 200);
  const res = await withTimeout(
    drive.files.create(
      {
        requestBody: {
          name: safeName,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentFolderId],
        },
        fields: "id",
      },
      {
        timeout: DRIVE_REQUEST_TIMEOUT_MS,
        retry: false,
      }
    ),
    DRIVE_REQUEST_TIMEOUT_MS + 2_000,
    "drive.files.create(folder)"
  );
  const id = res.data.id;
  if (!id) throw new Error("Drive: cartella non creata");
  return { id };
}

export async function uploadBufferToDrive(params: {
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  parentFolderId: string;
}): Promise<{ id: string; webViewLink?: string | null }> {
  const drive = getDriveClient();
  const safeName = params.fileName.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 200);

  const res = await withTimeout(
    drive.files.create(
      {
        requestBody: {
          name: safeName,
          parents: [params.parentFolderId],
        },
        media: {
          mimeType: params.mimeType,
          body: Readable.from(params.buffer),
        },
        fields: "id",
      },
      {
        timeout: DRIVE_REQUEST_TIMEOUT_MS,
        retry: false,
      }
    ),
    DRIVE_REQUEST_TIMEOUT_MS + 2_000,
    `drive.files.create(file:${safeName})`
  );

  return { id: res.data.id ?? "", webViewLink: undefined };
}

export function getRootFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!id) throw new Error("GOOGLE_DRIVE_FOLDER_ID non configurato");
  return id;
}
