import React from "react";
import { User, Users } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

export type ScanMode = "solo" | "assistant";

type Props = {
  selected: ScanMode | null;
  onSelect: (mode: ScanMode) => void;
  onContinue: () => void;
  onClose: () => void;
};

function OptionCard({
  title,
  subtitle,
  Icon,
  selected,
  onClick,
}: {
  title: string;
  subtitle: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "neuma-anim group w-full select-none rounded-[24px] p-[1px] text-left active:scale-[0.985]",
        selected
          ? "bg-gradient-to-b from-white/20 to-white/5 shadow-[0_26px_90px_rgba(59,130,246,0.18)]"
          : "bg-white/10 hover:bg-white/15"
      )}
      aria-pressed={selected}
    >
      <div
        className={cn(
          "neuma-glass-soft neuma-anim rounded-[23px] px-5 py-5",
          selected && "border-blue-400/25 bg-white/[0.07] shadow-[0_0_0_1px_rgba(59,130,246,0.15),0_30px_90px_rgba(0,0,0,0.65)]"
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="neuma-title text-xl font-semibold text-white">{title}</div>
            <div className="mt-1 text-sm font-medium text-white/65">{subtitle}</div>
          </div>
          <div
            className={cn(
              "neuma-anim flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/80",
              selected && "border-blue-300/20 bg-blue-500/10 text-white"
            )}
            aria-hidden
          >
            <Icon className="h-6 w-6" strokeWidth={1.9} />
          </div>
        </div>
      </div>
    </button>
  );
}

export default function ScanModeSelectScreen({ selected, onSelect, onContinue, onClose }: Props) {
  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-black text-white">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(1100px 700px at 50% -10%, rgba(59,130,246,0.22) 0%, rgba(0,0,0,0) 58%), radial-gradient(900px 620px at 15% 25%, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0) 55%), radial-gradient(800px 520px at 85% 35%, rgba(16,185,129,0.07) 0%, rgba(0,0,0,0) 55%)",
        }}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/65 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/80 to-transparent" />

      <div className="relative z-10 flex items-center justify-end px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="pointer-events-auto h-11 w-11 rounded-full border border-white/10 bg-white/[0.04] text-white/90 hover:bg-white/[0.07]"
          onClick={onClose}
          aria-label="Chiudi"
        >
          ×
        </Button>
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-5">
        <div className="w-full max-w-md">
          <div className="text-center">
            <div className="neuma-title text-4xl font-semibold tracking-tight text-white">
              Scansiona il tuo piede
            </div>
            <div className="mt-2 text-base text-white/70">Scegli come vuoi procedere</div>
          </div>

          <div className="mt-8 grid gap-4">
            <OptionCard
              title="Da solo"
              subtitle="Segui la guida e scansiona autonomamente"
              Icon={User}
              selected={selected === "solo"}
              onClick={() => onSelect("solo")}
            />
            <OptionCard
              title="Con assistente"
              subtitle="Un’altra persona ti aiuta"
              Icon={Users}
              selected={selected === "assistant"}
              onClick={() => onSelect("assistant")}
            />
          </div>

          <div className="mt-7">
            <Button
              type="button"
              size="lg"
              className={cn(
                "neuma-touch w-full rounded-full py-6 text-base font-semibold",
                selected
                  ? "bg-white/12 hover:bg-white/16 shadow-[0_26px_90px_rgba(0,0,0,0.7)]"
                  : "bg-white/[0.06] text-white/55 shadow-none"
              )}
              disabled={!selected}
              onClick={onContinue}
            >
              Continua
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

