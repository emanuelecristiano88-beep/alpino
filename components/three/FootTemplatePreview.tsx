"use client";

/**
 * FootTemplatePreview
 *
 * Renders a clean, smooth, template-based foot model derived from measurements
 * extracted from the scan point cloud. Never displays raw point data.
 *
 * Pipeline (runs off the main thread in a useEffect):
 *  1. extractFootMeasurements(cloud)  → FootMeasurements
 *  2. buildTemplateFootGeometry(...)  → THREE.BufferGeometry
 *  3. applyHeatmapToBufferGeometry (optional pressure view)
 *  4. Render as meshStandardMaterial with studio lighting
 */

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

import type { PointCloud } from "@/lib/reconstruction/types";
import {
  extractFootMeasurements,
  buildTemplateFootGeometry,
  type FootMeasurements,
  type FootTemplateOptions,
} from "@/lib/reconstruction/footTemplate";
import {
  applyHeatmapToBufferGeometry,
  removeVertexColors,
  type HeatmapAxis,
} from "@/lib/visualization/footHeatmapColors";
import {
  FootVisualizationModeToggle,
  type FootVisualizationMode,
} from "./FootVisualizationModeToggle";

export type { FootVisualizationMode } from "./FootVisualizationModeToggle";
export { FootVisualizationModeToggle } from "./FootVisualizationModeToggle";

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTO_ROTATE_SPEED = 0.30; // rad/s

const MESH_MAT: {
  color: string;
  roughness: number;
  metalness: number;
} = {
  color: "#ddd8d0",
  roughness: 0.55,
  metalness: 0.05,
};

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  cloud: PointCloud;
  /** Override extracted measurements (partial). */
  measurementsOverride?: Partial<FootMeasurements>;
  templateOptions?: Partial<FootTemplateOptions>;
  autoRotateSpeed?: number;
  orbitMinDistance?: number;
  orbitMaxDistance?: number;
  visualizationMode?: FootVisualizationMode;
  onVisualizationModeChange?: (mode: FootVisualizationMode) => void;
  heatmapAxis?: HeatmapAxis;
  showVisualizationToggle?: boolean;
  /** Called once after the template geometry has been built. */
  onMeasurements?: (m: FootMeasurements) => void;
};

// ─── Build status ─────────────────────────────────────────────────────────────

type BuildStatus = "idle" | "building" | "ready" | "error";

// ─── Main component ───────────────────────────────────────────────────────────

function FootTemplatePreviewImpl({
  cloud,
  measurementsOverride,
  templateOptions,
  autoRotateSpeed = AUTO_ROTATE_SPEED,
  orbitMinDistance = 0.5,
  orbitMaxDistance = 4.2,
  visualizationMode: visualizationModeProp,
  onVisualizationModeChange,
  heatmapAxis = "y",
  showVisualizationToggle = false,
  onMeasurements,
}: Props) {
  const modelRef = useRef<THREE.Group>(null);
  const userInteractingRef = useRef(false);
  const { invalidate } = useThree();

  const [internalMode, setInternalMode] = useState<FootVisualizationMode>("real");
  const visualizationMode = visualizationModeProp ?? internalMode;
  const setVisualizationMode = useCallback(
    (m: FootVisualizationMode) => {
      if (visualizationModeProp === undefined) setInternalMode(m);
      onVisualizationModeChange?.(m);
    },
    [visualizationModeProp, onVisualizationModeChange]
  );

  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
  const [measurements, setMeasurements] = useState<FootMeasurements | null>(null);

  // Build geometry whenever cloud or overrides change
  useEffect(() => {
    setBuildStatus("building");

    // Use a macro-task so we don't block the render thread on large clouds
    const handle = window.setTimeout(() => {
      try {
        const raw = extractFootMeasurements(cloud);
        const merged: FootMeasurements = { ...raw, ...measurementsOverride };
        const geom = buildTemplateFootGeometry(merged, templateOptions);
        setMeasurements(merged);
        setGeometry((prev) => {
          prev?.dispose();
          return geom;
        });
        onMeasurements?.(merged);
        setBuildStatus("ready");
      } catch (err) {
        console.error("[FootTemplatePreview] build failed", err);
        setBuildStatus("error");
      }
    }, 0);

    return () => {
      window.clearTimeout(handle);
    };
  }, [cloud, measurementsOverride, templateOptions, onMeasurements]);

  // Dispose geometry on unmount
  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply/remove heatmap on mode change
  useEffect(() => {
    if (!geometry) return;
    if (visualizationMode === "pressure") {
      applyHeatmapToBufferGeometry(geometry, heatmapAxis);
    } else {
      removeVertexColors(geometry);
    }
    // Notify three.js of attribute change
    const colAttr = geometry.getAttribute("color");
    if (colAttr) (colAttr as THREE.BufferAttribute).needsUpdate = true;
    invalidate();
  }, [geometry, visualizationMode, heatmapAxis, invalidate]);

  // Auto-rotate when idle
  useFrame((_, delta) => {
    if (!modelRef.current || userInteractingRef.current) return;
    if (autoRotateSpeed <= 0) return;
    modelRef.current.rotation.y += autoRotateSpeed * delta;
    invalidate();
  });

  const meshColor = visualizationMode === "pressure" ? "#ffffff" : MESH_MAT.color;

  return (
    <>
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={orbitMinDistance}
        maxDistance={orbitMaxDistance}
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI / 2 - 0.04}
        onChange={() => invalidate()}
        onStart={() => { userInteractingRef.current = true; }}
        onEnd={() => { userInteractingRef.current = false; }}
      />

      {showVisualizationToggle && (
        <Html
          position={[0, 0.95, 0]}
          center
          style={{ pointerEvents: "auto" }}
          transform
          occlude={false}
        >
          <FootVisualizationModeToggle
            mode={visualizationMode}
            onChange={setVisualizationMode}
          />
        </Html>
      )}

      <group ref={modelRef}>
        {buildStatus === "building" && (
          <Html center>
            <div className="rounded border border-blue-500/40 bg-black/60 px-3 py-2 text-xs text-blue-200">
              Elaborazione modello…
            </div>
          </Html>
        )}

        {buildStatus === "error" && (
          <Html center>
            <div className="rounded border border-red-500/40 bg-black/60 px-3 py-2 text-xs text-red-200">
              Errore generazione modello
            </div>
          </Html>
        )}

        {geometry && buildStatus === "ready" && (
          <mesh geometry={geometry} castShadow receiveShadow>
            <meshStandardMaterial
              color={meshColor}
              roughness={MESH_MAT.roughness}
              metalness={MESH_MAT.metalness}
              vertexColors={visualizationMode === "pressure"}
              envMapIntensity={0.6}
            />
          </mesh>
        )}

        {/* Measurement badge (shown below the foot) */}
        {measurements && buildStatus === "ready" && (
          <Html position={[0, -0.52, 0]} center occlude={false}>
            <div className="pointer-events-none rounded-lg border border-white/15 bg-black/50 px-3 py-1.5 text-center backdrop-blur-sm">
              <p className="font-mono text-[10px] tracking-[0.14em] text-zinc-200">
                {Math.round(measurements.lengthMm)} mm ×{" "}
                {Math.round(measurements.widthMm)} mm
              </p>
              <p className="mt-0.5 font-mono text-[9px] tracking-[0.10em] text-zinc-400">
                arco {Math.round(measurements.archHeightMm)} mm
              </p>
            </div>
          </Html>
        )}
      </group>
    </>
  );
}

const FootTemplatePreview = memo(FootTemplatePreviewImpl);
FootTemplatePreview.displayName = "FootTemplatePreview";

export default FootTemplatePreview;
