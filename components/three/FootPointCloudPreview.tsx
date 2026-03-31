"use client";

import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { PointCloud } from "@/lib/reconstruction/types";
import {
  DEFAULT_FOOT_SURFACE_OPTIONS,
  transformPointPositionsLikeMesh,
  type FootSurfaceOptions,
} from "@/lib/reconstruction/footSurfaceMesh";
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
import { deferHeavyWork } from "@/lib/utils/yieldToMain";
import { buildPremiumFootDisplayMeshFromPositions } from "@/lib/visualization/premiumFootMeshFromPointCloud";
import {
  FootVisualizationModeToggle,
  type FootVisualizationMode,
} from "./FootVisualizationModeToggle";

export type { FootVisualizationMode } from "./FootVisualizationModeToggle";
export { FootVisualizationModeToggle } from "./FootVisualizationModeToggle";

/** rad/s — rotazione lenta premium */
const DEFAULT_AUTO_ROTATE_SPEED = 0.16;

/** WOW intro: punti → superficie in 1s, ease-out (overlap morph + crossfade). */
const INTRO_MORPH_DURATION_SEC = 1;
/** Entro questa frazione della timeline i punti convergono alla forma (ease-out). */
const INTRO_POINT_CONVERGE_END_U = 0.52;
/** Da qui inizia la comparsa della mesh (morph visivo sovrapposto ai punti). */
const INTRO_MESH_BLEND_START_U = 0.34;

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

type IntroPhase = "morph" | "done";

type Props = {
  cloud: PointCloud;
  mmToWorld?: number;
  pointSize?: number;
  showPointsDebug?: boolean;
  surfaceOptions?: Partial<FootSurfaceOptions>;
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
  roughness: 0.42,
  metalness: 0.05,
  envMapIntensity: 0.58,
  flatShading: false,
} as const;

function FootPointCloudPreviewImpl({
  cloud,
  mmToWorld = 0.002,
  pointSize = 0.015,
  showPointsDebug = false,
  surfaceOptions,
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

  const introStartRef = useRef<number | null>(null);
  const [introPhase, setIntroPhase] = useState<IntroPhase>(() => (introAnimation ? "morph" : "done"));
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
  const [groundOffsetY, setGroundOffsetY] = useState(0);

  const pressureAxisRange = useMemo(() => {
    const ax = heatmapAxisComponent(heatmapAxis);
    return introAnimation
      ? computeAxisRange(alignedTargets, n, ax)
      : computeAxisRange(scaledPositions, n, ax);
  }, [introAnimation, alignedTargets, scaledPositions, n, heatmapAxis]);

  useEffect(() => {
    let cancelled = false;

    const buildMesh = () => {
      if (cancelled) return;
      const voxelGridResolution = Math.min(
        effectiveSurfaceOptions.resolution ?? DEFAULT_FOOT_SURFACE_OPTIONS.resolution,
        32
      );
      const g = buildPremiumFootDisplayMeshFromPositions(scaledPositions, n, {
        surfaceOptions: {
          ...effectiveSurfaceOptions,
          resolution: voxelGridResolution,
        },
        extraSmoothIterations: 2,
        extraSmoothLambda: 0.35,
        keepLargestComponent: true,
      });
      if (cancelled) {
        g?.dispose();
        return;
      }
      if (!g) {
        setSurfaceGeometry(null);
        if (!introAnimation) setIntroPhase("done");
        return;
      }
      setSurfaceGeometry(g);
      if (!introAnimation) setIntroPhase("done");
    };

    if (introAnimation) {
      setIntroPhase("morph");
      setPointsHiddenAfterIntro(false);
      introStartRef.current = null;
      setSurfaceGeometry((prev) => {
        prev?.dispose();
        return null;
      });
      deferHeavyWork(buildMesh);
      return () => {
        cancelled = true;
      };
    }

    deferHeavyWork(buildMesh);
    return () => {
      cancelled = true;
      setSurfaceGeometry((prev) => {
        prev?.dispose();
        return null;
      });
    };
  }, [introAnimation, scaledPositions, n, effectiveSurfaceOptions]);

  useEffect(() => {
    if (!surfaceGeometry) {
      setGroundOffsetY(0);
      return;
    }
    surfaceGeometry.computeBoundingBox();
    const box = surfaceGeometry.boundingBox;
    if (!box) return;
    setGroundOffsetY(-box.min.y);
    surfaceGeometry.computeVertexNormals();
    invalidate();
  }, [surfaceGeometry, invalidate]);

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
  const footMeshRef = useRef<THREE.Mesh>(null);

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
    if (introAnimation && introPhase === "morph") return;
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
    if (!introAnimation || introPhase !== "morph" || !meshMatRef.current) return;
    meshMatRef.current.opacity = 0;
    meshMatRef.current.transparent = true;
    meshMatRef.current.depthWrite = false;
    if (footMeshRef.current) footMeshRef.current.scale.setScalar(0.9);
  }, [introAnimation, introPhase, surfaceGeometry]);

  useFrame((_, delta) => {
    if (introAnimation && introPhase === "morph") {
      if (introStartRef.current === null) introStartRef.current = clock.elapsedTime;
      const elapsed = clock.elapsedTime - introStartRef.current;
      const u = Math.min(1, elapsed / INTRO_MORPH_DURATION_SEC);

      const rawConverge = Math.min(1, u / INTRO_POINT_CONVERGE_END_U);
      const ePos = easeOutCubic(rawConverge);

      const attr = pointsGeometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < n * 3; i++) {
        arr[i] = scattered[i] + (alignedTargets[i] - scattered[i]) * ePos;
      }
      attr.needsUpdate = true;
      syncPointVertexColors();

      let eBlend = 0;
      if (u > INTRO_MESH_BLEND_START_U) {
        eBlend = easeOutCubic(
          Math.min(1, (u - INTRO_MESH_BLEND_START_U) / (1 - INTRO_MESH_BLEND_START_U))
        );
      }

      if (pointsMatRef.current) {
        pointsMatRef.current.opacity = 1 - eBlend;
      }
      if (meshMatRef.current && surfaceGeometry) {
        meshMatRef.current.opacity = eBlend;
        meshMatRef.current.transparent = eBlend < 0.999;
        meshMatRef.current.depthWrite = eBlend > 0.98;
      }
      if (footMeshRef.current) {
        const pop = easeOutCubic(eBlend);
        footMeshRef.current.scale.setScalar(0.9 + 0.1 * pop);
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
        if (footMeshRef.current) footMeshRef.current.scale.setScalar(1);
      }
      invalidate();
      return;
    }

    if (!modelRef.current || userInteractingRef.current || autoRotateSpeed <= 0) return;
    if (introAnimation && introPhase !== "done") return;
    modelRef.current.rotation.y += autoRotateSpeed * delta;
    invalidate();
  });

  const meshOpacityReact = !introAnimation || introPhase === "done" ? 1 : undefined;

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
        <group position={[0, groundOffsetY, 0]}>
          {surfaceGeometry ? (
            <mesh ref={footMeshRef} geometry={surfaceGeometry} castShadow receiveShadow>
              <meshStandardMaterial
                ref={meshMatRef}
                color={visualizationMode === "pressure" ? "#ffffff" : MESH_MATERIAL_PROPS.color}
                roughness={MESH_MATERIAL_PROPS.roughness}
                metalness={MESH_MATERIAL_PROPS.metalness}
                envMapIntensity={MESH_MATERIAL_PROPS.envMapIntensity}
                flatShading={MESH_MATERIAL_PROPS.flatShading}
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
      </group>
    </>
  );
}

const FootPointCloudPreview = memo(FootPointCloudPreviewImpl);
FootPointCloudPreview.displayName = "FootPointCloudPreview";

export default FootPointCloudPreview;
