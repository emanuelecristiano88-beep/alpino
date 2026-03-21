"use client";

import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";

type Metrics = { footLengthMm: number; forefootWidthMm: number };

type FootCanvasProps = {
  metrics: Metrics | null;
  shoeUrl?: string; // deve puntare a /public/models/*.glb
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

  return (
    <group ref={groupRef} scale={[scaleFactor, scaleFactor, scaleFactor]}>
      <primitive object={scene} />
    </group>
  );
}

export default function FootCanvas({ metrics, shoeUrl = "/models/placeholder_sneaker.glb" }: FootCanvasProps) {
  const shoeScaleHint = metrics
    ? `scale=${(metrics.footLengthMm / 280).toFixed(3)}`
    : "scale=1.000";

  return (
    <div className="h-[360px] w-full overflow-hidden rounded-xl border border-white/10 bg-black/20">
      <Canvas
        shadows={false}
        dpr={[1, 2]}
        frameloop="demand"
        camera={{ position: [0, 0.18, 0.7], fov: 35 }}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      >
        <ambientLight intensity={0.45} />
        <directionalLight position={[0.35, 0.8, 0.35]} intensity={1.25} />
        <Suspense
          fallback={
            <Html center>
              <div className="rounded border border-blue-500/40 bg-black/60 px-3 py-2 text-xs text-blue-200">
                Caricamento sneaker... ({shoeScaleHint})
              </div>
            </Html>
          }
        >
          <GLTFErrorBoundary metrics={metrics} shoeUrl={shoeUrl}>
            <Environment preset="studio" intensity={0.7} />
            <ShoeModel shoeUrl={shoeUrl} metrics={metrics} />
          </GLTFErrorBoundary>
        </Suspense>

        <OrbitControls enablePan={false} />
      </Canvas>
    </div>
  );
}

