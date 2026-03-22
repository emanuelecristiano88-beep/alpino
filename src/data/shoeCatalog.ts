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
 * Aggiungi qui nuove voci (glb/stl in `/public/models/`, anteprima in `/public/images/`).
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
];
