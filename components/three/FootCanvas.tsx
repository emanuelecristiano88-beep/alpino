"use client";

import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useThreePerformanceProfile } from "@/hooks/useThreePerformanceProfile";

/** Piano ombra: solo ombre proiettate, look “prodotto” */
function ContactShadowPlane() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
      <planeGeometry args={[14, 14]} />
      <shadowMaterial opacity={0.2} transparent />
    </mesh>
  );
}

type StudioLightingProps = {
  shadowMapSize: number;
  shadowRadius: number;
  useSoftShadows: boolean;
};

/**
 * Key (alto-sinistra), fill (debole, lato opposto), ambiente basso + ombre.
 * Su mobile: mappa ombre più piccola e radius ridotto (PCF invece di PCF soft).
 */
function StudioProductLighting({ shadowMapSize, shadowRadius, useSoftShadows }: StudioLightingProps) {
  const keyRef = useRef<THREE.DirectionalLight>(null);

  useEffect(() => {
    const L = keyRef.current;
    if (!L?.shadow) return;
    const cam = L.shadow.camera as THREE.OrthographicCamera;
    L.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    L.shadow.bias = -0.00012;
    L.shadow.normalBias = 0.025;
    L.shadow.radius = useSoftShadows ? shadowRadius : 1.2;
    cam.near = 0.2;
    cam.far = 24;
    cam.left = -3.2;
    cam.right = 3.2;
    cam.top = 3.2;
    cam.bottom = -3.2;
    cam.updateProjectionMatrix();
  }, [shadowMapSize, shadowRadius, useSoftShadows]);

  return (
    <>
      <ambientLight intensity={0.14} color="#f2f2f4" />
      {/* Key: morbida, top-left rispetto alla camera frontale */}
      <directionalLight
        ref={keyRef}
        castShadow
        color="#fff9f5"
        intensity={1.08}
        position={[-3.4, 6.2, 2.8]}
      />
      {/* Fill: lato opposto, bassa — apre le ombre */}
      <directionalLight color="#e8eef8" intensity={0.2} position={[3.6, 1.8, -3.2]} />
    </>
  );
}

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
  shoeUrl?: string; // deve puntare a /public/models/*.glb
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

export default function FootCanvas({
  metrics,
  shoeUrl = "/models/placeholder_sneaker.glb",
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
        <StudioProductLighting
          shadowMapSize={perf.directionalShadowMapSize}
          shadowRadius={perf.shadowRadius}
          useSoftShadows={perf.useSoftShadows}
        />
        <ContactShadowPlane />

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
            <Environment preset="studio" intensity={0.42} environmentIntensity={0.85} />
            <ShoeModel shoeUrl={shoeUrl} metrics={metrics} />
          </GLTFErrorBoundary>
        </Suspense>

        <FootOrbitControlsWithInvalidate />
      </Canvas>
    </div>
  );
}

