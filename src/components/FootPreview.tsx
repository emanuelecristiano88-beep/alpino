import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader";
import * as THREE from "three";

type Props = {
  length: number;
  width: number;
  height?: number;
};

function estimateHeightMm(length: number, width: number) {
  return Math.max(28, Math.min(55, 0.18 * length + 0.06 * width));
}

const MATERIAL_PROPS = {
  color: "#c8cdd3",
  roughness: 0.7,
  metalness: 0,
  clearcoat: 0.15,
  clearcoatRoughness: 0.4,
  envMapIntensity: 0.6,
} as const;

class ModelErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[FootPreview] model load failed, falling back:", error);
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function useFirstMeshGeometryFromObj(obj: THREE.Group) {
  return useMemo(() => {
    let geo: THREE.BufferGeometry | null = null;
    obj.traverse((child) => {
      if (!geo && (child as THREE.Mesh).isMesh) {
        geo = (child as THREE.Mesh).geometry.clone();
      }
    });
    geo?.computeVertexNormals();
    return geo;
  }, [obj]);
}

function FootModelCore({
  geometry,
  length,
  width,
  height,
}: Required<Props> & { geometry: THREE.BufferGeometry }) {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const [ready, setReady] = useState(false);
  const revealStart = useRef(0);

  const { scale, offset } = useMemo(() => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const sx = width / Math.max(1e-6, size.x);
    const sy = height / Math.max(1e-6, size.y);
    const sz = length / Math.max(1e-6, size.z);

    return { scale: new THREE.Vector3(sx, sy, sz), offset: center.negate() };
  }, [geometry, length, width, height]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    const mat = materialRef.current;
    if (!group) return;

    if (!ready) {
      revealStart.current = clock.elapsedTime;
      setReady(true);
    }

    const elapsed = clock.elapsedTime - revealStart.current;

    const revealT = Math.min(1, elapsed / 0.6);
    const ease = 1 - Math.pow(1 - revealT, 3);
    const s = 0.8 + 0.2 * ease;
    group.scale.set(scale.x * s, scale.y * s, scale.z * s);

    if (mat) mat.opacity = ease;

    const targetSpeed = (Math.PI * 2) / 72;
    group.rotation.y += targetSpeed * clock.getDelta();

    group.position.y = offset.y + Math.sin(clock.elapsedTime * 1.15) * 0.015;
  });

  return (
    <group ref={groupRef} position={[offset.x, offset.y, offset.z]} rotation={[-0.08, 0, 0]}>
      <mesh geometry={geometry} castShadow>
        <meshPhysicalMaterial
          ref={materialRef}
          {...MATERIAL_PROPS}
          transparent
          opacity={0}
        />
      </mesh>
    </group>
  );
}

function FootObjModel(props: Required<Props>) {
  const obj = useLoader(OBJLoader, "/models/feet.obj");
  const geometry = useFirstMeshGeometryFromObj(obj as THREE.Group);
  if (!geometry) throw new Error("OBJ loaded but no mesh geometry found");
  return <FootModelCore {...props} geometry={geometry} />;
}

function FootStlModel(props: Required<Props>) {
  const stlGeom = useLoader(STLLoader, "/models/foot_template.stl");
  const geometry = useMemo(() => {
    const g = (stlGeom as THREE.BufferGeometry).clone();
    g.computeVertexNormals();
    return g;
  }, [stlGeom]);
  return <FootModelCore {...props} geometry={geometry} />;
}

function FallbackSpinner() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
    </div>
  );
}

function MeasurementsOverlay({ length, width }: { length: number; width: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 600);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={`
        pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-5
        transition-all duration-700 ease-out
        ${visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}
      `}
    >
      <div className="mx-auto max-w-[320px] rounded-2xl border border-white/15 bg-white/[0.07] px-5 py-4 backdrop-blur-xl">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
          Misure rilevate
        </div>
        <div className="flex items-end justify-between gap-6">
          <div>
            <div className="text-[11px] font-medium text-white/50">Lunghezza</div>
            <div className="text-2xl font-semibold tabular-nums tracking-tight text-white">
              {length.toFixed(0)}<span className="ml-0.5 text-sm font-normal text-white/40">mm</span>
            </div>
          </div>
          <div className="mb-0.5 h-8 w-px bg-white/10" />
          <div>
            <div className="text-[11px] font-medium text-white/50">Larghezza</div>
            <div className="text-2xl font-semibold tabular-nums tracking-tight text-white">
              {width.toFixed(0)}<span className="ml-0.5 text-sm font-normal text-white/40">mm</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FootPreview({ length, width, height }: Props) {
  const h = height ?? estimateHeightMm(length, width);

  return (
    <div className="relative h-full w-full">
      <Suspense fallback={<FallbackSpinner />}>
        <Canvas
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "default",
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.05,
          }}
          dpr={[1, 1.75]}
          camera={{ fov: 38, near: 0.1, far: 2000, position: [0.18, 0.14, 0.19] }}
          style={{ background: "#000" }}
        >
          <Environment preset="studio" />

          <ModelErrorBoundary fallback={<FootStlModel length={length} width={width} height={h} />}>
            <FootObjModel length={length} width={width} height={h} />
          </ModelErrorBoundary>

          <ContactShadows
            position={[0, -0.04, 0]}
            opacity={0.35}
            scale={0.8}
            blur={2.5}
            far={0.6}
          />
        </Canvas>
      </Suspense>

      <MeasurementsOverlay length={length} width={width} />
    </div>
  );
}
