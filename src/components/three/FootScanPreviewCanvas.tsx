"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Center, ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { PointCloud } from "@/lib/reconstruction/types";
import { buildPremiumFootDisplayMeshFromPointCloud } from "@/lib/visualization/premiumFootMeshFromPointCloud";
import { yieldToMain } from "@/lib/utils/yieldToMain";
import { getThreePerformanceProfile } from "@/hooks/useThreePerformanceProfile";
import { downsamplePointCloud } from "@/lib/visualization/downsamplePointCloud";

export type FootScanPreviewCanvasProps = {
  cloud: PointCloud;
};

export default function FootScanPreviewCanvas({ cloud }: FootScanPreviewCanvasProps) {
  const perf = useMemo(() => getThreePerformanceProfile(), []);

  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [pointsGeometry, setPointsGeometry] = useState<THREE.BufferGeometry | null>(null);

  // UI-only "WOW": points -> mesh
  const animStartAtMsRef = useRef<number | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: "#e5e5e5", // light gray
      roughness: 0.6,
      metalness: 0.0,
      emissive: new THREE.Color("#000000"),
      flatShading: false,
      transparent: true,
      opacity: 0,
    });
    return m;
  }, []);

  const pointsMaterial = useMemo(() => {
    return new THREE.PointsMaterial({
      color: "#e5e5e5",
      size: 0.012,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
  }, []);

  // Starts once mesh geometry is ready for this cloud.
  useEffect(() => {
    animStartAtMsRef.current = null;
  }, [cloud]);

  const idle = async () => {
    if (typeof window === "undefined") return;
    // Preferisci "idle time" quando disponibile (riduce hitch su mobile).
    const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void) => void);
    if (ric) {
      await new Promise<void>((resolve) => {
        ric(() => resolve());
      });
      return;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  };

  useEffect(() => {
    let cancelled = false;
    let prev: THREE.BufferGeometry | null = null;

    (async () => {
      prev = geometry;
      // UI-only: evitati frame hitching sul thread principale.
      await yieldToMain();
      await idle();

      // Pipeline richieste:
      // - downsample point cloud
      // - voxel grid + marching cubes
      // - laplacian smoothing + anti-sharp artifacts
      // - remove small imperfections (keep largest connected component)
      const meshOpts = perf.isMobileOrLowTier
        ? {
            // Mobile: low-detail OK, priorità a fluidità.
            maxDownsamplePoints: Math.min(5200, perf.maxPointCloudPoints),
            voxelGridResolution: 34,
            extraSmoothIterations: 2,
            extraSmoothLambda: 0.38,
            keepLargestComponent: true,
          }
        : {
            // Desktop: più “premium”.
            maxDownsamplePoints: 7000,
            voxelGridResolution: 38,
            extraSmoothIterations: 3,
            extraSmoothLambda: 0.42,
            keepLargestComponent: true,
          };

      const geom = buildPremiumFootDisplayMeshFromPointCloud(cloud, meshOpts);

      if (cancelled) {
        geom?.dispose();
        return;
      }

                // WOW animation: start from points, morph into mesh
                animStartAtMsRef.current = performance.now();
      setGeometry(geom);
    })().catch((e) => {
      console.error("[FootScanPreviewCanvas] build mesh", e);
    });

    return () => {
      cancelled = true;
      // Dispose geometry built on previous renders.
      if (prev) prev.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud]);

  useEffect(() => {
    let cancelled = false;
    const prev = pointsGeometry;

    (async () => {
      // UI-only: keep points lightweight so they animate smoothly.
      await yieldToMain();
      await idle();
      if (cancelled) return;
      const pointsCap = perf.isMobileOrLowTier ? 3600 : 6500;
      const ds = downsamplePointCloud(cloud, pointsCap);

      const geom = new THREE.BufferGeometry();
      const pos = ds.positions;
      geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      // Use vertex normals if present (optional for points).

      setPointsGeometry(geom);
    })().catch((e) => {
      console.error("[FootScanPreviewCanvas] build points", e);
    });

    return () => {
      cancelled = true;
      // Dispose previous geometry to avoid leaks on re-renders.
      if (prev) prev.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud]);

  useEffect(() => {
    return () => {
      material.dispose();
      pointsMaterial.dispose();
      if (geometry) geometry.dispose();
      if (pointsGeometry) pointsGeometry.dispose();
    };
  }, [material, geometry, pointsGeometry, pointsMaterial]);

  const AnimationDriver = () => {
    useFrame(() => {
      const start = animStartAtMsRef.current;
      if (start == null) return;

      const now = performance.now();
      const elapsed = now - start;
      const t = Math.min(1, Math.max(0, elapsed / 1000));
      // ease-out (cubic)
      const e = 1 - Math.pow(1 - t, 3);

      // Points fade out, mesh fades in.
      pointsMaterial.opacity = 1 - e;
      material.opacity = e;

      // Subtle scale change: compress points, expand mesh.
      if (meshRef.current) {
        const s = 0.98 + 0.02 * e;
        meshRef.current.scale.setScalar(s);
      }
      if (pointsRef.current) {
        const s = 1.02 - 0.02 * e;
        pointsRef.current.scale.setScalar(s);
      }

      if (t >= 1) {
        animStartAtMsRef.current = null;
        pointsMaterial.opacity = 0;
        material.opacity = 1;
        if (meshRef.current) meshRef.current.scale.setScalar(1);
        if (pointsRef.current) pointsRef.current.scale.setScalar(1);
      }
    });

    return null;
  };

  return (
    <Canvas
      dpr={[1, typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 1.75) : 1]}
      frameloop="always"
      camera={{ position: [0.3, 0.25, 1.35], fov: 35, near: 0.01, far: 20 }}
      gl={{ alpha: true, antialias: true, powerPreference: "default" }}
      className="h-[360px] w-full"
    >
      <ambientLight intensity={0.45} />
      {/* Luci “soft” per look premium (diffuse + direzionale bilanciata) */}
      <directionalLight position={[2.6, 3.4, 2.0]} intensity={0.65} color="#ffffff" />
      <directionalLight position={[-2.3, 1.7, -1.4]} intensity={0.25} color="#eaeaea" />
      <directionalLight position={[0.6, 2.0, -2.2]} intensity={0.18} color="#f2f2f2" />

      <Environment preset="studio" environmentIntensity={0.9} />

      {/* Ombra di contatto sotto il modello (leggera, non pesante) */}
      <ContactShadows
        position={[0, -0.01, 0]}
        opacity={0.28}
        scale={1.25}
        blur={1.6}
        far={1.2}
      />

      <Center>
                    <AnimationDriver />

                    {/* Start from points */}
                    {pointsGeometry ? (
                      <points ref={pointsRef} geometry={pointsGeometry} material={pointsMaterial} />
                    ) : null}

                    {/* Morph into smooth surface */}
                    {geometry ? (
                      <mesh ref={meshRef} geometry={geometry} material={material} />
                    ) : (
                      // Fallback while mesh is being built.
                      <mesh visible={false}>
                        <boxGeometry args={[0.6, 0.08, 0.28]} />
                        <meshStandardMaterial color="#e5e5e5" roughness={0.6} metalness={0} />
                      </mesh>
                    )}
      </Center>

      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom
        enableRotate
        autoRotate
        autoRotateSpeed={0.6}
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

