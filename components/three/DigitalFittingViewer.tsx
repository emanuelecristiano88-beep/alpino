"use client";

/**
 * Viewer 3D del fitting. Il pannello inferiore del modal (slider, dati volume/taglia,
 * dashboard confronto biometrico SX/DX, invio in produzione) vive in `src/screens/LibraryScreen.tsx`.
 */
import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";

type Metrics = { footLengthMm: number; forefootWidthMm: number };

type DigitalFittingViewerProps = {
  /** 0 = scarpa opaca, 100 = scarpa molto trasparente (fitting “fantasma”) */
  shoeTransparencyPercent: number;
  metrics?: Metrics | null;
  footPlaceholderUrl?: string | null;
  shoeUrl?: string;
  className?: string;
};

function computeOffsetToCenterAndDrop(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const minY = box.min.y;
  return new THREE.Vector3(-center.x, -minY, -center.z);
}

/** Piede “scansionato”: placeholder geometrico (nessun .glb richiesto). */
function ScannedFootPlaceholder({ scaleFactor }: { scaleFactor: number }) {
  const skin = "#c9a27e";
  const rough = 0.62;
  return (
    <group scale={[scaleFactor * 0.95, scaleFactor * 0.95, scaleFactor * 0.95]} position={[0, 0.02, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.035, 0.06]} rotation={[0.15, 0, 0]}>
        <capsuleGeometry args={[0.055, 0.14, 8, 24]} />
        <meshStandardMaterial color={skin} roughness={rough} metalness={0.05} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.04, -0.05]}>
        <sphereGeometry args={[0.07, 24, 24]} />
        <meshStandardMaterial color={skin} roughness={rough} metalness={0.05} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.012, 0]}>
        <boxGeometry args={[0.09, 0.024, 0.22]} />
        <meshStandardMaterial color={skin} roughness={rough + 0.1} metalness={0.02} />
      </mesh>
    </group>
  );
}

function applyShoeOpacity(root: THREE.Object3D, opacity: number) {
  const clamped = THREE.MathUtils.clamp(opacity, 0.05, 1);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      if (!mat || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
      const m = mat as THREE.MeshStandardMaterial;
      m.transparent = true;
      m.opacity = clamped;
      m.depthWrite = clamped > 0.92;
      m.needsUpdate = true;
    });
  });
}

function ShoeOverlay({
  shoeUrl,
  metrics,
  opacity,
}: {
  shoeUrl: string;
  metrics: Metrics | null;
  opacity: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(shoeUrl) as unknown as { scene: THREE.Object3D };
  const scaleFactor = metrics ? metrics.footLengthMm / 280 : 1;
  const offset = useMemo(() => computeOffsetToCenterAndDrop(scene), [scene]);

  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.position.copy(offset);
  }, [offset]);

  useEffect(() => {
    applyShoeOpacity(scene, opacity);
  }, [scene, opacity]);

  return (
    <group ref={groupRef} scale={[scaleFactor, scaleFactor, scaleFactor]}>
      <primitive object={scene} />
    </group>
  );
}

function SceneContent({
  shoeUrl,
  metrics,
  shoeTransparencyPercent,
}: {
  shoeUrl: string;
  metrics: Metrics | null;
  shoeTransparencyPercent: number;
}) {
  const scaleFactor = metrics ? metrics.footLengthMm / 280 : 1;
  // Più alto % trasparenza → più “fantasma” la scarpa (opacity più bassa)
  const shoeOpacity = 1 - shoeTransparencyPercent / 100;

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[0.4, 0.9, 0.35]} intensity={1.15} />
      <directionalLight position={[-0.5, 0.3, -0.2]} intensity={0.35} color="#a78bfa" />
      <ScannedFootPlaceholder scaleFactor={scaleFactor} />
      <Suspense
        fallback={
          <Html center>
            <div className="rounded border border-violet-400/40 bg-black/70 px-3 py-2 text-xs text-violet-200">
              Caricamento scarpa (fitting)…
            </div>
          </Html>
        }
      >
        <Environment preset="studio" intensity={0.65} />
        <ShoeOverlay shoeUrl={shoeUrl} metrics={metrics} opacity={shoeOpacity} />
      </Suspense>
      <OrbitControls enablePan={false} minDistance={0.35} maxDistance={1.4} />
    </>
  );
}

/**
 * Visualizzatore fitting: piede placeholder + scarpa GLTF sovrapposta con trasparenza regolabile.
 * Nota: `footPlaceholderUrl` riservato per futuro .glb piede reale; oggi si usa geometria placeholder.
 */
export default function DigitalFittingViewer({
  shoeTransparencyPercent,
  metrics = { footLengthMm: 265, forefootWidthMm: 95 },
  shoeUrl = "/models/placeholder_sneaker.glb",
  className = "h-full min-h-[280px] w-full",
}: DigitalFittingViewerProps) {
  return (
    <div className={className}>
      <Canvas
        shadows={false}
        dpr={[1, 2]}
        frameloop="always"
        camera={{ position: [0.28, 0.22, 0.72], fov: 38 }}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      >
        <SceneContent
          shoeUrl={shoeUrl}
          metrics={metrics}
          shoeTransparencyPercent={shoeTransparencyPercent}
        />
      </Canvas>
    </div>
  );
}
