"use client";

import React, { Suspense, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import * as THREE from "three";
import { useThreePerformanceProfile } from "@/hooks/useThreePerformanceProfile";
import { ContactShadowPlane, FootPreviewStudioLighting } from "./FootPreviewLighting";
import FootPointCloudPreview from "./FootPointCloudPreview";
import type { PointCloud } from "@/lib/reconstruction/types";

/** `frameloop="demand"`: primo invalidate dopo luci/ombre per aggiornare shadow map */
function InvalidateOnce() {
  const { invalidate } = useThree();
  useEffect(() => {
    invalidate();
  }, [invalidate]);
  return null;
}

/**
 * Canvas completo per anteprima mesh da scansione: studio soft, ombre, HDRI leggero, mesh grigia premium.
 */
export default function FootScanPreviewCanvas({
  cloud,
}: {
  cloud: PointCloud;
}) {
  const perf = useThreePerformanceProfile();

  return (
    <Canvas
      shadows
      dpr={perf.dpr}
      frameloop="demand"
      camera={{ position: [0.26, 0.24, 0.92], fov: 34 }}
      gl={{
        alpha: true,
        antialias: !perf.isMobileOrLowTier,
        stencil: false,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: perf.isMobileOrLowTier ? 1.0 : 1.05,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      onCreated={({ gl }) => {
        gl.shadowMap.enabled = true;
        gl.shadowMap.type = perf.useSoftShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      }}
    >
      <InvalidateOnce />
      <FootPreviewStudioLighting
        shadowMapSize={perf.directionalShadowMapSize}
        shadowRadius={perf.shadowRadius}
        useSoftShadows={perf.useSoftShadows}
      />
      <ContactShadowPlane opacity={0.11} halfExtent={6.5} y={-0.002} />
      <Suspense fallback={null}>
        <Environment preset="studio" environmentIntensity={0.52} />
      </Suspense>
      <FootPointCloudPreview
        cloud={cloud}
        introAnimation
        showVisualizationToggle
        heatmapAxis="y"
      />
    </Canvas>
  );
}
