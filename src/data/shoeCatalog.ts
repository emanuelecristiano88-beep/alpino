export type ShoeCatalogItem = {
  id: string;
  name: string;
  subtitle: string;
  /** URL assoluto o path sotto `/public` — `.glb` oppure `.stl` (es. `/models/yeezy_foamrunner.stl`) */
  glbSrc: string;
  /** Anteprima card catalogo (path sotto `/public`, es. `/images/yeezy-foam-preview.png`) */
  previewSrc?: string;
};

/**
 * Catalogo modelli scarpe per try-on AR.
 * In produzione: servire `.glb` da `/public/models/` e aggiornare `glbSrc`.
 */
export const SHOE_CATALOG: ShoeCatalogItem[] = [
  {
    id: "adidas-yeezy-foam",
    name: "Adidas Yeezy Foam",
    subtitle: "Foam Runner · EVA modellata",
    glbSrc: "/models/yeezy_foamrunner.stl",
    previewSrc: "/images/yeezy-foam-preview.png",
  },
  {
    id: "xav01",
    name: "XAV01",
    subtitle: "Concept foam · gradient arancio/giallo",
    glbSrc: "/models/XAV01.stl",
    previewSrc: "/images/xav01-preview.png",
  },
  {
    id: "alpino-urban",
    name: "Alpino Urban",
    subtitle: "Urban · suola leggera",
    glbSrc:
      "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb",
  },
  {
    id: "alpino-pro",
    name: "Alpino Pro",
    subtitle: "Performance · mesh ventilata",
    /** GLB leggero: Fox/RobotExpressive bloccano spesso mobile + WebGL */
    glbSrc: "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
  },
  {
    id: "alpino-classic",
    name: "Alpino Classic",
    subtitle: "Daily · comfort",
    glbSrc:
      "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb",
  },
];
