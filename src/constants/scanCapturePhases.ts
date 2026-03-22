/**
 * Ordine delle 4 fasi di acquisizione (0–3): stesso ordine in ScannerCattura,
 * pannello fasi, tutorial e documentazione.
 */
export type ScanPhaseId = 0 | 1 | 2 | 3;

export const SCAN_CAPTURE_PHASES: {
  id: ScanPhaseId;
  /** Etichetta breve in UI scanner (maiuscolo) */
  name: string;
  /** Istruzione riga singola sotto la camera */
  instruction: string;
}[] = [
  {
    id: 0,
    name: "VISTA DALL'ALTO",
    instruction: "Telefono sopra il piede: punta, avampiede e contorni ben visibili",
  },
  {
    id: 1,
    name: "LATERALE ESTERNA",
    instruction: "Spostati sul lato esterno del piede (lato mignolo), movimento lento",
  },
  {
    id: 2,
    name: "LATERALE INTERNA + ARCO",
    instruction: "Lato interno (arco plantare): segui un arco lento lungo la curva interna",
  },
  {
    id: 3,
    name: "POSTERIORE / TALLONE",
    instruction: "Dietro al tallone: retro piede e calcagno; poi leggera inclinazione verso la pianta",
  },
];

export type ScanPhaseGuideCopy = {
  title: string;
  client: string;
  operator: string;
  hint: string;
};

/** Testi estesi per il pannello “prima di ogni fase” */
export const SCAN_PHASE_GUIDE_COPY: Record<ScanPhaseId, ScanPhaseGuideCopy> = {
  0: {
    title: "Vista dall’alto",
    client:
      "Piede nudo fermo sul foglio nell’area indicata. Non sollevare le dita; il piede non ruota durante la fase.",
    operator:
      "Porta il telefono sopra il piede, quasi perpendicolare al foglio. Devono restare visibili tutto il foglio, i 4 marker e il profilo della punta / avampiede.",
    hint: "Inquadra dall’alto punta, avampiede e contorno del piede.",
  },
  1: {
    title: "Vista laterale esterna",
    client: "Resta fermo: non ruotare il piede sul foglio.",
    operator:
      "Posizionati sul lato esterno del piede (lato mignolo). Distanza costante (~15–20 cm), movimento lento e fluido; evita ombre nette.",
    hint: "Profilo esterno: caviglia e bordo esterno del piede ben visibili.",
  },
  2: {
    title: "Vista laterale interna e arco",
    client: "Stessa posizione del piede, nessun movimento.",
    operator:
      "Dal lato interno (arco plantare), muovi il telefono lungo un arco lento che segue la curva interna del piede, mantenendo foglio + piede in inquadratura.",
    hint: "Arco lungo l’interno del piede; telefono stabile tra uno scatto e l’altro.",
  },
  3: {
    title: "Vista posteriore e tallone",
    client: "Tallone nell’area indicata sul foglio; piede fermo.",
    operator:
      "Posizionati dietro al tallone. Inquadra retro piede e calcagno; se serve inclina leggermente verso la pianta mantenendo i marker nel frame.",
    hint: "Tallone e zona posteriore a fuoco; poi leggero passaggio verso la pianta.",
  },
};

/**
 * Testi per illustrazioni SVG (stile NEUMA) nel pannello fase e in guida.
 */
export const SCAN_PHASE_REFERENCE_PHOTO: Record<
  ScanPhaseId,
  { alt: string; /** Sotto l’illustrazione nel pannello fase / guida */ caption: string }
> = {
  0: {
    alt: "Illustrazione vista dall’alto: piede sul foglio con griglia e quattro marker agli angoli",
    caption:
      "Piede fermo sul foglio · telefono sopra la pianta: punta, avampiede e contorni ben visibili; griglia e 4 marker nel frame.",
  },
  1: {
    alt: "Illustrazione vista laterale esterna: profilo dal lato mignolo, telefono basso",
    caption:
      "Telefono basso, quasi all’altezza del pavimento · inquadra il profilo esterno (mignolo) con foglio e marker ancora visibili.",
  },
  2: {
    alt: "Illustrazione vista laterale interna: arco plantare e percorso ad arco del telefono",
    caption:
      "Dal lato interno del piede · segui l’arco dell’arco plantare; mantieni griglia e marker allineati come in figura.",
  },
  3: {
    alt: "Illustrazione vista posteriore: tallone e retro piede sul foglio",
    caption:
      "Dietro al tallone · caviglia e calcagno a fuoco, telefono all’altezza della caviglia; poi leggera inclinazione verso la pianta.",
  },
};

/** Testi brevi per checklist tutorial modale */
export const SCAN_PHASE_TUTORIAL_BLURB: Record<ScanPhaseId, string> = {
  0: "Telefono sopra il piede: punta, avampiede e contorni visibili; foglio e 4 marker sempre nel frame.",
  1: "Dal lato esterno (mignolo): profilo lento, distanza costante, senza ombre dure.",
  2: "Dal lato interno: arco lento lungo l’arco plantare, mantenendo inquadrati foglio e piede.",
  3: "Dietro al tallone: retro piede e calcagno; poi leggera inclinazione verso la pianta se serve.",
};
