//  process_foot.swift — macOS 12+ (consigliato Apple Silicon)
//  PhotogrammetrySession (RealityKit / Object Capture) da terminale.
//
//  Compila:
//    cd scripts && swiftc -parse-as-library -O -framework RealityKit process_foot.swift -o process_foot
//  Esegui:
//    ./process_foot /percorso/cartella_foto /percorso/out.usdz [--preview|--full]
//
//  USDZ è il formato nativo; per OBJ esporta da Blender/Meshmixer o slicer che importa USDZ.
//  Scala metrica: Object Capture stima la geometria; per mm assoluti da foglio A4/ArUco
//  potrebbe servire una scala in post — non è garantita solo dalle foto.

import Foundation
import RealityKit

@available(macOS 12.0, *)
enum RunError: Error {
    case badArgs
}

@available(macOS 12.0, *)
func printUsage() {
    fputs(
        """
        Uso:
          process_foot <cartella_foto> <output.usdz> [--preview|--full]

        --preview   detail .preview (test veloci)
        --full      detail .full (qualità alta, tempi lunghi)

        sampleOrdering: .unordered | featureSensitivity: .normal
        """,
        stderr
    )
}

@available(macOS 12.0, *)
func run() async throws {
    var args = Array(CommandLine.arguments.dropFirst())
    guard args.count >= 2 else {
        printUsage()
        throw RunError.badArgs
    }

    let inputPath = args.removeFirst()
    let outputPath = args.removeFirst()

    var useFull = false
    for a in args {
        if a == "--full" { useFull = true }
        if a == "--preview" { useFull = false }
    }

    let inputFolder = URL(fileURLWithPath: inputPath, isDirectory: true)
    var outputFile = URL(fileURLWithPath: outputPath)
    if outputFile.pathExtension.lowercased() != "usdz" {
        outputFile = outputFile.deletingPathExtension().appendingPathExtension("usdz")
    }

    var configuration = PhotogrammetrySession.Configuration()
    configuration.sampleOrdering = .unordered
    configuration.featureSensitivity = .normal

    let session = try PhotogrammetrySession(input: inputFolder, configuration: configuration)
    // `detail` è sul Request (non più su Configuration), vedi RealityKit attuale.
    let detailLevel: PhotogrammetrySession.Request.Detail = useFull ? .full : .preview
    let request = PhotogrammetrySession.Request.modelFile(url: outputFile, detail: detailLevel)

    // Consuma gli aggiornamenti mentre gira `process` (pattern consigliato da Apple).
    let monitor = Task {
        for try await output in session.outputs {
            if case .requestProgress(_, let fraction) = output {
                let pct = Int((fraction * 100).rounded())
                fputs("Progresso: \(pct)%\n", stderr)
            } else if case .requestError(let err, _) = output {
                fputs("Errore richiesta: \(String(describing: err))\n", stderr)
            } else if case .processingComplete = output {
                fputs("Processing completato.\n", stderr)
            }
            // Altri casi (inputComplete, requestComplete, ecc.) ignorati — vedi documentazione RealityKit.
        }
    }

    // Su SDK recenti `process` può essere sincrono; `try` basta.
    try session.process(requests: [request])
    try await monitor.value
    fputs("File: \(outputFile.path)\n", stderr)
}

@available(macOS 12.0, *)
@main
struct Entry {
    static func main() async {
        do {
            try await run()
        } catch {
            fputs("Errore: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }
}
