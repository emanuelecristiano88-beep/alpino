import { useEffect, useState } from "react";

export type ThreePerformanceProfile = {
  /** Narrow / touch / low CPU → lighter GPU load */
  isMobileOrLowTier: boolean;
  maxPointCloudPoints: number;
  /** Passed into marching-cubes / mesh source cap */
  meshMaxSourcePoints: number;
  /** Canvas `dpr` prop: [min, max] */
  dpr: [number, number];
  directionalShadowMapSize: number;
  /** PCFSoft is heavier than PCF */
  useSoftShadows: boolean;
  shadowRadius: number;
};

const DESKTOP: ThreePerformanceProfile = {
  isMobileOrLowTier: false,
  maxPointCloudPoints: 16_000,
  meshMaxSourcePoints: 3200,
  dpr: [1, 2],
  directionalShadowMapSize: 2048,
  useSoftShadows: true,
  shadowRadius: 6,
};

const MOBILE: ThreePerformanceProfile = {
  isMobileOrLowTier: true,
  maxPointCloudPoints: 7500,
  meshMaxSourcePoints: 2200,
  dpr: [1, 1.25],
  directionalShadowMapSize: 1024,
  useSoftShadows: false,
  shadowRadius: 2.5,
};

function computeFromWindow(): ThreePerformanceProfile {
  if (typeof window === "undefined") return DESKTOP;

  const coarseOrNarrow =
    window.matchMedia("(max-width: 768px)").matches ||
    window.matchMedia("(pointer: coarse)").matches;

  const cores =
    typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : 8;
  const lowCpu = cores <= 4;

  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const lowMem = typeof mem === "number" && mem <= 4;

  const mobile = coarseOrNarrow || lowCpu || lowMem;

  if (!mobile) return DESKTOP;

  /** Extra-tight profile on very small screens */
  const tiny = window.matchMedia("(max-width: 420px)").matches;
  if (tiny) {
    return {
      ...MOBILE,
      maxPointCloudPoints: 5500,
      meshMaxSourcePoints: 1800,
      directionalShadowMapSize: 768,
      dpr: [1, 1],
    };
  }

  return MOBILE;
}

/**
 * Tuning for Three.js on mid-range phones / tablets: fewer points, lower DPR, cheaper shadows.
 * Safe for SSR first paint: desktop defaults until `useEffect` runs (SPA: `useState` init uses window when available).
 */
export function useThreePerformanceProfile(): ThreePerformanceProfile {
  const [profile, setProfile] = useState<ThreePerformanceProfile>(() =>
    typeof window !== "undefined" ? computeFromWindow() : DESKTOP
  );

  useEffect(() => {
    setProfile(computeFromWindow());
    const mq = window.matchMedia("(max-width: 768px), (pointer: coarse)");
    const onChange = () => setProfile(computeFromWindow());
    mq.addEventListener("change", onChange);
    window.addEventListener("resize", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, []);

  return profile;
}
