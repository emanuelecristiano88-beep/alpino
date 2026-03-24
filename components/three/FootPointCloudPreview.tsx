"use client";

import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { PointCloud } from "@/lib/reconstruction/types";
import {
  buildFootSurfaceFromPositions,
  DEFAULT_FOOT_SURFACE_OPTIONS,
  transformPointPositionsLikeMesh,
  type FootSurfaceOptions,
} from "@/lib/reconstruction/footSurfaceMesh";
import {
  applyFootDeformation,
  type FootDeformationParams,
} from "@/lib/reconstruction/footDeformationParams";
import {
  applyHeatmapToBufferGeometry,
  computeAxisRange,
  fillColorsFromAxisRange,
  heatmapAxisComponent,
  removeVertexColors,
  type HeatmapAxis,
} from "@/lib/visualization/footHeatmapColors";
import { downsamplePointCloud } from "@/lib/visualization/downsamplePointCloud";
import { useThreePerformanceProfile } from "@/hooks/useThreePerformanceProfile";
import {
  FootVisualizationModeToggle,
  type FootVisualizationMode,
} from "./FootVisualizationModeToggle";

export type { FootVisualizationMode } from "./FootVisualizationModeToggle";
export { FootVisualizationModeToggle } from "./FootVisualizationModeToggle";

/** rad/s — range consigliato 0.2–0.4 */
const DEFAULT_AUTO_ROTATE_SPEED = 0.32;

const FADE_MS = 350;

function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

function hash01(i: number): number {
  return Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
}

function buildScatteredPositions(targets: Float32Array, count: number): Float32Array {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.set(targets[i * 3], targets[i * 3 + 1], targets[i * 3 + 2]);
    box.expandByPoint(v);
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const spread = Math.max(size.x, size.y, size.z, 0.08) * 2.4;
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = hash01(i);
    const v1 = hash01(i + 17);
    const w = hash01(i + 31);
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v1 - 1);
    const r = spread * (0.45 + 0.55 * w);
    out[i * 3] = center.x + r * Math.sin(phi) * Math.cos(theta);
    out[i * 3 + 1] = center.y + r * Math.sin(phi) * Math.sin(theta);
    out[i * 3 + 2] = center.z + r * Math.cos(phi);
  }
  return out;
}

type IntroPhase = "converge" | "fade" | "done";

type Props = {
  cloud: PointCloud;
  mmToWorld?: number;
  pointSize?: number;
  showPointsDebug?: boolean;
  surfaceOptions?: Partial<FootSurfaceOptions>;
  /** Foot shape deformation parameters (length/width/height scale, arch, volume, heel, toes). */
  deformationParams?: Partial<FootDeformationParams>;
  autoRotateSpeed?: number;
  orbitMinDistance?: number;
  orbitMaxDistance?: number;
  introAnimation?: boolean;
  visualizationMode?: FootVisualizationMode;
  onVisualizationModeChange?: (mode: FootVisualizationMode) => void;
  heatmapAxis?: HeatmapAxis;
  showVisualizationToggle?: boolean;
  /** Override automatic point cap (desktop/mobile). */
  maxPoints?: number;
};

const POINT_MATERIAL_PROPS = {
  size: 0.012,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
} as const;

const MESH_MATERIAL_PROPS = {
  color: "#e5e5e5",
  roughness: 0.6,
  metalness: 0.1,
} as const;

function FootPointCloudPreviewImpl({
  cloud,
  mmToWorld = 0.002,
  pointSize = 0.015,
  showPointsDebug = false,
  surfaceOptions,
  deformationParams,
  autoRotateSpeed = DEFAULT_AUTO_ROTATE_SPEED,
  orbitMinDistance = 0.5,
  orbitMaxDistance = 4.2,
  introAnimation = false,
  visualizationMode: visualizationModeProp,
  onVisualizationModeChange,
  heatmapAxis = "y",
  showVisualizationToggle = false,
  maxPoints: maxPointsProp,
}: Props) {
  const perf = useThreePerformanceProfile();
  const modelRef = useRef<THREE.Group>(null);
  const userInteractingRef = useRef(false);
  const { invalidate, clock } = useThree();

  const renderCloud = useMemo(() => {
    const cap = maxPointsProp ?? perf.maxPointCloudPoints;
    return downsamplePointCloud(cloud, cap);
  }, [cloud, maxPointsProp, perf.maxPointCloudPoints]);

  const n = renderCloud.pointCount;

  const effectiveSurfaceOptions = useMemo(
    () => ({
      ...DEFAULT_FOOT_SURFACE_OPTIONS,
      ...surfaceOptions,
      maxSourcePoints: Math.min(
        surfaceOptions?.maxSourcePoints ?? DEFAULT_FOOT_SURFACE_OPTIONS.maxSourcePoints,
        perf.meshMaxSourcePoints
      ),
    }),
    [surfaceOptions, perf.meshMaxSourcePoints]
  );

  const [internalMode, setInternalMode] = useState<FootVisualizationMode>("real");
  const visualizationMode = visualizationModeProp ?? internalMode;
  const setVisualizationMode = (m: FootVisualizationMode) => {
    if (visualizationModeProp === undefined) setInternalMode(m);
    onVisualizationModeChange?.(m);
  };

  const convergeMs = useMemo(() => 800 + Math.random() * 400, []);
  const convergeSec = convergeMs / 1000;
  const fadeSec = FADE_MS / 1000;

  const introStartRef = useRef<number | null>(null);
  const convergeFinishedRef = useRef(false);
  const [introPhase, setIntroPhase] = useState<IntroPhase>(() => (introAnimation ? "converge" : "done"));
  const [pointsHiddenAfterIntro, setPointsHiddenAfterIntro] = useState(false);

  const scaledPositions = useMemo(() => {
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) {
      pos[i] = renderCloud.positions[i] * mmToWorld;
    }
    return pos;
  }, [renderCloud, mmToWorld, n]);

  const { alignedTargets, scattered } = useMemo(() => {
    const aligned = transformPointPositionsLikeMesh(scaledPositions, n);
    const sc = buildScatteredPositions(aligned, n);
    return { alignedTargets: aligned, scattered: sc };
  }, [scaledPositions, n]);

  const [surfaceGeometry, setSurfaceGeometry] = useState<THREE.BufferGeometry | null>(null);

  const pressureAxisRange = useMemo(() => {
    const ax = heatmapAxisComponent(heatmapAxis);
    return introAnimation
      ? computeAxisRange(alignedTargets, n, ax)
      : computeAxisRange(scaledPositions, n, ax);
  }, [introAnimation, alignedTargets, scaledPositions, n, heatmapAxis]);

  useEffect(() => {
    if (introAnimation) {
      setIntroPhase("converge");
      setPointsHiddenAfterIntro(false);
      introStartRef.current = null;
      convergeFinishedRef.current = false;
      setSurfaceGeometry((prev) => {
        prev?.dispose();
        return null;
      });
      return;
    }
    const g = buildFootSurfaceFromPositions(scaledPositions, n, effectiveSurfaceOptions);
    if (g && deformationParams) applyFootDeformation(g, deformationParams);
    setSurfaceGeometry(g);
    setIntroPhase("done");
    return () => {
      g?.dispose();
    };
  }, [introAnimation, scaledPositions, n, effectiveSurfaceOptions, deformationParams]);

  const pointsGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const initial = introAnimation ? new Float32Array(scattered) : new Float32Array(n * 3);
    if (!introAnimation) {
      for (let i = 0; i < n * 3; i++) initial[i] = scaledPositions[i];
    }
    g.setAttribute("position", new THREE.BufferAttribute(initial, 3).setUsage(THREE.DynamicDrawUsage));
    if (renderCloud.colors && renderCloud.colors.length >= n * 3) {
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n * 3; i++) {
        col[i] = renderCloud.colors![i] / 255;
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
    return g;
  }, [renderCloud, n, scaledPositions, scattered, introAnimation]);

  useEffect(() => {
    return () => {
      pointsGeometry.dispose();
    };
  }, [pointsGeometry]);

  const hasPointColors = !!(renderCloud.colors && renderCloud.colors.length >= n * 3);

  const showIntroPoints =
    (introAnimation && !pointsHiddenAfterIntro) || (!introAnimation && showPointsDebug);

  const pointsMatRef = useRef<THREE.PointsMaterial>(null);
  const meshMatRef = useRef<THREE.MeshStandardMaterial>(null);

  const syncPointVertexColors = useCallback(() => {
    const g = pointsGeometry;
    const ax = heatmapAxisComponent(heatmapAxis);
    const posAttr = g.getAttribute("position") as THREE.BufferAttribute;
    const pos = posAttr.array as Float32Array;

    if (visualizationMode === "pressure") {
      let col = g.getAttribute("color") as THREE.BufferAttribute | undefined;
      if (!col) {
        col = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
        g.setAttribute("color", col);
      }
      fillColorsFromAxisRange(pos, n, ax, pressureAxisRange.min, pressureAxisRange.max, col.array as Float32Array);
      col.needsUpdate = true;
    } else if (hasPointColors && renderCloud.colors) {
      let col = g.getAttribute("color") as THREE.BufferAttribute | undefined;
      if (!col) {
        col = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
        g.setAttribute("color", col);
      }
      const arr = col.array as Float32Array;
      for (let i = 0; i < n * 3; i++) {
        arr[i] = renderCloud.colors![i] / 255;
      }
      col.needsUpdate = true;
    } else if (g.getAttribute("color")) {
      g.deleteAttribute("color");
    }
  }, [
    pointsGeometry,
    n,
    renderCloud.colors,
    visualizationMode,
    heatmapAxis,
    pressureAxisRange.min,
    pressureAxisRange.max,
    hasPointColors,
  ]);

  useLayoutEffect(() => {
    if (introAnimation && introPhase === "converge") return;
    syncPointVertexColors();
  }, [introAnimation, introPhase, syncPointVertexColors]);

  useEffect(() => {
    if (!surfaceGeometry) return;
    if (visualizationMode === "pressure") {
      applyHeatmapToBufferGeometry(surfaceGeometry, heatmapAxis);
    } else {
      removeVertexColors(surfaceGeometry);
    }
  }, [surfaceGeometry, visualizationMode, heatmapAxis]);

  useLayoutEffect(() => {
    if (!introAnimation || introPhase !== "fade" || !meshMatRef.current) return;
    meshMatRef.current.opacity = 0;
    meshMatRef.current.transparent = true;
    meshMatRef.current.depthWrite = false;
  }, [introAnimation, introPhase]);

  useFrame((_, delta) => {
    if (introAnimation && introPhase === "converge") {
      if (introStartRef.current === null) introStartRef.current = clock.elapsedTime;
      const elapsed = clock.elapsedTime - introStartRef.current;
      const t = Math.min(1, elapsed / convergeSec);
      const e = easeOutCubic(t);

      const attr = pointsGeometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < n * 3; i++) {
        arr[i] = scattered[i] + (alignedTargets[i] - scattered[i]) * e;
      }
      attr.needsUpdate = true;

      syncPointVertexColors();

      if (t >= 1 - 1e-5 && !convergeFinishedRef.current) {
        convergeFinishedRef.current = true;
        const g = buildFootSurfaceFromPositions(scaledPositions, n, effectiveSurfaceOptions);
        if (g && deformationParams) applyFootDeformation(g, deformationParams);
        setSurfaceGeometry(g);
        setIntroPhase("fade");
      }
      invalidate();
      return;
    }

    if (introAnimation && introPhase === "fade") {
      if (introStartRef.current === null) return;
      const elapsed = clock.elapsedTime - introStartRef.current;
      const t0 = elapsed - convergeSec;
      const u = Math.min(1, Math.max(0, t0 / fadeSec));
      const e = easeOutCubic(u);

      if (pointsMatRef.current) pointsMatRef.current.opacity = 1 - e;
      if (meshMatRef.current) {
        meshMatRef.current.opacity = e;
        meshMatRef.current.depthWrite = e > 0.98;
        meshMatRef.current.transparent = e < 0.999;
      }

      if (u >= 1 - 1e-5) {
        setIntroPhase("done");
        setPointsHiddenAfterIntro(true);
        if (pointsMatRef.current) pointsMatRef.current.opacity = 0;
        if (meshMatRef.current) {
          meshMatRef.current.opacity = 1;
          meshMatRef.current.depthWrite = true;
          meshMatRef.current.transparent = false;
        }
      }
      invalidate();
      return;
    }

    if (!modelRef.current || userInteractingRef.current || autoRotateSpeed <= 0) return;
    if (introAnimation && introPhase !== "done") return;
    modelRef.current.rotation.y += autoRotateSpeed * delta;
    invalidate();
  });

  const meshOpacityReact =
    !introAnimation || introPhase === "done"
      ? 1
      : introPhase === "converge"
        ? 0
        : undefined;

  const pointsUseVertexColors =
    visualizationMode === "pressure" || (visualizationMode === "real" && hasPointColors);

  return (
    <>
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={orbitMinDistance}
        maxDistance={orbitMaxDistance}
        minPolarAngle={0.38}
        maxPolarAngle={Math.PI / 2 - 0.06}
        onChange={() => invalidate()}
        onStart={() => {
          userInteractingRef.current = true;
        }}
        onEnd={() => {
          userInteractingRef.current = false;
        }}
      />

      {showVisualizationToggle && (
        <Html
          position={[0, 0.95, 0]}
          center
          style={{ pointerEvents: "auto" }}
          transform
          occlude={false}
        >
          <FootVisualizationModeToggle mode={visualizationMode} onChange={setVisualizationMode} />
        </Html>
      )}

      <group ref={modelRef}>
        {surfaceGeometry ? (
          <mesh geometry={surfaceGeometry} castShadow receiveShadow>
            <meshStandardMaterial
              ref={meshMatRef}
              color={visualizationMode === "pressure" ? "#ffffff" : MESH_MATERIAL_PROPS.color}
              roughness={MESH_MATERIAL_PROPS.roughness}
              metalness={MESH_MATERIAL_PROPS.metalness}
              vertexColors={visualizationMode === "pressure"}
              transparent={introAnimation && introPhase !== "done"}
              {...(meshOpacityReact !== undefined ? { opacity: meshOpacityReact } : {})}
              depthWrite={!introAnimation || introPhase === "done"}
            />
          </mesh>
        ) : null}

        {showIntroPoints && (
          <points geometry={pointsGeometry} frustumCulled>
            <pointsMaterial
              ref={pointsMatRef}
              {...POINT_MATERIAL_PROPS}
              size={pointSize}
              vertexColors={pointsUseVertexColors}
              color={pointsUseVertexColors ? "#ffffff" : "#94c5f8"}
              transparent
              opacity={introAnimation ? 1 : POINT_MATERIAL_PROPS.opacity}
              depthWrite={false}
            />
          </points>
        )}
      </group>
    </>
  );
}

const FootPointCloudPreview = memo(FootPointCloudPreviewImpl);
FootPointCloudPreview.displayName = "FootPointCloudPreview";

export default FootPointCloudPreview;
