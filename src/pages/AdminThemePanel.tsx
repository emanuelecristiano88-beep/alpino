"use client";

import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Sparkles } from "lucide-react";
import { useTheme } from "../theme/ThemeProvider";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Slider } from "../components/ui/slider";
function MiniLibraryPreview() {
  return (
    <Card className="pointer-events-none w-full max-w-[280px] shadow-lg">
      <CardContent className="p-3">
        <div className="text-sm font-bold">Library</div>
        <div className="mt-2 h-8 w-full rounded-md border border-border opacity-80" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="aspect-square rounded-md border border-border bg-primary/10 opacity-90"
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MiniScannerPreview() {
  return (
    <Card className="relative w-full max-w-[280px] overflow-hidden border-primary/40 shadow-lg">
      <div className="relative aspect-[9/16]">
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-900/80 to-black" />
        <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-primary opacity-70" />
        <div className="absolute bottom-3 left-0 right-0 text-center font-mono text-[9px] text-primary">
          SCANNER_V1
        </div>
      </div>
    </Card>
  );
}

export default function AdminThemePanel() {
  const { theme, setTheme, publishTheme } = useTheme();
  const [savedFlash, setSavedFlash] = React.useState(false);

  const handlePublish = () => {
    publishTheme();
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2200);
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground md:flex-row">
      <aside className="w-full shrink-0 border-b border-border bg-card p-6 md:w-[380px] md:border-b-0 md:border-r">
        <div className="mb-6 flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link to="/" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              App
            </Link>
          </Button>
        </div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Sparkles className="h-6 w-6 text-primary" />
          Tema (Admin)
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          URL: <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">/admin/theme</code>
        </p>

        <div className="mt-8 space-y-8">
          <div className="space-y-2">
            <Label>Colore accento</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={theme.accentColor}
                onChange={(e) => setTheme((t) => ({ ...t, accentColor: e.target.value }))}
                className="h-12 w-16 cursor-pointer rounded-md border border-input bg-background p-1"
              />
              <Input
                value={theme.accentColor}
                onChange={(e) => setTheme((t) => ({ ...t, accentColor: e.target.value }))}
                className="font-mono text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium leading-none">Sfondo</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={theme.appearance === "dark" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setTheme((t) => ({ ...t, appearance: "dark" }))}
              >
                Dark
              </Button>
              <Button
                type="button"
                variant={theme.appearance === "light" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setTheme((t) => ({ ...t, appearance: "light" }))}
              >
                Light
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="font-select">Tipografia</Label>
            <select
              id="font-select"
              value={theme.fontFamily}
              onChange={(e) =>
                setTheme((t) => ({ ...t, fontFamily: e.target.value as "mono" | "sans" }))
              }
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="mono">Tecnico / Mono</option>
              <option value="sans">Elegante / Sans (Inter)</option>
            </select>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between">
              <Label>Arrotondamento UI</Label>
              <span className="font-mono text-xs text-muted-foreground">{theme.radiusScale}%</span>
            </div>
            <Slider
              value={[theme.radiusScale]}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) => setTheme((t) => ({ ...t, radiusScale: v[0] ?? 0 }))}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Squadrato</span>
              <span>Molto arrotondato</span>
            </div>
          </div>

          <Button type="button" className="w-full gap-2 font-semibold uppercase tracking-wide" onClick={handlePublish}>
            {savedFlash ? (
              <>
                <Check className="h-5 w-5" />
                Salvato
              </>
            ) : (
              "PUBBLICA"
            )}
          </Button>
        </div>
      </aside>

      <main className="flex flex-1 flex-col gap-6 p-6 md:p-10">
        <div>
          <h2 className="text-lg font-semibold">Anteprima live</h2>
          <p className="text-sm text-muted-foreground">
            Le modifiche si applicano subito; &quot;PUBBLICA&quot; le salva per i prossimi caricamenti.
          </p>
        </div>

        <div className="flex flex-col items-center gap-10 lg:flex-row lg:items-start lg:justify-center">
          <div className="flex flex-col items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Library</span>
            <div className="origin-top scale-[0.95] md:scale-100">
              <MiniLibraryPreview />
            </div>
          </div>
          <div className="flex flex-col items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Scanner</span>
            <div className="origin-top scale-[0.95] md:scale-100">
              <MiniScannerPreview />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
