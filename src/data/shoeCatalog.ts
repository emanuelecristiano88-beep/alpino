export type ShoeCatalogItem = {
  id: string;
  name: string;
  subtitle: string;
  /** URL assoluto o path sotto `/public` (es. `/models/scarpa.glb`) */
  glbSrc: string;
};

/**
 * Catalogo modelli scarpe per try-on AR.
 * In produzione: servire `.glb` da `/public/models/` e aggiornare `glbSrc`.
 */
export const SHOE_CATALOG: ShoeCatalogItem[] = [
  {
    id: "alpino-trail",
    name: "Alpino Trail",
    subtitle: "Trail · TPU ammortizzato",
    glbSrc: "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
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
    glbSrc:
      "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb",
  },
  {
    id: "alpino-classic",
    name: "Alpino Classic",
    subtitle: "Daily · comfort",
    glbSrc: "https://modelviewer.dev/shared-assets/models/RobotExpressive.glb",
  },
];
