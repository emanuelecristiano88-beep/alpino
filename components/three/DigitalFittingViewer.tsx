"use client";

/**
 * Viewer 3D fitting: piede placeholder + scarpa da STL (Bambu Studio) o GLB.
 * STL: MeshPhysicalMaterial blu scansione + PointLight che segue la camera.
 */
import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Environment, Html, OrbitControls, useGLTF } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import * as THREE from "three";

type Metrics = { footLengthMm: number; forefootWidthMm: number };

type DigitalFittingViewerProps = {
  shoeTransparencyPercent: number;
  metrics?: Metrics | null;
  footPlaceholderUrl?: string | null;
  /** GLB oppure STL (es. `/models/scarpa.stl` in `public/models/`). */
  shoeUrl?: string;
  className?: string;
};

/** Lato lungo massimo nel mondo della scena (adatta alla card). */
const FIT_MAX_EXTENT = 0.36;

function computeOffsetToCenterAndDrop(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const minY = box.min.y;
  return new THREE.Vector3(-center.x, -minY, -center.z);
}

function useHeatScanTexture() {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return new THREE.Texture();
    }
    const g = ctx.createLinearGradient(0, 256, 256, 0);
    g.addColorStop(0, "#020617");
    g.addColorStop(0.25, "#0369a1");
    g.addColorStop(0.55, "#22d3ee");
    g.addColorStop(0.8, "#3b82f6");
    g.addColorStop(1, "#6366f1");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.2, 1.2);
    return tex;
  }, []);
}

const footMat = {
  color: "#e0f2fe" as const,
  metalness: 0.22,
  roughness: 0.35,
  clearcoat: 0.55,
  clearcoatRoughness: 0.28,
  emissive: "#1d4ed8" as const,
  emissiveIntensity: 0.22,
};

function HeatScannedFootPlaceholder({ scaleFactor }: { scaleFactor: number }) {
  const map = useHeatScanTexture();
  const s = scaleFactor * 0.95;

  return (
    <group scale={[s, s, s]} position={[0, 0.02, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.035, 0.06]} rotation={[0.15, 0, 0]}>
        <capsuleGeometry args={[0.055, 0.14, 8, 24]} />
        <meshPhysicalMaterial {...footMat} map={map} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.04, -0.05]}>
        <sphereGeometry args={[0.07, 24, 24]} />
        <meshPhysicalMaterial {...footMat} map={map} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.012, 0]}>
        <boxGeometry args={[0.09, 0.024, 0.22]} />
        <meshPhysicalMaterial {...footMat} map={map} />
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

/** PointLight blu legata alla posizione della camera (evidenzia rilievi). */
function CameraFollowPointLight() {
  const lightRef = useRef<THREE.PointLight>(null);
  const { camera } = useThree();

  useFrame(() => {
    const L = lightRef.current;
    if (!L) return;
    L.position.copy(camera.position);
  });

  return (
    <pointLight
      ref={lightRef}
      color="#60a5fa"
      intensity={2.2}
      distance={4.5}
      decay={2}
    />
  );
}

function StlBambuShoe({
  url,
  baseOpacity,
}: {
  url: string;
  /** 0–1 da slider trasparenza (moltiplica 0.8 base). */
  baseOpacity: number;
}) {
  const geometry = useLoader(STLLoader, url) as THREE.BufferGeometry;

  const { centeredGeo, uniformScale } = useMemo(() => {
    const g = geometry.clone();
    g.computeVertexNormals();
    g.center();
    g.computeBoundingBox();
    const box = g.boundingBox;
    if (!box) {
      return { centeredGeo: g, uniformScale: 1 };
    }
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    const uniformScale = FIT_MAX_EXTENT / maxDim;
    return { centeredGeo: g, uniformScale };
  }, [geometry]);

  const matOpacity = THREE.MathUtils.clamp(0.8 * baseOpacity, 0.12, 1);

  return (
    <group scale={[uniformScale, uniformScale, uniformScale]} position={[0, 0.02, 0]}>
      {/* Corpo: materiale fisico blu scansione */}
      <mesh geometry={centeredGeo} castShadow receiveShadow>
        <meshPhysicalMaterial
          color="#0066ff"
          emissive="#2563eb"
          emissiveIntensity={0.85}
          metalness={0.25}
          roughness={0.38}
          clearcoat={0.35}
          clearcoatRoughness={0.4}
          transparent
          opacity={matOpacity}
          depthWrite={matOpacity > 0.65}
          wireframe
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Griglia wireframe sottile sopra (effetto digitale) */}
      <mesh geometry={centeredGeo} scale={1.002} renderOrder={1}>
        <meshBasicMaterial
          color="#7dd3fc"
          wireframe
          transparent
          opacity={0.22}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function MillimeterGrid() {
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(1.6, 32, 0x3b82f6, 0x3f3f46);
    g.position.y = -0.02;
    return g;
  }, []);
  return <primitive object={grid} />;
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
  const shoeOpacity = 1 - shoeTransparencyPercent / 100;
  const isStl = shoeUrl.toLowerCase().endsWith(".stl");

  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[0.45, 0.95, 0.4]} intensity={0.85} color="#ffffff" />
      <directionalLight position={[-0.55, 0.35, -0.25]} intensity={0.35} color="#38bdf8" />
      <CameraFollowPointLight />

      <MillimeterGrid />
      <HeatScannedFootPlaceholder scaleFactor={scaleFactor} />

      <Suspense
        fallback={
          <Html center>
            <div className="rounded border border-blue-500/40 bg-black/70 px-3 py-2 text-xs text-blue-200">
              Caricamento scarpa (STL / GLB)…
            </div>
          </Html>
        }
      >
        <Environment preset="studio" intensity={0.45} />
        {isStl ? (
          <StlBambuShoe url={shoeUrl} baseOpacity={shoeOpacity} />
        ) : (
          <ShoeOverlay shoeUrl={shoeUrl} metrics={metrics} opacity={shoeOpacity} />
        )}
      </Suspense>
      <OrbitControls enablePan={false} minDistance={0.35} maxDistance={1.45} target={[0, 0.06, 0]} />
    </>
  );
}

/** Default: metti il tuo file in `public/models/` e allinea il nome. */
const DEFAULT_SHOE_MODEL = "/models/scarpa.stl";

export default function DigitalFittingViewer({
  shoeTransparencyPercent,
  metrics = { footLengthMm: 265, forefootWidthMm: 95 },
  shoeUrl = DEFAULT_SHOE_MODEL,
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
