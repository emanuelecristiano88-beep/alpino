/**
 * Lascia che il browser dipinga / processi input prima di lavoro pesante (main thread).
 */

export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(() => resolve(), 0);
    }
  });
}

/**
 * Due frame + macrotask: utile prima di marching cubes / mesh su mobile.
 */
export function deferHeavyWork(fn: () => void): void {
  if (typeof requestAnimationFrame === "undefined") {
    setTimeout(fn, 0);
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(fn, 0);
    });
  });
}
