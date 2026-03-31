"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";

export type FootPreviewStudioLightingProps = {
  shadowMapSize: number;
  shadowRadius: number;
  useSoftShadows: boolean;
};

/**
 * Key morbida + fill + ambiente caldo + emisfero per look “prodotto” / studio.
 * La directional principale proietta ombre (PCF / PCF soft).
 */
export function FootPreviewStudioLighting({
  shadowMapSize,
  shadowRadius,
  useSoftShadows,
}: FootPreviewStudioLightingProps) {
  const keyRef = useRef<THREE.DirectionalLight>(null);

  useEffect(() => {
    const L = keyRef.current;
    if (!L?.shadow) return;
    const cam = L.shadow.camera as THREE.OrthographicCamera;
    L.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    L.shadow.bias = -0.0001;
    L.shadow.normalBias = 0.022;
    L.shadow.radius = useSoftShadows ? shadowRadius : 1.2;
    cam.near = 0.15;
    cam.far = 22;
    cam.left = -3.4;
    cam.right = 3.4;
    cam.top = 3.4;
    cam.bottom = -3.4;
    cam.updateProjectionMatrix();
  }, [shadowMapSize, shadowRadius, useSoftShadows]);

  return (
    <>
      <ambientLight intensity={0.12} color="#f0f0f3" />
      <hemisphereLight intensity={0.28} color="#f4f4f6" groundColor="#6a6f78" />
      <directionalLight
        ref={keyRef}
        castShadow
        color="#fffaf6"
        intensity={0.95}
        position={[-3.2, 5.8, 2.6]}
      />
      <directionalLight color="#dfe8f5" intensity={0.18} position={[3.4, 2.1, -2.8]} />
    </>
  );
}

export type ContactShadowPlaneProps = {
  /** Opacità ombra sul piano (0–1) */
  opacity?: number;
  /** Metà lato del piano (world units) */
  halfExtent?: number;
  y?: number;
};

/** Piano riceve solo ombre (shadowMaterial) — ombra morbida sotto il piede */
export function ContactShadowPlane({
  opacity = 0.18,
  halfExtent = 7,
  y = -0.0015,
}: ContactShadowPlaneProps) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
      <planeGeometry args={[halfExtent * 2, halfExtent * 2]} />
      <shadowMaterial opacity={opacity} transparent />
    </mesh>
  );
}
