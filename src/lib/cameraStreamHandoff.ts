/**
 * Passa lo stream dalla richiesta getUserMedia sul tap del tutorial (user gesture iOS)
 * al mount dello scanner, senza fermare i track nel mezzo (evita seconda getUserMedia fragile).
 */
let handoff: MediaStream | null = null;

export function setCameraStreamHandoff(stream: MediaStream | null): void {
  if (handoff && handoff !== stream) {
    handoff.getTracks().forEach((t) => t.stop());
  }
  handoff = stream;
}

export function takeCameraStreamHandoff(): MediaStream | null {
  const s = handoff;
  handoff = null;
  return s;
}

export function discardCameraStreamHandoff(): void {
  if (handoff) {
    handoff.getTracks().forEach((t) => t.stop());
    handoff = null;
  }
}
