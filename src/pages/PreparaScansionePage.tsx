"use client";

import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Label } from "../components/ui/label";

export default function PreparaScansionePage() {
  const navigate = useNavigate();
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const handleStart = () => {
    if (!acceptedTerms) return;
    navigate("/", { state: { autoStartScan: true } });
  };

  return (
    <div className="min-h-[100dvh] bg-zinc-950 px-4 py-6 pb-12 text-zinc-100">
      <div className="mx-auto max-w-lg">
        <Button variant="ghost" size="sm" className="mb-6 gap-2 px-0 text-zinc-400 hover:text-zinc-100" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            Torna all&apos;app
          </Link>
        </Button>

        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Prepara scansione</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Prima di iniziare, leggi la sezione su privacy e accetta i termini.
          </p>
        </header>

        <Card className="border-zinc-800 bg-zinc-900 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold text-zinc-100">Accordi e Privacy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm leading-relaxed text-zinc-400">
              I tuoi dati biometrici sono elaborati localmente su hardware Apple Silicon crittografato.
            </p>

            <div className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
              <Checkbox
                id="prepara-digital-twin-terms"
                checked={acceptedTerms}
                onCheckedChange={(v) => setAcceptedTerms(v === true)}
                className="mt-0.5 border-zinc-600 data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600"
                aria-describedby="prepara-privacy-copy"
              />
              <Label
                htmlFor="prepara-digital-twin-terms"
                id="prepara-privacy-copy"
                className="cursor-pointer text-sm font-normal leading-snug text-zinc-300"
              >
                {"Accetto i termini d'uso per la creazione del mio Digital Twin"}
              </Label>
            </div>

            <Button
              type="button"
              variant="default"
              size="lg"
              className="w-full font-semibold tracking-wide"
              disabled={!acceptedTerms}
              onClick={handleStart}
            >
              Inizia Scansione
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
