"use client";

/**
 * Viewer stile “Luma / Genie”: mesh 3D + IBL (environment map) per riflessi tipo prodotto reale.
 *
 * Nota pipeline Gaussian Splats / NeRF: Luma usa spesso splat 3D (punti gaussiani) invece di triangoli.
 * Per integrare davvero uno splat viewer servirebbe un asset .ply/.splat e una lib dedicata
 * (es. spark / gsplat); qui usiamo GLB + MeshPhysicalMaterial come anteprima produzione
 * finché gli splat non sono in catalogo.
 */
import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Grid,
  Html,
  OrbitControls,
  useGLTF,
} from "@react-three/drei";
import * as THREE from "three";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { cn } from "../lib/utils";
import type { ShoeCatalogItem } from "../data/shoeCatalog";

export type LumaMaterialPreset = "tpu" | "fabric" | "carbon";

const MATERIAL_LABELS: Record<LumaMaterialPreset, string> = {
  tpu: "TPU Opaco",
  fabric: "Effetto Tessuto",
  carbon: "Carbon Look",
};

function computeOffsetToFloor(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const minY = box.min.y;
  return new THREE.Vector3(-center.x, -minY, -center.z);
}

function cloneSceneWithMaterials(scene: THREE.Object3D) {
  const root = scene.clone(true);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => m.clone());
    } else {
      mesh.material = mesh.material.clone();
    }
  });
  return root;
}

function upgradeToPhysical(mat: THREE.Material): THREE.MeshPhysicalMaterial {
  if (mat instanceof THREE.MeshPhysicalMaterial) {
    return mat;
  }
  if (mat instanceof THREE.MeshStandardMaterial) {
    const p = new THREE.MeshPhysicalMaterial();
    p.copy(mat);
    return p;
  }
  const p = new THREE.MeshPhysicalMaterial();
  if ("map" in mat && (mat as THREE.MeshBasicMaterial).map) {
    p.map = (mat as THREE.MeshBasicMaterial).map;
  }
  if ("color" in mat && (mat as THREE.MeshBasicMaterial).color) {
    p.color.copy((mat as THREE.MeshBasicMaterial).color);
  }
  return p;
}

function applyLumaPreset(root: THREE.Object3D, preset: LumaMaterialPreset) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((m) => {
      const phys = upgradeToPhysical(m);
      phys.transparent = false;
      phys.opacity = 1;
      phys.depthWrite = true;

      switch (preset) {
        case "tpu":
          phys.roughness = 0.26;
          phys.metalness = 0.08;
          phys.clearcoat = 0.95;
          phys.clearcoatRoughness = 0.14;
          phys.sheen = 0.15;
          phys.sheenRoughness = 0.4;
          phys.envMapIntensity = 1.35;
          break;
        case "fabric":
          phys.roughness = 0.88;
          phys.metalness = 0.02;
          phys.clearcoat = 0.12;
          phys.clearcoatRoughness = 0.55;
          phys.sheen = 1;
          phys.sheenRoughness = 0.7;
          phys.sheenColor = new THREE.Color(0x9ca3af);
          phys.envMapIntensity = 0.55;
          break;
        case "carbon":
          phys.color = new THREE.Color(0x141418);
          phys.roughness = 0.32;
          phys.metalness = 0.78;
          phys.clearcoat = 0.62;
          phys.clearcoatRoughness = 0.18;
          phys.sheen = 0.25;
          phys.envMapIntensity = 1.5;
          break;
        default:
          break;
      }
      phys.needsUpdate = true;
      return phys;
    });
    mesh.material = next.length === 1 ? next[0] : next;
  });
}

function LumaShoe({
  glbSrc,
  materialPreset,
}: {
  glbSrc: string;
  materialPreset: LumaMaterialPreset;
}) {
  const { scene } = useGLTF(glbSrc) as unknown as { scene: THREE.Object3D };

  const clone = useMemo(() => cloneSceneWithMaterials(scene), [scene, glbSrc]);
  const offset = useMemo(() => computeOffsetToFloor(clone), [clone]);

  useLayoutEffect(() => {
    applyLumaPreset(clone, materialPreset);
  }, [clone, materialPreset]);

  return (
    <group scale={0.85} position={[offset.x, offset.y, offset.z]}>
      <primitive object={clone} />
    </group>
  );
}

/** Mantiene alpha pulito ogni frame (video dietro). */
function TransparentClear() {
  const { gl, scene } = useThree();
  useFrame(() => {
    gl.setClearColor(0x000000, 0);
    scene.background = null;
  });
  return null;
}

function LumaScene({
  glbSrc,
  materialPreset,
}: {
  glbSrc: string;
  materialPreset: LumaMaterialPreset;
}) {
  return (
    <>
      <TransparentClear />
      <ambientLight intensity={0.35} />
      <directionalLight position={[2.2, 4, 1.5]} intensity={0.85} color="#ffffff" />
      <directionalLight position={[-2, 1.5, -1]} intensity={0.35} color="#38bdf8" />

      <Suspense
        fallback={
          <Html center>
            <div className="rounded-lg border border-sky-500/40 bg-black/60 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-sky-300">
              Caricamento modello…
            </div>
          </Html>
        }
      >
        <Environment preset="city" environmentIntensity={1.15} />
        <LumaShoe glbSrc={glbSrc} materialPreset={materialPreset} />
      </Suspense>

      <ContactShadows
        position={[0, 0.001, 0]}
        opacity={0.55}
        scale={14}
        blur={2.8}
        far={4.5}
        color="#000000"
      />

      {/* Piano di riferimento: ancoraggio “a terra” (il piede reale andrebbe da MediaPipe / depth in futuro). */}
      <Grid
        position={[0, -0.002, 0]}
        args={[20, 20]}
        cellSize={0.12}
        cellThickness={0.4}
        cellColor="#38bdf8"
        sectionSize={1.2}
        sectionThickness={0.85}
        sectionColor="#0ea5e9"
        fadeDistance={9}
        fadeStrength={1.35}
        infiniteGrid
        followCamera={false}
      />

      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.052}
        rotateSpeed={0.62}
        minDistance={0.42}
        maxDistance={2.2}
        minPolarAngle={Math.PI * 0.18}
        maxPolarAngle={Math.PI * 0.46}
        target={[0, 0.12, 0]}
        touches={{
          ONE: THREE.TOUCH.ROTATE,
          TWO: THREE.TOUCH.DOLLY_PAN,
        }}
      />
    </>
  );
}

export type LumaStyleViewerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shoe: ShoeCatalogItem | null;
  /** Chiude il viewer e apre il flusso scanner (ArUco / fotogrammetria). */
  onAdaptFoot: () => void;
};

export default function LumaStyleViewer({ open, onOpenChange, shoe, onAdaptFoot }: LumaStyleViewerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [materialPreset, setMaterialPreset] = useState<LumaMaterialPreset>("tpu");

  useEffect(() => {
    if (!open) {
      setCamError(null);
      return;
    }
    setMaterialPreset("tpu");
  }, [open]);

  useEffect(() => {
    if (!open || !shoe) return;
    let cancelled = false;
    setCamError(null);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
        }
      } catch {
        if (!cancelled) {
          setCamError("Camera posteriore non disponibile. Usa HTTPS / localhost.");
        }
      }
    })();

    return () => {
      cancelled = true;
      const v = videoRef.current;
      const stream = v?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      if (v) v.srcObject = null;
    };
  }, [open, shoe]);

  const handleAdapt = useCallback(() => {
    onOpenChange(false);
    onAdaptFoot();
  }, [onOpenChange, onAdaptFoot]);

  if (!open) return null;
  if (!shoe) return null;

  const pillClass = (active: boolean) =>
    cn(
      "rounded-full border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors",
      "border-sky-500/50 bg-transparent text-sky-200/90 hover:border-sky-400 hover:bg-sky-500/10",
      active && "border-sky-400 bg-sky-500/15 text-sky-100 shadow-[0_0_20px_rgba(56,189,248,0.2)]"
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose={false}
        className={cn(
          "fixed inset-0 left-0 top-0 z-[97] flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white shadow-none",
          "data-[state=open]:slide-in-from-bottom-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:zoom-in-100"
        )}
      >
        <div className="relative min-h-0 flex-1 bg-black">
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            playsInline
            muted
            autoPlay
          />

          <div className="absolute inset-0 bg-black/50 pointer-events-none" aria-hidden />

          {camError ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 px-6">
              <p className="max-w-sm text-center text-sm text-zinc-300">{camError}</p>
            </div>
          ) : null}

          <div className="absolute inset-0 z-[5] touch-none">
            <Canvas
              shadows
              dpr={[1, 2]}
              frameloop="always"
              camera={{ position: [0.35, 0.38, 0.95], fov: 42, near: 0.05, far: 80 }}
              gl={{
                alpha: true,
                antialias: true,
                powerPreference: "high-performance",
                premultipliedAlpha: false,
              }}
              style={{ width: "100%", height: "100%", touchAction: "none" }}
            >
              <LumaScene glbSrc={shoe.glbSrc} materialPreset={materialPreset} />
            </Canvas>
          </div>

          <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start justify-between gap-3 p-3">
            <p className="pointer-events-none max-w-[min(100%,280px)] rounded-lg border border-sky-500/30 bg-black/35 px-3 py-2 font-mono text-[9px] uppercase leading-snug tracking-wide text-sky-200/80 backdrop-blur-sm">
              Anteprima stile Luma · ruota con un dito. Ancoraggio a terra simulato; per splat Gaussiani servirà asset +
              viewer dedicato.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="pointer-events-auto h-11 w-11 shrink-0 rounded-full border border-sky-500/45 bg-black/35 text-sky-200 backdrop-blur-sm hover:bg-sky-500/15 hover:text-white"
              onClick={() => onOpenChange(false)}
              aria-label="Chiudi viewer Luma"
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </Button>
          </div>

          <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center gap-4 border-t border-sky-500/25 bg-black/45 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-md">
            <p className="pointer-events-none text-center font-mono text-[9px] uppercase tracking-[0.2em] text-sky-400/80">
              Materiale
            </p>
            <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
              {(Object.keys(MATERIAL_LABELS) as LumaMaterialPreset[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={pillClass(materialPreset === key)}
                  onClick={() => setMaterialPreset(key)}
                >
                  {MATERIAL_LABELS[key]}
                </button>
              ))}
            </div>

            <Button
              type="button"
              className="pointer-events-auto mt-1 w-full max-w-md rounded-xl border-2 border-sky-400/70 bg-sky-600/90 py-6 font-mono text-sm font-bold uppercase tracking-[0.14em] text-white shadow-[0_0_32px_rgba(56,189,248,0.35)] hover:bg-sky-500"
              onClick={handleAdapt}
            >
              ADATTA AL MIO PIEDE
            </Button>
            <p className="pointer-events-none max-w-md text-center text-[10px] leading-relaxed text-zinc-500">
              Scanner con foglio A4 e marker ArUco per scala mm e fitting — come nel flusso Snapfeet.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
