# process_foot.swift — Photogrammetry (Object Capture) da terminale

Richiede **macOS 12+** e **Xcode / Command Line Tools** con SDK RealityKit.

## Compilazione

```bash
cd /path/to/neuma-app/scripts
swiftc -parse-as-library -O -framework RealityKit process_foot.swift -o process_foot
```

**Nota:** `detail` (preview / full) è sul **`PhotogrammetrySession.Request`**, non su `Configuration` — allineato al RealityKit degli SDK recenti.

Se in terminale compare roba tipo `^[[201~` mentre incolli comandi, è **bracketed paste** del terminale: incolla una riga alla volta oppure disattiva “Paste bracketing” nelle impostazioni del terminale.

## Uso

```bash
./process_foot /percorso/cartella_con_foto /percorso/output.usdz --preview
./process_foot /percorso/cartella_con_foto /percorso/output.usdz --full
```

- **`--preview`**: `detail = .preview` (veloce, prove).
- **`--full`**: `detail = .full` (qualità alta, tempi lunghi).

Configurazione fissa nello script:

- `sampleOrdering = .unordered`
- `featureSensitivity = .normal`

## Output

- Apple espone soprattutto **USDZ**. Molti slicer importano USDZ; per **OBJ** usa un convertitore (es. Blender) se necessario.

## Scala / mm reali

Object Capture stima la geometria 3D dalle immagini; **non** garantisce da solo la scala millimetrica del foglio A4 o dei marker. Per allineare ai **mm** misurati (ArUco / righello) può servire **scala in post** (CAD, MeshLab, ecc.).

Se `swiftc` segnala errori sui `case` di `PhotogrammetrySession.Output`, apri il file in **Xcode** e adatta lo `switch` alla versione del tuo SDK (Apple cambia talvolta i casi dell’enum).
