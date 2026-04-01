import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";

export default function DesignPlantarePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { scanId?: number } | null;

  return (
    <div className="min-h-[100dvh] bg-black px-5 pt-10 pb-14 text-white">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">NEUMA</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Design del Plantare</h1>
          <p className="mt-2 text-sm text-white/60">
            Schermata in arrivo. Scan ID: <span className="font-mono text-white/75">{state?.scanId ?? "—"}</span>
          </p>
          <div className="mt-6 flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="rounded-full border border-white/12 bg-white/[0.05] text-white hover:bg-white/[0.09]"
              onClick={() => navigate(-1)}
            >
              Indietro
            </Button>
            <Button
              type="button"
              className="rounded-full border border-white/12 bg-white/10 text-white hover:bg-white/15"
              onClick={() => navigate("/")}
            >
              Home
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

