"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, PanelTop, Printer, Smartphone } from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { cn } from "../lib/utils";
import {
  type UserProfileV2,
  type UserProfileV2Sex,
  type UserProfileV2Usage,
  loadUserProfileV2,
  saveOnboardingV2Profile,
} from "../lib/neumaUserProfileV2";

const STEP_LABELS = ["Requisiti", "Profilo biometrico", "Privacy & consenso"];

const CHECKLIST = [
  {
    key: "printerA4" as const,
    label: "Stampante A4",
    description: "Per stampare il target NEUMA in scala 1:1",
    Icon: Printer,
  },
  {
    key: "sheetOnRigidSurface" as const,
    label: "Foglio su superficie rigida",
    description: "Tavolo piatto, senza pieghe",
    Icon: PanelTop,
  },
  {
    key: "smartphoneChargedCleanLens" as const,
    label: "Smartphone carico / lente pulita",
    description: "Batteria sufficiente e obiettivo senza aloni",
    Icon: Smartphone,
  },
];

const SEX_OPTIONS: { value: UserProfileV2Sex; label: string }[] = [
  { value: "male", label: "Uomo" },
  { value: "female", label: "Donna" },
  { value: "prefer_not_say", label: "Preferisco non rispondere" },
];

const USAGE_OPTIONS: { value: UserProfileV2Usage; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "sport", label: "Sport" },
  { value: "comfort", label: "Comfort" },
];

const SHOE_SIZES = Array.from({ length: 48 - 35 + 1 }, (_, i) => 35 + i);

const PRIVACY_SCROLL = `INFORMATIVA SUL TRATTAMENTO DEI DATI BIOMETRICI

I dati raccolti tramite scansione del piede (immagini e misure) sono utilizzati per progettare e produrre calzature personalizzate, inclusa la stampa 3D.

Il trattamento avviene nel rispetto della normativa applicabile. Puoi esercitare i tuoi diritti contattando il titolare del trattamento indicato nell'app o sul sito NEUMA.

Proseguendo accetti le condizioni d'uso del servizio di scansione e di invio dati all'officina per la lavorazione.`;

const CONSENT_TEXT =
  "Accetto il trattamento dei dati biometrici per la produzione 3D.";

export type NeumaOnboardingProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
};

export default function NeumaOnboarding({ open, onOpenChange, onComplete }: NeumaOnboardingProps) {
  const [step, setStep] = useState(0);

  const [req, setReq] = useState({
    printerA4: false,
    sheetOnRigidSurface: false,
    smartphoneChargedCleanLens: false,
  });

  const [sex, setSex] = useState<UserProfileV2Sex | null>(null);
  const [ageYears, setAgeYears] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [shoeSize, setShoeSize] = useState<string>("");
  const [usage, setUsage] = useState<UserProfileV2Usage | "">("");

  const [privacyOk, setPrivacyOk] = useState(false);

  useEffect(() => {
    if (!open) return;
    const existing = loadUserProfileV2();
    setStep(0);
    if (existing) {
      setReq({ ...existing.requirements });
      setSex(existing.sex);
      setAgeYears(existing.ageYears != null ? String(existing.ageYears) : "");
      setHeightCm(String(existing.heightCm));
      setShoeSize(String(existing.shoeSizeEu));
      setUsage(existing.usage);
      setPrivacyOk(Boolean(existing.privacy?.biometricProcessingAccepted));
    } else {
      setReq({
        printerA4: false,
        sheetOnRigidSurface: false,
        smartphoneChargedCleanLens: false,
      });
      setSex(null);
      setAgeYears("");
      setHeightCm("");
      setShoeSize("");
      setUsage("");
      setPrivacyOk(false);
    }
  }, [open]);

  const step1Ok = req.printerA4 && req.sheetOnRigidSurface && req.smartphoneChargedCleanLens;

  const ageNum = parseInt(ageYears.replace(/\s/g, ""), 10);
  const ageOk = Number.isFinite(ageNum) && ageNum >= 10 && ageNum <= 120;

  const heightNum = parseFloat(heightCm.replace(",", "."));
  const heightOk = Number.isFinite(heightNum) && heightNum >= 100 && heightNum <= 250;

  const step2Ok =
    sex != null &&
    ageOk &&
    heightOk &&
    shoeSize !== "" &&
    (usage === "daily" || usage === "sport" || usage === "comfort");

  const step3Ok = privacyOk;

  const canGoNext = useMemo(() => {
    if (step === 0) return step1Ok;
    if (step === 1) return step2Ok;
    return false;
  }, [step, step1Ok, step2Ok]);

  function toggleReq(key: keyof typeof req) {
    setReq((p) => ({ ...p, [key]: !p[key] }));
  }

  function buildProfile(): UserProfileV2 {
    const now = new Date().toISOString();
    return {
      version: 2,
      requirements: { ...req },
      sex: sex!,
      ageYears: ageNum,
      heightCm: heightNum,
      shoeSizeEu: Number(shoeSize),
      usage: usage as UserProfileV2Usage,
      privacy: {
        biometricProcessingAccepted: true,
        acceptedAtIso: now,
      },
      completedAtIso: now,
    };
  }

  function handlePrimaryAction() {
    if (step < 2) {
      if (!canGoNext) return;
      setStep((s) => s + 1);
      return;
    }
    if (!step3Ok) return;
    saveOnboardingV2Profile(buildProfile());
    onComplete();
  }

  function handleBack() {
    if (step > 0) setStep((s) => s - 1);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose
        className="max-h-[92dvh] max-w-lg overflow-y-auto border border-white/10 bg-zinc-950/95 p-5 text-white shadow-2xl backdrop-blur-md sm:p-6"
      >
        <DialogHeader className="space-y-3 text-left">
          <DialogDescription className="sr-only">Completa la registrazione per iniziare la scansione del piede</DialogDescription>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-xl font-semibold tracking-tight text-white">Onboarding NEUMA</DialogTitle>
            <span className="text-xs font-medium text-white/45">
              {step + 1}/{STEP_LABELS.length}
            </span>
          </div>
          <div className="flex gap-1" role="tablist" aria-label="Step onboarding">
            {STEP_LABELS.map((label, i) => (
              <div
                key={label}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  i <= step ? "bg-white" : "bg-white/15"
                )}
                title={label}
              />
            ))}
          </div>
          <DialogDescription className="text-sm font-medium text-[#e5e5e5]">{STEP_LABELS[step]}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {step === 0 ? (
            <section aria-labelledby="step-req">
              <h2 id="step-req" className="sr-only">
                Requisiti
              </h2>
              <p className="mb-3 text-xs text-[#e5e5e5]">
                Conferma di avere tutto pronto prima del briefing e della sessione di scansione.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {CHECKLIST.map(({ key, label, description, Icon }) => {
                  const selected = req[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleReq(key)}
                      className={cn(
                        "relative flex flex-col items-center rounded-xl border-2 bg-white/[0.04] px-3 py-4 text-center transition-all backdrop-blur-sm",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
                        selected ? "border-white/50 shadow-lg shadow-black/30" : "border-white/10 hover:border-white/25"
                      )}
                      aria-pressed={selected}
                    >
                      {selected ? (
                        <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-black" aria-hidden>
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        </span>
                      ) : null}
                      <Icon className="h-9 w-9 text-white" strokeWidth={1.5} aria-hidden />
                      <span className="mt-3 text-sm font-semibold text-white">{label}</span>
                      <span className="mt-1 text-[11px] leading-tight text-[#e5e5e5]">{description}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {step === 1 ? (
            <section className="space-y-4" aria-labelledby="step-profile">
              <h2 id="step-profile" className="sr-only">
                Profilo biometrico
              </h2>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/55">Sesso</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {SEX_OPTIONS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSex(value)}
                      className={cn(
                        "rounded-lg border-2 bg-white/[0.04] px-3 py-2.5 text-sm font-medium text-white transition-colors backdrop-blur-sm",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35",
                        sex === value ? "border-white/50 shadow-sm" : "border-white/10 hover:border-white/30"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="neuma-age" className="text-[#e5e5e5]">
                  Età (anni)
                </Label>
                <Input
                  id="neuma-age"
                  inputMode="numeric"
                  placeholder="es. 32"
                  value={ageYears}
                  onChange={(e) => setAgeYears(e.target.value)}
                  className="border-white/15 bg-white/[0.06] text-white placeholder:text-white/40"
                />
                {!ageYears ? null : !ageOk ? (
                  <p className="text-xs text-red-400">Inserisci un’età tra 10 e 120 anni.</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="neuma-height" className="text-[#e5e5e5]">
                  Altezza (cm)
                </Label>
                <Input
                  id="neuma-height"
                  inputMode="decimal"
                  placeholder="es. 175"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  className="border-white/15 bg-white/[0.06] text-white placeholder:text-white/40"
                />
                {!heightCm ? null : !heightOk ? (
                  <p className="text-xs text-red-400">Inserisci un valore tra 100 e 250 cm.</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="neuma-size" className="text-[#e5e5e5]">
                  Taglia (EU)
                </Label>
                <select
                  id="neuma-size"
                  value={shoeSize}
                  onChange={(e) => setShoeSize(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                >
                  <option value="">Seleziona…</option>
                  {SHOE_SIZES.map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="neuma-usage" className="text-[#e5e5e5]">
                  Uso
                </Label>
                <select
                  id="neuma-usage"
                  value={usage}
                  onChange={(e) => setUsage(e.target.value as UserProfileV2Usage | "")}
                  className="flex h-10 w-full rounded-md border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                >
                  <option value="">Seleziona…</option>
                  {USAGE_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="space-y-4" aria-labelledby="step-privacy">
              <h2 id="step-privacy" className="sr-only">
                Privacy
              </h2>
              <div
                className="max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-3 text-left text-[11px] leading-relaxed text-[#e5e5e5] sm:text-xs"
                role="region"
                tabIndex={0}
              >
                {PRIVACY_SCROLL.split("\n\n").map((block, i) => (
                  <p key={i} className={i > 0 ? "mt-2" : undefined}>
                    {block}
                  </p>
                ))}
              </div>
              <div className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 backdrop-blur-sm">
                <Checkbox
                  id="neuma-privacy-v2"
                  checked={privacyOk}
                  onCheckedChange={(v) => setPrivacyOk(v === true)}
                  className="mt-0.5 border-white/35 data-[state=checked]:border-white data-[state=checked]:bg-white"
                />
                <Label htmlFor="neuma-privacy-v2" className="cursor-pointer text-left text-sm font-normal leading-snug text-[#e5e5e5]">
                  {CONSENT_TEXT}
                </Label>
              </div>
            </section>
          ) : null}

          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 0}
              className={cn(
                "inline-flex h-12 items-center justify-center gap-1 rounded-full border border-white/20 bg-white/[0.06] px-4 text-sm font-semibold text-white",
                "transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-35"
              )}
            >
              <ChevronLeft className="h-4 w-4" />
              Indietro
            </button>

            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={step < 2 ? !canGoNext : !step3Ok}
              className={cn(
                "inline-flex h-12 min-w-[200px] flex-1 items-center justify-center gap-1 rounded-full border border-white/20 bg-white/10 px-4 text-sm font-semibold tracking-wide text-white shadow-lg backdrop-blur-sm sm:flex-initial",
                "transition-colors duration-200 enabled:hover:bg-white/15 enabled:active:bg-white/[0.08]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
                "disabled:cursor-not-allowed disabled:opacity-45"
              )}
            >
              {step < 2 ? (
                <>
                  Avanti
                  <ChevronRight className="h-4 w-4" />
                </>
              ) : (
                "Video briefing & scanner"
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
