import { supabase } from "./supabase";

const BUCKET = "raw-scans";

/**
 * Inserts a new row in the `scans` table (id is autoincrement int8).
 * Returns the generated numeric id.
 */
export async function createNewScan(): Promise<number> {
  const { data, error } = await supabase
    .from("scans")
    .insert({ created_at: new Date().toISOString() })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`[scanService] createNewScan failed: ${error?.message ?? "no data"}`);
  }

  return data.id as number;
}

/**
 * Uploads a video chunk to Supabase Storage.
 * Path: raw-scans/<scanId>/chunk_<index>.webm
 */
export async function uploadVideoChunk(
  scanId: number,
  chunkIndex: number,
  blob: Blob
): Promise<string> {
  const path = `${scanId}/chunk_${String(chunkIndex).padStart(5, "0")}.webm`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      contentType: blob.type || "video/webm",
      upsert: false,
    });

  if (error) {
    throw new Error(`[scanService] uploadVideoChunk ${path} failed: ${error.message}`);
  }

  return path;
}

/**
 * Updates fields on an existing scan row.
 */
export async function updateScan(
  scanId: number,
  fields: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("scans")
    .update(fields)
    .eq("id", scanId);

  if (error) {
    console.error("[scanService] updateScan failed:", error.message);
  }
}

/**
 * Uploads the full scan video as a single file.
 * Returns the storage path (e.g. "scan_1710000000000.webm").
 */
export async function uploadFullScan(filename: string, blob: Blob): Promise<string> {
  const maxAttempts = 4;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filename, blob, {
        contentType: blob.type || "video/webm",
        upsert: false,
      });

    if (!error) return filename;

    lastErr = error;
    const retryable =
      // Supabase errors are not strongly typed across transports; be conservative.
      /timeout|network|fetch|connection|503|502|504|rate|tempor/i.test(error.message);
    if (!retryable || attempt === maxAttempts) break;

    const backoffMs = Math.min(4000, 350 * 2 ** (attempt - 1)) + Math.round(Math.random() * 220);
    await new Promise((r) => setTimeout(r, backoffMs));
  }

  const msg = lastErr && typeof lastErr === "object" && "message" in lastErr ? String((lastErr as { message: unknown }).message) : String(lastErr);
  throw new Error(`[scanService] uploadFullScan "${filename}" failed: ${msg}`);

}
