"use client";

import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useThreePerformanceProfile } from "@/hooks/useThreePerformanceProfile";
import { ContactShadowPlane, FootPreviewStudioLighting } from "./FootPreviewLighting";

/** `frameloop="demand"`: orbit damping richiede invalidate ogni frame di interazione. */
function FootOrbitControlsWithInvalidate() {
  const { invalidate } = useThree();
  return (
    <OrbitControls
      enablePan={false}
      minPolarAngle={0.55}
      maxPolarAngle={Math.PI / 2 - 0.08}
      onChange={() => invalidate()}
    />
  );
}

type Metrics = { footLengthMm: number; forefootWidthMm: number };

type FootCanvasProps = {
  metrics: Metrics | null;
  shoeUrl?: string; // opzionale: deve puntare a /public/models/*.glb
  /** URL mesh piede (STL/GLB) dall’API — preparazione futura; oggi solo metadata sulla shell */
  meshUrl?: string;
};

class GLTFErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    metrics: Metrics | null;
    shoeUrl: string;
  },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      const scaleFactor = this.props.metrics
        ? this.props.metrics.footLengthMm / 280
        : 1;
      return (
        <group>
          <Html center>
            <div className="rounded border border-red-400 bg-black/75 px-3 py-2 text-xs text-red-200">
              ERRORE_CARICAMENTO_GLTF
              <div className="mt-1 text-[10px] opacity-80">{this.props.shoeUrl}</div>
              <div className="mt-1 text-[10px] opacity-80">scale={scaleFactor.toFixed(3)}</div>
            </div>
          </Html>
          {/* Fallback geometria: così non resti senza “scarpa” */}
          <group scale={[scaleFactor, scaleFactor, scaleFactor]}>
            <mesh position={[0, 0.04, 0]} castShadow={false}>
              <capsuleGeometry args={[0.12, 0.055, 20, 34]} />
              <meshStandardMaterial color="#bef264" roughness={0.55} metalness={0.08} />
            </mesh>
            <mesh position={[0, 0.01, 0]} castShadow={false}>
              <boxGeometry args={[0.24, 0.03, 0.12]} />
              <meshStandardMaterial color="#bef264" roughness={0.75} metalness={0.03} />
            </mesh>
          </group>
        </group>
      );
    }
    return this.props.children;
  }
}

function computeOffsetToCenterAndDrop(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const minY = box.min.y;
  // Centra in X/Z e “appoggia” il modello al suolo (Y=0)
  return new THREE.Vector3(-center.x, -minY, -center.z);
}

function ShoeModel({ shoeUrl, metrics }: { shoeUrl: string; metrics: Metrics | null }) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(shoeUrl) as unknown as { scene: THREE.Object3D };

  const scaleFactor = metrics ? metrics.footLengthMm / 280 : 1;

  const offset = useMemo(() => computeOffsetToCenterAndDrop(scene), [scene]);
  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.position.copy(offset);
  }, [offset]);

  useEffect(() => {
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }, [scene]);

  return (
    <group ref={groupRef} scale={[scaleFactor, scaleFactor, scaleFactor]}>
      <primitive object={scene} />
    </group>
  );
}

function NeutralFootFallback({ metrics }: { metrics: Metrics | null }) {
  const scaleFactor = metrics ? metrics.footLengthMm / 280 : 1;
  return (
    <group scale={[scaleFactor, scaleFactor, scaleFactor]}>
      <mesh position={[0, 0.035, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[0.11, 0.07, 16, 24]} />
        <meshStandardMaterial color="#d4d4d8" roughness={0.55} metalness={0.08} />
      </mesh>
      <mesh position={[0, 0.01, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.22, 0.028, 0.11]} />
        <meshStandardMaterial color="#e4e4e7" roughness={0.72} metalness={0.04} />
      </mesh>
    </group>
  );
}

export default function FootCanvas({
  metrics,
  shoeUrl,
  meshUrl,
}: FootCanvasProps) {
  const perf = useThreePerformanceProfile();
  const shoeScaleHint = metrics
    ? `scale=${(metrics.footLengthMm / 280).toFixed(3)}`
    : "scale=1.000";

  return (
    <div
      className="h-[360px] w-full overflow-hidden rounded-xl border border-white/10 bg-black/20"
      data-mesh-url={meshUrl ?? ""}
    >
      <Canvas
        shadows
        dpr={perf.dpr}
        frameloop="demand"
        camera={{ position: [0, 0.2, 0.72], fov: 34 }}
        gl={{
          alpha: true,
          antialias: !perf.isMobileOrLowTier,
          stencil: false,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: perf.isMobileOrLowTier ? 1.02 : 1.05,
        }}
        onCreated={({ gl }) => {
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = perf.useSoftShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
        }}
      >
        <FootPreviewStudioLighting
          shadowMapSize={perf.directionalShadowMapSize}
          shadowRadius={perf.shadowRadius}
          useSoftShadows={perf.useSoftShadows}
        />
        <ContactShadowPlane opacity={0.2} halfExtent={7} />

        <Suspense
          fallback={
            <Html center>
              <div className="rounded border border-blue-500/40 bg-black/60 px-3 py-2 text-xs text-blue-200">
                Preparazione anteprima 3D... ({shoeScaleHint})
              </div>
            </Html>
          }
        >
          <Environment preset="studio" intensity={0.42} environmentIntensity={0.85} />
          {shoeUrl ? (
            <GLTFErrorBoundary metrics={metrics} shoeUrl={shoeUrl}>
              <ShoeModel shoeUrl={shoeUrl} metrics={metrics} />
            </GLTFErrorBoundary>
          ) : (
            <NeutralFootFallback metrics={metrics} />
          )}
        </Suspense>

        <FootOrbitControlsWithInvalidate />
      </Canvas>
    </div>
  );
}

