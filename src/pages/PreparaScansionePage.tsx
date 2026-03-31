"use client";

import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import NeumaLogo from "../components/NeumaLogo";

export default function PreparaScansionePage() {
  const navigate = useNavigate();

  const handleStart = () => {
    navigate("/", { state: { autoStartScan: true } });
  };

  return (
    <div className="min-h-[100dvh] bg-black px-5 py-8 pb-12 text-white">
      <div className="mx-auto max-w-lg">
        <Button variant="ghost" size="sm" className="mb-6 gap-2 px-0 text-[#e5e5e5] hover:text-white" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            Torna all&apos;app
          </Link>
        </Button>

        <header className="mb-6">
          <NeumaLogo variant="dark" size="md" className="mb-6" />
          <h1 className="text-4xl font-semibold tracking-tight text-white">Prepara scansione</h1>
          <p className="mt-3 text-base text-[#e5e5e5]">
            Informazioni sulla privacy. L&apos;accettazione delle condizioni d&apos;uso e del trattamento dei dati
            biometrici sarà richiesta <strong className="font-medium text-white">una sola volta</strong> nel passaggio
            successivo (onboarding NEUMA).
          </p>
        </header>

        <Card className="border-white/10 bg-white/[0.03] shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-2xl font-semibold text-white">Accordi e Privacy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-base leading-relaxed text-[#e5e5e5]">
              I tuoi dati biometrici sono elaborati localmente su hardware Apple Silicon crittografato.
            </p>

            <Button
              type="button"
              variant="default"
              size="lg"
              className="w-full rounded-full border border-white/20 bg-white/10 py-6 text-base font-semibold tracking-wide text-white hover:bg-white/15"
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
