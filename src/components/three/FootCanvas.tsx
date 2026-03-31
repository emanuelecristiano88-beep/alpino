"use client";

import React, { useEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Center, Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

export type FootCanvasProps = {
  metrics: {
    footLengthMm: number;
    forefootWidthMm: number;
  };
  /**
   * Reserved (legacy). Nella nostra UI attuale la preview “premium” usa `FootScanPreviewCanvas`
   * con point cloud. Questo prop serve solo per mantenere compatibilità con `ScannerCattura`.
   */
  meshUrl?: string;
};

export default function FootCanvas({ metrics }: FootCanvasProps) {
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: "#e5e5e5",
      roughness: 0.6,
      metalness: 0.0,
      flatShading: false,
    });
  }, []);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  const lengthScale = Math.max(metrics.footLengthMm, 1) / 265; // normalize to ~1 for 265mm
  const widthScale = Math.max(metrics.forefootWidthMm, 1) / 95; // normalize to ~1 for 95mm

  return (
    <Canvas
      dpr={[1, typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 1.75) : 1]}
      frameloop="always"
      camera={{ position: [0.3, 0.25, 1.35], fov: 35, near: 0.01, far: 20 }}
      gl={{ alpha: true, antialias: true, powerPreference: "default" }}
      className="h-[360px] w-full"
    >
      <ambientLight intensity={0.45} />
      <directionalLight position={[2.4, 3.2, 1.7]} intensity={0.9} color="#ffffff" />
      <directionalLight position={[-2.2, 1.6, -1.1]} intensity={0.35} color="#eaeaea" />
      <Environment preset="studio" environmentIntensity={0.9} />

      <Center>
        {/* Placeholder UI (non produzione): semplice “sole” per mostrare che il viewer è attivo. */}
        <mesh rotation-x={-Math.PI / 2} material={material}>
          <capsuleGeometry args={[0.16 * widthScale, 0.6 * lengthScale, 14, 22]} />
        </mesh>
      </Center>

      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom
        enableRotate
        enableDamping
        dampingFactor={0.06}
        rotateSpeed={0.8}
        zoomSpeed={0.9}
        minDistance={0.35}
        maxDistance={4}
        minPolarAngle={0.12}
        maxPolarAngle={Math.PI - 0.18}
      />
    </Canvas>
  );
}

