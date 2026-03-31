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
