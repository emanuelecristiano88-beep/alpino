/**
 * Upload su Google Drive (Service Account).
 * Variabili ambiente:
 * - GOOGLE_SERVICE_ACCOUNT_JSON: JSON completo del service account (stringa, una riga su Vercel)
 * - GOOGLE_DRIVE_FOLDER_ID: ID cartella Drive dove salvare (condividi la cartella con l'email del service account)
 */
import { createSign } from "node:crypto";

const SCOPES = ["https://www.googleapis.com/auth/drive"];
const DRIVE_REQUEST_TIMEOUT_MS = 8_000;

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

let cachedCreds: ServiceAccountCredentials | null = null;
let cachedToken: { value: string; expiresAtMs: number } | null = null;

function getCredentials(): ServiceAccountCredentials {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON non configurato");
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clientEmail = typeof parsed.client_email === "string" ? parsed.client_email : "";
    const privateKey = typeof parsed.private_key === "string" ? parsed.private_key : "";
    if (!clientEmail || !privateKey) {
      throw new Error("client_email/private_key mancanti");
    }
    return {
      client_email: clientEmail,
      private_key: privateKey,
      token_uri: typeof parsed.token_uri === "string" ? parsed.token_uri : undefined,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON non valido (JSON.parse): ${msg}`);
  }
}

function getServiceAccountCredentials() {
  if (cachedCreds) return cachedCreds;
  cachedCreds = getCredentials();
  return cachedCreds;
}

function hasOAuthUserConfig(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  );
}

function base64Url(input: Buffer | string): string {
  const b = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs - now > 20_000) {
    return cachedToken.value;
  }

  // Preferred for personal Google Drive: upload as the real user (has quota).
  if (hasOAuthUserConfig()) {
    const data = await fetchJsonWithTimeout<{ access_token?: string; expires_in?: number }>(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_OAUTH_CLIENT_ID as string,
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET as string,
          refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN as string,
          grant_type: "refresh_token",
        }),
      },
      "google.oauth.refreshToken"
    );
    const token = typeof data.access_token === "string" ? data.access_token : "";
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
    if (!token) throw new Error("Google OAuth user: access token mancante");
    cachedToken = {
      value: token,
      expiresAtMs: now + Math.max(60, expiresIn - 30) * 1000,
    };
    return token;
  }

  const creds = getServiceAccountCredentials();
  const tokenUri = creds.token_uri || "https://oauth2.googleapis.com/token";
  const nowSec = Math.floor(now / 1000);
  const payload = {
    iss: creds.client_email,
    scope: SCOPES.join(" "),
    aud: tokenUri,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const header = { alg: "RS256", typ: "JWT" };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const sig = signer.sign(creds.private_key);
  const assertion = `${unsigned}.${base64Url(sig)}`;

  const data = await fetchJsonWithTimeout<{ access_token?: string; expires_in?: number }>(
    tokenUri,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    },
    "google.oauth.token"
  );
  const token = typeof data.access_token === "string" ? data.access_token : "";
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  if (!token) throw new Error("Google auth: access token mancante");
  cachedToken = {
    value: token,
    expiresAtMs: now + Math.max(60, expiresIn - 30) * 1000,
  };
  return token;
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DRIVE_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
    });
    const txt = await res.text();
    if (!res.ok) {
      throw new Error(`${label} HTTP ${res.status}: ${txt.slice(0, 500)}`);
    }
    try {
      return JSON.parse(txt) as T;
    } catch {
      throw new Error(`${label} JSON non valido`);
    }
  } catch (e: unknown) {
    if (ctrl.signal.aborted) {
      throw new Error(`${label} timeout after ${DRIVE_REQUEST_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function isDriveConfigured(): boolean {
  const hasFolder = Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID);
  const hasServiceAccount = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return hasFolder && (hasServiceAccount || hasOAuthUserConfig());
}

export async function createDriveSubfolder(parentFolderId: string, name: string): Promise<{ id: string }> {
  const token = await getAccessToken();
  const safeName = name.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 200);
  const data = await fetchJsonWithTimeout<{ id?: string }>(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: safeName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId],
      }),
    },
    "drive.createFolder"
  );
  const id = data.id;
  if (!id) throw new Error("Drive: cartella non creata");
  return { id };
}

export async function uploadBufferToDrive(params: {
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  parentFolderId: string;
}): Promise<{ id: string; webViewLink?: string | null }> {
  const token = await getAccessToken();
  const safeName = params.fileName.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 200);
  const boundary = `neuma_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const meta = Buffer.from(
    JSON.stringify({
      name: safeName,
      parents: [params.parentFolderId],
    }),
    "utf8"
  );
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    "utf8"
  );
  const mid = Buffer.from(
    `\r\n--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const body = Buffer.concat([head, meta, mid, params.buffer, tail]);

  const data = await fetchJsonWithTimeout<{ id?: string }>(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
    `drive.uploadFile(${safeName})`
  );

  return { id: data.id ?? "", webViewLink: undefined };
}

export function getRootFolderId(): string {
  const raw = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!raw) throw new Error("GOOGLE_DRIVE_FOLDER_ID non configurato");
  // Hard sanitize: Vercel env può contenere newline/spazi invisibili da copy-paste.
  const id = raw.replace(/\s+/g, "").trim();
  if (!id) throw new Error("GOOGLE_DRIVE_FOLDER_ID vuoto dopo sanitizzazione");
  return id;
}
