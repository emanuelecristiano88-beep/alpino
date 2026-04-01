import * as React from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Center, Environment, Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { motion } from "framer-motion";
import { supabase } from "../lib/supabase";
import { Button } from "../components/ui/button";

type ScanRow = {
  id: number;
  status?: string | null;
  model_url?: string | null;
  model_path?: string | null;
  video_url?: string | null;
  metrics?: unknown;
  left_length_mm?: number | null;
  right_length_mm?: number | null;
  left_width_mm?: number | null;
  right_width_mm?: number | null;
};

function appleEase(t: number) {
  // Soft-in, soft-out (close to cubic-bezier(0.22,1,0.36,1)).
  return 1 - Math.pow(1 - t, 3);
}

function mmToCm(mm: number) {
  return `${(mm / 10).toFixed(1).replace(/\.0$/, "")}cm`;
}

function parseMetrics(row: ScanRow | null) {
  const fallback = {
    leftLengthMm: row?.left_length_mm ?? null,
    rightLengthMm: row?.right_length_mm ?? null,
    leftWidthMm: row?.left_width_mm ?? null,
    rightWidthMm: row?.right_width_mm ?? null,
  };

  const m = row?.metrics;
  if (!m || typeof m !== "object") return fallback;

  const obj = m as Record<string, unknown>;
  const ll = typeof obj.leftLengthMm === "number" ? obj.leftLengthMm : typeof obj.left_length_mm === "number" ? obj.left_length_mm : fallback.leftLengthMm;
  const rl = typeof obj.rightLengthMm === "number" ? obj.rightLengthMm : typeof obj.right_length_mm === "number" ? obj.right_length_mm : fallback.rightLengthMm;
  const lw = typeof obj.leftWidthMm === "number" ? obj.leftWidthMm : typeof obj.left_width_mm === "number" ? obj.left_width_mm : fallback.leftWidthMm;
  const rw = typeof obj.rightWidthMm === "number" ? obj.rightWidthMm : typeof obj.right_width_mm === "number" ? obj.right_width_mm : fallback.rightWidthMm;
  return { leftLengthMm: ll, rightLengthMm: rl, leftWidthMm: lw, rightWidthMm: rw };
}

function InsightIcon() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="3" y="3" width="6" height="14" rx="3" stroke="rgba(255,255,255,0.65)" strokeWidth="1.4" />
        <rect x="11" y="3" width="6" height="14" rx="3" stroke="rgba(255,255,255,0.65)" strokeWidth="1.4" />
      </svg>
    </div>
  );
}

function Model({ url, onReady, showLabels }: { url: string; onReady: (anchors: { left: THREE.Vector3; right: THREE.Vector3 }) => void; showLabels: boolean }) {
  const gltf = useGLTF(url) as unknown as { scene: THREE.Group };
  const groupRef = useRef<THREE.Group | null>(null);
  const [anchors, setAnchors] = useState<{ left: THREE.Vector3; right: THREE.Vector3 } | null>(null);

  useEffect(() => {
    const scene = gltf.scene;
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });

    // Compute anchors from overall bounding box (robust even if nodes aren't named).
    const box = new THREE.Box3().setFromObject(scene);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const left = new THREE.Vector3(c.x - size.x * 0.34, c.y, c.z);
    const right = new THREE.Vector3(c.x + size.x * 0.34, c.y, c.z);
    const a = { left, right };
    setAnchors(a);
    onReady(a);
  }, [gltf.scene, onReady]);

  return (
    <group ref={groupRef}>
      <Center>
        <primitive object={gltf.scene} />
      </Center>

      {anchors && showLabels ? (
        <>
          <Html position={anchors.left} center style={{ pointerEvents: "none" }}>
            <div className="rounded-2xl border border-white/12 bg-black/45 px-3 py-2 text-[12px] font-medium text-white/85 shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
              Sinistro
            </div>
          </Html>
          <Html position={anchors.right} center style={{ pointerEvents: "none" }}>
            <div className="rounded-2xl border border-white/12 bg-black/45 px-3 py-2 text-[12px] font-medium text-white/85 shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
              Destro
            </div>
          </Html>
        </>
      ) : null}
    </group>
  );
}

function SpringOrbit({
  enabled,
  autoRotate,
  onUserEnd,
}: {
  enabled: boolean;
  autoRotate: boolean;
  onUserEnd: () => void;
}) {
  const controlsRef = useRef<THREE.OrbitControls | null>(null);
  const { camera, gl } = useThree();

  const defaultPos = useMemo(() => new THREE.Vector3(0.0, 0.35, 1.25), []);
  const defaultTarget = useMemo(() => new THREE.Vector3(0, 0.18, 0), []);
  const springBackRef = useRef(false);
  const userRef = useRef(false);

  useEffect(() => {
    camera.position.copy(defaultPos);
    camera.lookAt(defaultTarget);
  }, [camera, defaultPos, defaultTarget]);

  useFrame((_, dt) => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (!enabled) return;

    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.75;

    if (!userRef.current && springBackRef.current) {
      const t = 1 - Math.pow(0.001, dt);
      camera.position.lerp(defaultPos, t);
      controls.target.lerp(defaultTarget, t);
      controls.update();
      if (camera.position.distanceTo(defaultPos) < 0.002 && controls.target.distanceTo(defaultTarget) < 0.002) {
        springBackRef.current = false;
      }
    }
  });

  return (
    <OrbitControls
      ref={(r) => {
        controlsRef.current = (r as unknown as THREE.OrbitControls) ?? null;
      }}
      args={[camera, gl.domElement]}
      enabled={enabled}
      enableDamping
      dampingFactor={0.075}
      enablePan={false}
      enableZoom
      rotateSpeed={0.75}
      zoomSpeed={0.9}
      minDistance={0.6}
      maxDistance={2.6}
      minPolarAngle={0.35}
      maxPolarAngle={Math.PI - 0.55}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      onStart={() => {
        userRef.current = true;
        springBackRef.current = false;
      }}
      onEnd={() => {
        userRef.current = false;
        springBackRef.current = true;
        onUserEnd();
      }}
    />
  );
}

function AnimatedRig({ active }: { active: boolean }) {
  const group = useRef<THREE.Group | null>(null);
  const startRef = useRef<number>(0);
  const doneRef = useRef(false);

  useFrame((state) => {
    if (!active) return;
    const g = group.current;
    if (!g) return;
    if (!startRef.current) startRef.current = state.clock.elapsedTime;
    const t = Math.min(1, (state.clock.elapsedTime - startRef.current) / 1.35);
    const eased = appleEase(t);
    g.rotation.y = (1 - eased) * Math.PI; // 180° → 0°
    if (t >= 1 && !doneRef.current) {
      doneRef.current = true;
    }
  });

  return <group ref={group} />;
}

export default function ScanResults3D() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { scanId?: number | string } | null;

  const scanId = useMemo(() => {
    const fromState = state?.scanId;
    if (fromState == null) return null;
    const n = typeof fromState === "string" ? Number(fromState) : Number(fromState);
    return Number.isFinite(n) ? n : null;
  }, [state?.scanId]);

  const [row, setRow] = useState<ScanRow | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canInteract, setCanInteract] = useState(false);
  const [showCards, setShowCards] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);

  const metrics = useMemo(() => parseMetrics(row), [row]);
  const insightText = useMemo(() => {
    const l = metrics.leftLengthMm;
    const r = metrics.rightLengthMm;
    if (typeof l === "number" && typeof r === "number") {
      const diff = Math.abs(l - r);
      if (diff <= 2) return "Insight biometria: Entrambi i piedi sono simili in lunghezza";
      return l > r ? "Insight biometria: Il piede sinistro è leggermente più lungo" : "Insight biometria: Il piede destro è leggermente più lungo";
    }
    return "Insight biometria: Analisi completata";
  }, [metrics.leftLengthMm, metrics.rightLengthMm]);

  useEffect(() => {
    let cancelled = false;
    if (scanId == null) {
      setLoading(false);
      return;
    }
    setLoading(true);

    (async () => {
      const { data, error } = await supabase.from("scans").select("*").eq("id", scanId).single();
      if (cancelled) return;
      if (error) {
        console.warn("[ScanResults3D] scans row fetch failed:", error.message);
      }
      const r = (data ?? null) as ScanRow | null;
      setRow(r);

      const path = (typeof r?.model_path === "string" && r.model_path) ? r.model_path
        : (typeof r?.model_url === "string" && r.model_url) ? r.model_url
        : `${scanId}/model.glb`;

      // If model_url is already a URL, use directly.
      if (/^https?:\/\//i.test(path)) {
        setModelUrl(path);
        setLoading(false);
        return;
      }

      const pub = supabase.storage.from("scans").getPublicUrl(path);
      const url = pub?.data?.publicUrl;
      setModelUrl(url || null);
      setLoading(false);
    })().catch((e) => {
      if (!cancelled) {
        console.error("[ScanResults3D] load failed:", e);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [scanId]);

  const handleProceed = useCallback(() => {
    navigate("/design-plantare", { state: { scanId: scanId ?? undefined } });
  }, [navigate, scanId]);

  if (scanId == null) {
    return (
      <div className="min-h-[100dvh] bg-black px-6 pt-16 text-white">
        <p className="text-sm text-white/60">Scan non trovata (scanId mancante).</p>
      </div>
    );
  }

  const showMeasurements = showCards && typeof metrics.leftLengthMm === "number" && typeof metrics.rightLengthMm === "number";

  return (
    <div className="fixed inset-0 z-[96] bg-black text-white">
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black via-black to-black" aria-hidden />
      </motion.div>

      <div className="pointer-events-none absolute left-0 right-0 top-0 z-[20] px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.03] px-4 py-3 backdrop-blur-2xl">
          <InsightIcon />
          <div className="min-w-0">
            <div className="text-[11px] font-medium tracking-[0.02em] text-white/70">Risultati 3D</div>
            <div className="truncate text-[13px] font-semibold tracking-tight text-white/90">{insightText}</div>
          </div>
        </div>
      </div>

      <div className="absolute inset-0">
        {loading || !modelUrl ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-medium text-white/70 backdrop-blur-xl">
              Caricamento modello 3D…
            </div>
          </div>
        ) : (
          <Canvas
            dpr={[1, typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 1.75) : 1]}
            frameloop="always"
            camera={{ position: [0, 0.35, 1.25], fov: 38, near: 0.02, far: 50 }}
            gl={{ antialias: true, powerPreference: "default", alpha: true }}
            className="h-full w-full touch-none"
            style={{ width: "100%", height: "100%", touchAction: "none" }}
            onCreated={({ gl, scene }) => {
              gl.setClearColor(0x000000, 1);
              scene.fog = new THREE.Fog(0x000000, 6, 18);
            }}
          >
            <ambientLight intensity={0.55} />
            <directionalLight position={[2.2, 4.1, 2.2]} intensity={0.95} />
            <directionalLight position={[-2.1, 2.4, -1.6]} intensity={0.32} color="#d8d8d8" />
            <Suspense fallback={null}>
              <Environment preset="studio" environmentIntensity={1} />
              <Center>
                <group>
                  <Model
                    url={modelUrl}
                    onReady={() => {
                      setCanInteract(true);
                      window.setTimeout(() => setShowCards(true), 520);
                    }}
                    showLabels={false}
                  />
                </group>
              </Center>
            </Suspense>

            <SpringOrbit enabled={canInteract} autoRotate={autoRotate} onUserEnd={() => {}} />
          </Canvas>
        )}
      </div>

      {/* Floating measurement cards (glass) */}
      {showMeasurements ? (
        <>
          <motion.div
            className="pointer-events-none absolute left-5 top-[52%] z-[25] -translate-y-1/2 sm:left-10"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="rounded-3xl border border-white/12 bg-black/45 px-4 py-3 backdrop-blur-2xl shadow-[0_30px_110px_rgba(0,0,0,0.65)]">
              <div className="text-[10px] font-semibold tracking-[0.18em] text-white/45 uppercase">Sinistro</div>
              <div className="mt-1 text-[16px] font-semibold tracking-tight text-white/90">
                {mmToCm(metrics.leftLengthMm!)}
              </div>
            </div>
          </motion.div>

          <motion.div
            className="pointer-events-none absolute right-5 top-[52%] z-[25] -translate-y-1/2 sm:right-10"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="rounded-3xl border border-white/12 bg-black/45 px-4 py-3 backdrop-blur-2xl shadow-[0_30px_110px_rgba(0,0,0,0.65)]">
              <div className="text-[10px] font-semibold tracking-[0.18em] text-white/45 uppercase">Destro</div>
              <div className="mt-1 text-[16px] font-semibold tracking-tight text-white/90">
                {mmToCm(metrics.rightLengthMm!)}
              </div>
            </div>
          </motion.div>
        </>
      ) : null}

      {/* Overlay controls */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[30] px-5 pb-[max(1.1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3">
          <div className="pointer-events-auto">
            <Button
              type="button"
              variant="secondary"
              className="rounded-full border border-white/12 bg-white/[0.05] text-white hover:bg-white/[0.09]"
              onClick={() => setAutoRotate((v) => !v)}
            >
              Ruota 3D
            </Button>
          </div>

          <div className="pointer-events-auto flex-1">
            <Button
              type="button"
              className="w-full rounded-full border border-white/12 bg-white/10 text-white hover:bg-white/15"
              onClick={handleProceed}
            >
              Prosegui al Design del Plantare
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

useGLTF.preload("/model.glb");

